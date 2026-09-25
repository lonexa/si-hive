import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { SharingClient } from './client.js';
import { loadKBConfig, getKBScopeOwner } from '../kb/env.js';
import { installSkill, installAgent, installPluginConfig, installSettingsTemplate, installPlan, installHook } from './installer.js';
import { syncSkillToProviders } from '../providers/skill-sync.js';
import { loadConfig } from '../config.js';
import { exportToDrive } from './drive-export.js';
import type { PublishItemInput, UpdateItemInput, SharedItemType } from './types.js';
import type { HiveConfig } from '../types.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';

function getClient(_req: http.IncomingMessage, _config: HiveConfig): SharingClient | null {
  return new SharingClient(loadKBConfig());
}

// Publishing uploads every file in a skill directory into the shared team table,
// where anyone can install it. Skill dirs routinely hold credentials next to the
// docs (a .env with DB passwords, an .pem key for a service account), so these
// never leave the machine. See also EXCLUDED_DIRS for build/cache noise.
const EXCLUDED_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,          // .env, .env.local, .env.production
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /\.(pyc|pyo|so|dll|exe)$/i,
];
const EXCLUDED_DIRS = new Set(['__pycache__', 'node_modules', '.git', '.venv', 'venv', 'dist', 'build']);

export function isExcludedFromPublish(name: string): boolean {
  return EXCLUDED_FILE_PATTERNS.some(re => re.test(name));
}

function readDirRecursive(dir: string, base: string = ''): { file_path: string; content: string; is_primary: boolean }[] {
  const results: { file_path: string; content: string; is_primary: boolean }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      results.push(...readDirRecursive(path.join(dir, entry.name), relPath));
    } else {
      if (isExcludedFromPublish(entry.name)) {
        console.warn(`[sharing] Skipping ${relPath} — excluded from publish (possible credentials)`);
        continue;
      }
      results.push({
        file_path: relPath,
        content: fs.readFileSync(path.join(dir, entry.name), 'utf-8'),
        is_primary: entry.name === 'skill.md',
      });
    }
  }
  return results;
}

export function registerSharingRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: HiveConfig,
): boolean {
  const pathname = url.pathname;

  // GET /api/sharing/items
  if (pathname === '/api/sharing/items' && req.method === 'GET') {
    const client = getClient(req, config);
    if (!client) {
      sendJson(res, 400, { error: 'Sharing is unavailable' });
      return true;
    }
    const type = (url.searchParams.get('type') || undefined) as SharedItemType | undefined;
    const q = url.searchParams.get('q') || undefined;
    const tag = url.searchParams.get('tag') || undefined;
    const scopeOwner = url.searchParams.get('scopeOwner') || getKBScopeOwner() || undefined;
    (async () => {
      try {
        const items = await client.listItems(type, q, tag, scopeOwner);
        sendJson(res, 200, items);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/sharing/tags
  if (pathname === '/api/sharing/tags' && req.method === 'GET') {
    const client = getClient(req, config);
    if (!client) {
      sendJson(res, 400, { error: 'Sharing not configured' });
      return true;
    }
    const type = (url.searchParams.get('type') || undefined) as SharedItemType | undefined;
    (async () => {
      try {
        const tags = await client.getTags(type);
        sendJson(res, 200, tags);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/sharing/publish-local
  if (pathname === '/api/sharing/publish-local' && req.method === 'POST') {
    const client = getClient(req, config);
    if (!client) {
      sendJson(res, 400, { error: 'Sharing not configured' });
      return true;
    }
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as {
          type: 'skill' | 'agent' | 'plan' | 'hook';
          name: string;
          description?: string;
          tags?: string;
          scope?: string;
          scope_owner?: string;
          // For hooks: the full hook payload to serialize (hooks aren't standalone files).
          hook?: { event: string; matcher?: string; hook: Record<string, unknown> };
        };
        if (!body.name || !body.type) {
          sendJson(res, 400, { error: 'name and type are required' });
          return;
        }

        const homeDir = process.env['USERPROFILE'] || process.env['HOME'] || '';
        const claudeHome = path.join(homeDir, '.claude');
        let files: { file_path: string; content: string; is_primary?: boolean }[];

        if (body.type === 'hook') {
          if (!body.hook?.event || !body.hook?.hook) {
            sendJson(res, 400, { error: 'hook payload (event + hook) is required for hook type' });
            return;
          }
          files = [{
            file_path: 'hook.json',
            content: JSON.stringify(body.hook, null, 2),
            is_primary: true,
          }];
        } else if (body.type === 'skill') {
          const skillDir = path.join(claudeHome, 'skills', body.name);
          if (!fs.existsSync(skillDir)) {
            sendJson(res, 404, { error: `Skill directory not found: ${skillDir}` });
            return;
          }
          files = readDirRecursive(skillDir);
        } else if (body.type === 'plan') {
          const planPath = path.join(claudeHome, 'plans', `${body.name}.md`);
          if (!fs.existsSync(planPath)) {
            sendJson(res, 404, { error: `Plan file not found: ${planPath}` });
            return;
          }
          files = [{
            file_path: `${body.name}.md`,
            content: fs.readFileSync(planPath, 'utf-8'),
            is_primary: true,
          }];
        } else {
          // agent
          const agentPath = path.join(claudeHome, 'agents', `${body.name}.md`);
          if (!fs.existsSync(agentPath)) {
            sendJson(res, 404, { error: `Agent file not found: ${agentPath}` });
            return;
          }
          files = [{
            file_path: `${body.name}.md`,
            content: fs.readFileSync(agentPath, 'utf-8'),
            is_primary: true,
          }];
        }

        const input: PublishItemInput = {
          name: body.name,
          item_type: body.type,
          description: body.description ?? '',
          tags: body.tags ?? '',
          files,
          scope: (body.scope as 'shared' | 'user') ?? 'shared',
          scope_owner: body.scope_owner ?? '',
          created_by: getKBScopeOwner() || '',
        };

        // Plans and hooks re-share frequently — upsert so the same item bumps version instead
        // of failing the (name, item_type, scope, scope_owner) unique constraint.
        const item = (body.type === 'plan' || body.type === 'hook')
          ? await client.publishOrUpdateItem(input)
          : await client.publishItem(input);
        sendJson(res, 201, item);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/sharing/publish-local-bulk
  if (pathname === '/api/sharing/publish-local-bulk' && req.method === 'POST') {
    const client = getClient(req, config);
    if (!client) {
      sendJson(res, 400, { error: 'Sharing not configured' });
      return true;
    }
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as {
          items: Array<{ type: 'skill' | 'agent'; name: string }>;
          scope?: string;
          scope_owner?: string;
        };
        if (!body.items?.length) {
          sendJson(res, 400, { error: 'items array is required' });
          return;
        }

        const homeDir = process.env['USERPROFILE'] || process.env['HOME'] || '';
        const claudeHome = path.join(homeDir, '.claude');
        const results: Array<{ name: string; type: string; ok: boolean; error?: string }> = [];

        for (const item of body.items) {
          try {
            let files: { file_path: string; content: string; is_primary?: boolean }[];

            if (item.type === 'skill') {
              const skillDir = path.join(claudeHome, 'skills', item.name);
              if (!fs.existsSync(skillDir)) {
                results.push({ name: item.name, type: item.type, ok: false, error: 'Not found' });
                continue;
              }
              files = readDirRecursive(skillDir);
            } else {
              const agentPath = path.join(claudeHome, 'agents', `${item.name}.md`);
              if (!fs.existsSync(agentPath)) {
                results.push({ name: item.name, type: item.type, ok: false, error: 'Not found' });
                continue;
              }
              files = [{
                file_path: `${item.name}.md`,
                content: fs.readFileSync(agentPath, 'utf-8'),
                is_primary: true,
              }];
            }

            const input: PublishItemInput = {
              name: item.name,
              item_type: item.type,
              files,
              scope: (body.scope as 'shared' | 'user') ?? 'shared',
              scope_owner: body.scope_owner ?? '',
              created_by: getKBScopeOwner() || '',
            };

            await client.publishOrUpdateItem(input);
            results.push({ name: item.name, type: item.type, ok: true });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            results.push({ name: item.name, type: item.type, ok: false, error: msg });
          }
        }

        sendJson(res, 200, { results });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/sharing/sync-to-team — re-publish all local skills/agents that are already shared by this user
  if (pathname === '/api/sharing/sync-to-team' && req.method === 'POST') {
    const client = getClient(req, config);
    if (!client) {
      sendJson(res, 400, { error: 'Sharing not configured' });
      return true;
    }
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { type?: 'skill' | 'agent' | 'plan' };
        const itemType = body.type ?? 'skill';
        const scopeOwner = getKBScopeOwner() || '';
        const homeDir = process.env['USERPROFILE'] || process.env['HOME'] || '';
        const claudeHome = path.join(homeDir, '.claude');

        // Find all shared items created by this user
        const allItems = await client.listItems(itemType, undefined, undefined, scopeOwner);
        const myItems = allItems.filter(i => i.created_by === scopeOwner);

        const results: Array<{ name: string; ok: boolean; oldVersion: number; newVersion: number; error?: string }> = [];

        for (const item of myItems) {
          try {
            let files: { file_path: string; content: string; is_primary?: boolean }[];

            if (itemType === 'skill') {
              const skillDir = path.join(claudeHome, 'skills', item.name);
              if (!fs.existsSync(skillDir)) {
                results.push({ name: item.name, ok: false, oldVersion: item.version, newVersion: item.version, error: 'Local skill not found' });
                continue;
              }
              files = readDirRecursive(skillDir);
            } else {
              // agent or plan — single .md file under agents/ or plans/
              const subDir = itemType === 'plan' ? 'plans' : 'agents';
              const filePath = path.join(claudeHome, subDir, `${item.name}.md`);
              if (!fs.existsSync(filePath)) {
                results.push({ name: item.name, ok: false, oldVersion: item.version, newVersion: item.version, error: `Local ${itemType} not found` });
                continue;
              }
              files = [{
                file_path: `${item.name}.md`,
                content: fs.readFileSync(filePath, 'utf-8'),
                is_primary: true,
              }];
            }

            const updated = await client.updateItem(item.id, { files });
            results.push({
              name: item.name,
              ok: true,
              oldVersion: item.version,
              newVersion: updated?.version ?? item.version + 1,
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            results.push({ name: item.name, ok: false, oldVersion: item.version, newVersion: item.version, error: msg });
          }
        }

        sendJson(res, 200, { results, total: myItems.length });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/sharing/sync-from-team — re-install latest versions for locally-installed shared items
  if (pathname === '/api/sharing/sync-from-team' && req.method === 'POST') {
    const client = getClient(req, config);
    if (!client) {
      sendJson(res, 400, { error: 'Sharing not configured' });
      return true;
    }
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { type?: 'skill' | 'agent' | 'plan' };
        const itemType = body.type ?? 'skill';
        const scopeOwner = getKBScopeOwner() || '';
        const homeDir = process.env['USERPROFILE'] || process.env['HOME'] || '';
        const claudeHome = path.join(homeDir, '.claude');

        // Get all shared items of this type
        const allItems = await client.listItems(itemType, undefined, undefined, scopeOwner);

        // Find which ones exist locally
        let localNames: Set<string>;
        if (itemType === 'skill') {
          const skillsDir = path.join(claudeHome, 'skills');
          localNames = new Set(
            fs.existsSync(skillsDir)
              ? fs.readdirSync(skillsDir, { withFileTypes: true })
                  .filter(d => d.isDirectory())
                  .map(d => d.name)
              : []
          );
        } else {
          // agent or plan — single .md files under agents/ or plans/
          const subDir = itemType === 'plan' ? 'plans' : 'agents';
          const dir = path.join(claudeHome, subDir);
          localNames = new Set(
            fs.existsSync(dir)
              ? fs.readdirSync(dir)
                  .filter(f => f.endsWith('.md'))
                  .map(f => f.replace(/\.md$/, ''))
              : []
          );
        }

        const installedItems = allItems.filter(i => localNames.has(i.name));
        const results: Array<{ name: string; ok: boolean; version: number; error?: string }> = [];
        const cfg = loadConfig();

        for (const item of installedItems) {
          try {
            const full = await client.getItemWithFiles(item.id);
            if (!full) {
              results.push({ name: item.name, ok: false, version: item.version, error: 'Could not fetch files' });
              continue;
            }

            if (itemType === 'skill') {
              installSkill(claudeHome, full);
              syncSkillToProviders(item.name, claudeHome, cfg.aiProviders!);
            } else if (itemType === 'plan') {
              installPlan(claudeHome, full);
            } else {
              installAgent(claudeHome, full);
            }

            results.push({ name: item.name, ok: true, version: item.version });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            results.push({ name: item.name, ok: false, version: item.version, error: msg });
          }
        }

        sendJson(res, 200, { results, total: installedItems.length });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/sharing/export-drive
  if (pathname === '/api/sharing/export-drive' && req.method === 'POST') {
    const client = getClient(req, config);
    if (!client) {
      sendJson(res, 400, { error: 'Sharing not configured' });
      return true;
    }
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { itemIds: number[]; drivePath: string };
        if (!body.itemIds?.length || !body.drivePath) {
          sendJson(res, 400, { error: 'itemIds and drivePath are required' });
          return;
        }
        const exported: number[] = [];
        for (const itemId of body.itemIds) {
          const item = await client.getItemWithFiles(itemId);
          if (item) {
            exportToDrive(body.drivePath, item);
            exported.push(itemId);
          }
        }
        sendJson(res, 200, { ok: true, exported });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // Routes with :id parameter
  const itemMatch = pathname.match(/^\/api\/sharing\/items\/(\d+)$/);
  const itemInstallMatch = pathname.match(/^\/api\/sharing\/items\/(\d+)\/install$/);

  // POST /api/sharing/items/:id/install
  if (itemInstallMatch && req.method === 'POST') {
    const client = getClient(req, config);
    if (!client) {
      sendJson(res, 400, { error: 'Sharing not configured' });
      return true;
    }
    const id = parseInt(itemInstallMatch[1], 10);
    (async () => {
      try {
        const item = await client.getItemWithFiles(id);
        if (!item) {
          sendJson(res, 404, { error: 'Item not found' });
          return;
        }

        const homeDir = process.env['USERPROFILE'] || process.env['HOME'] || '';
        const claudeHome = path.join(homeDir, '.claude');

        switch (item.item_type) {
          case 'skill': {
            installSkill(claudeHome, item);
            // Sync installed skill to other enabled providers
            const cfg = loadConfig();
            syncSkillToProviders(item.name, claudeHome, cfg.aiProviders!);
            break;
          }
          case 'agent':
            installAgent(claudeHome, item);
            break;
          case 'plan':
            installPlan(claudeHome, item);
            break;
          case 'plugin_config':
            installPluginConfig(claudeHome, item);
            break;
          case 'settings_template':
            installSettingsTemplate(claudeHome, item);
            break;
          case 'hook':
            installHook(claudeHome, item);
            break;
        }

        sendJson(res, 200, { ok: true, item_type: item.item_type, name: item.name });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // GET /api/sharing/items/:id
  if (itemMatch && req.method === 'GET') {
    const client = getClient(req, config);
    if (!client) {
      sendJson(res, 400, { error: 'Sharing not configured' });
      return true;
    }
    const id = parseInt(itemMatch[1], 10);
    (async () => {
      try {
        const item = await client.getItemWithFiles(id);
        if (!item) {
          sendJson(res, 404, { error: 'Item not found' });
        } else {
          sendJson(res, 200, item);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/sharing/items
  if (pathname === '/api/sharing/items' && req.method === 'POST') {
    const client = getClient(req, config);
    if (!client) {
      sendJson(res, 400, { error: 'Sharing not configured' });
      return true;
    }
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as PublishItemInput;
        if (!body.name || !body.files?.length) {
          sendJson(res, 400, { error: 'name and files are required' });
          return;
        }
        const item = await client.publishItem(body);
        sendJson(res, 201, item);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // PUT /api/sharing/items/:id
  if (itemMatch && req.method === 'PUT') {
    const client = getClient(req, config);
    if (!client) {
      sendJson(res, 400, { error: 'Sharing not configured' });
      return true;
    }
    const id = parseInt(itemMatch[1], 10);
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as UpdateItemInput;
        const item = await client.updateItem(id, body);
        if (!item) {
          sendJson(res, 404, { error: 'Item not found' });
        } else {
          sendJson(res, 200, item);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // DELETE /api/sharing/items/:id
  if (itemMatch && req.method === 'DELETE') {
    const client = getClient(req, config);
    if (!client) {
      sendJson(res, 400, { error: 'Sharing not configured' });
      return true;
    }
    const id = parseInt(itemMatch[1], 10);
    (async () => {
      try {
        const deleted = await client.deleteItem(id);
        if (!deleted) {
          sendJson(res, 404, { error: 'Item not found' });
        } else {
          sendJson(res, 200, { ok: true });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  return false;
}
