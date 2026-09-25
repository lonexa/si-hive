/**
 * Skill Requirements API routes.
 *
 * - Resolve + install endpoints (any authenticated user) power the
 *   RequiredSkillsBanner on an open session: scan the user's prompts for topic
 *   keywords and match the session repo's git origin, then auto-install the
 *   team-approved skill if it's missing.
 * - Admin CRUD endpoints under /api/admin/skill-requirements manage the
 *   repo -> skill and topic(keywords) -> skill mappings.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import type { AuthenticatedRequest } from '../auth/types.js';
import type { HiveConfig } from '../types.js';
import {
  SkillRequirementsClient,
  normalizeRemoteUrl,
  slugify,
  type SkillRequirement,
  type SkillRequirementContextType,
} from './requirements-client.js';
import { SharingClient } from '../sharing/client.js';
import { loadKBConfig } from '../kb/env.js';
import { installSkill } from '../sharing/installer.js';
import { syncSkillToProviders } from '../providers/skill-sync.js';
import { GitClient } from '../projects/git-client.js';
import { getSessionDetail, getSessionInfo } from '../sessions/replay-client.js';

const git = new GitClient();

function isActualAdmin(db: Database.Database, oid: string): boolean {
  const row = db.prepare('SELECT role FROM users WHERE oid = ?').get(oid) as { role: string } | undefined;
  return row?.role === 'admin';
}

/** Names of skills currently installed under ~/.claude/skills/. */
function installedSkillNames(claudeHome: string): Set<string> {
  const skillsDir = path.join(claudeHome, 'skills');
  if (!fs.existsSync(skillsDir)) return new Set();
  return new Set(
    fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  );
}

/**
 * Concatenated text of the user's own prompts in a session (most recent first,
 * capped). Excludes assistant output and tool results so keyword matching keys
 * only on what the user actually asked.
 */
async function loadUserPromptText(sessionId: string, maxTurns = 25): Promise<string> {
  try {
    const detail = await getSessionDetail(sessionId);
    if (!detail) return '';
    const userTexts = detail.entries
      .filter((e) => e.type === 'user' && e.content)
      .map((e) => e.content as string)
      // Drop tool-result-only turns — keep genuine typed prompts.
      .filter((c) => !c.trimStart().startsWith('[tool_result]'))
      .map((c) => c.replace(/\[tool_result\][^\n]*/g, ' '));
    return userTexts.slice(-maxTurns).join('\n').toLowerCase();
  } catch {
    return '';
  }
}

function topicMatches(req: SkillRequirement, promptText: string): boolean {
  if (!req.keywords) return false;
  return req.keywords
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((kw) => promptText.includes(kw));
}

interface ResolvedRequirement {
  id: number;
  contextType: SkillRequirementContextType;
  contextLabel: string | null;
  skillName: string;
  required: boolean;
  installed: boolean;
  availableInTeam: boolean;
  matchedOn: string; // human reason: 'repo' | keyword that matched
}

export function registerSkillRequirementsRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  db: Database.Database,
  config: HiveConfig,
): boolean {
  const authReq = req as AuthenticatedRequest;
  const pathname = url.pathname;
  const method = req.method || 'GET';

  // ── Resolve required skills for an open session (any authed user) ─────────
  // GET /api/skill-requirements/resolve?sessionId=<id>&cwd=<path>
  if (pathname === '/api/skill-requirements/resolve' && method === 'GET') {
    const kbCfg = loadKBConfig();
    if (!kbCfg) {
      sendJson(res, 200, { requirements: [], warning: 'Sharing/KB not configured' });
      return true;
    }
    const sessionId = url.searchParams.get('sessionId') || '';
    const cwdParam = url.searchParams.get('cwd') || '';
    const reqClient = new SkillRequirementsClient(kbCfg);
    const shareClient = new SharingClient(kbCfg);
    (async () => {
      try {
        const [repoReqs, topicReqs] = await Promise.all([
          reqClient.listByType('repo'),
          reqClient.listByType('topic'),
        ]);

        const matched: SkillRequirement[] = [];
        const reasons = new Map<number, string>();

        // Repo match: derive the session's git origin and compare normalized URLs.
        const cwd = cwdParam || (sessionId ? getSessionInfo(sessionId).cwd : undefined);
        if (cwd && repoReqs.length > 0) {
          const origin = git.getOriginUrl(cwd);
          const normalized = origin ? normalizeRemoteUrl(origin) : '';
          if (normalized) {
            for (const r of repoReqs) {
              if (r.contextKey === normalized) {
                matched.push(r);
                reasons.set(r.id, 'repo');
              }
            }
          }
        }

        // Topic match: scan the user's prompts for any topic's keywords.
        if (sessionId && topicReqs.length > 0) {
          const promptText = await loadUserPromptText(sessionId);
          if (promptText) {
            for (const r of topicReqs) {
              if (topicMatches(r, promptText)) {
                matched.push(r);
                const hit = (r.keywords || '')
                  .split(',')
                  .map((k) => k.trim().toLowerCase())
                  .find((kw) => kw && promptText.includes(kw));
                reasons.set(r.id, hit ? `"${hit}"` : 'keyword');
              }
            }
          }
        }

        if (matched.length === 0) {
          sendJson(res, 200, { requirements: [] });
          return;
        }

        const installed = installedSkillNames(config.claudeHome);
        const teamSkills = new Set((await shareClient.listItems('skill')).map((s) => s.name));
        const requirements: ResolvedRequirement[] = matched.map((r) => ({
          id: r.id,
          contextType: r.contextType,
          contextLabel: r.contextLabel,
          skillName: r.skillName,
          required: r.required,
          installed: installed.has(r.skillName),
          availableInTeam: teamSkills.has(r.skillName),
          matchedOn: reasons.get(r.id) || '',
        }));
        sendJson(res, 200, { requirements });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Invalid object name')) {
          sendJson(res, 200, { requirements: [], warning: 'Skill requirements table not yet created' });
        } else {
          sendJson(res, 500, { error: msg });
        }
      } finally {
        await reqClient.close();
        await shareClient.close();
      }
    })();
    return true;
  }

  // ── Auto-install required skills from the team shared-skills DB ────────────
  // POST /api/skill-requirements/install  { skills: string[] }
  if (pathname === '/api/skill-requirements/install' && method === 'POST') {
    const kbCfg = loadKBConfig();
    if (!kbCfg) {
      sendJson(res, 400, { error: 'Sharing/KB not configured' });
      return true;
    }
    const shareClient = new SharingClient(kbCfg);
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { skills?: string[] };
        const names = Array.isArray(body.skills) ? body.skills : [];
        if (names.length === 0) {
          sendJson(res, 400, { error: 'skills array is required' });
          return;
        }
        const allSkills = await shareClient.listItems('skill');
        const byName = new Map(allSkills.map((s) => [s.name, s]));
        const results: Array<{ name: string; ok: boolean; error?: string }> = [];

        for (const name of names) {
          try {
            const meta = byName.get(name);
            if (!meta) {
              results.push({ name, ok: false, error: 'Not found in team skills' });
              continue;
            }
            const item = await shareClient.getItemWithFiles(meta.id);
            if (!item) {
              results.push({ name, ok: false, error: 'Could not fetch skill files' });
              continue;
            }
            installSkill(config.claudeHome, item);
            syncSkillToProviders(name, config.claudeHome, config.aiProviders!);
            results.push({ name, ok: true });
          } catch (err: unknown) {
            results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
          }
        }
        sendJson(res, 200, { results });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await shareClient.close();
      }
    })();
    return true;
  }

  // ── Admin endpoints ─────────────────────────────────────────────────────
  if (!pathname.startsWith('/api/admin/skill-requirements')) return false;

  if (!authReq.user || !isActualAdmin(db, authReq.user.oid)) {
    sendJson(res, 403, { error: 'Admin access required' });
    return true;
  }

  // GET /api/admin/skill-requirements/repo-remote?path=<projectPath>
  // Preview the normalized origin URL for a project the admin is selecting.
  if (pathname === '/api/admin/skill-requirements/repo-remote' && method === 'GET') {
    const projectPath = url.searchParams.get('path') || '';
    if (!projectPath) {
      sendJson(res, 400, { error: 'path is required' });
      return true;
    }
    const origin = git.getOriginUrl(projectPath);
    if (!origin) {
      sendJson(res, 200, { remoteUrl: null, normalized: null });
      return true;
    }
    sendJson(res, 200, { remoteUrl: origin, normalized: normalizeRemoteUrl(origin) });
    return true;
  }

  const kbCfg = loadKBConfig();
  if (!kbCfg) {
    sendJson(res, 400, { error: 'Sharing/KB not configured' });
    return true;
  }

  // GET /api/admin/skill-requirements — list all
  if (pathname === '/api/admin/skill-requirements' && method === 'GET') {
    const client = new SkillRequirementsClient(kbCfg);
    (async () => {
      try {
        const requirements = await client.list();
        sendJson(res, 200, { requirements });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Invalid object name')) {
          sendJson(res, 200, { requirements: [], warning: 'Skill requirements table not yet created' });
        } else {
          sendJson(res, 500, { error: msg });
        }
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // POST /api/admin/skill-requirements — create
  if (pathname === '/api/admin/skill-requirements' && method === 'POST') {
    const client = new SkillRequirementsClient(kbCfg);
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as {
          contextType?: SkillRequirementContextType;
          // repo
          projectPath?: string;
          remoteUrl?: string;
          repoLabel?: string;
          // topic
          label?: string;
          keywords?: string;
          // shared
          skillName?: string;
        };
        if (!body.contextType || !body.skillName) {
          sendJson(res, 400, { error: 'contextType and skillName are required' });
          return;
        }

        let contextKey: string;
        let contextLabel: string | null;
        let keywords: string | null = null;

        if (body.contextType === 'repo') {
          // Resolve the remote from the chosen project, or accept a manual URL.
          let origin = body.remoteUrl?.trim() || '';
          if (!origin && body.projectPath) {
            origin = git.getOriginUrl(body.projectPath) || '';
          }
          if (!origin) {
            sendJson(res, 400, { error: 'Could not determine a git origin for this repo. Pick a project with a remote, or enter the remote URL.' });
            return;
          }
          contextKey = normalizeRemoteUrl(origin);
          contextLabel = body.repoLabel?.trim() || contextKey.split('/').pop() || contextKey;
        } else if (body.contextType === 'topic') {
          if (!body.label?.trim() || !body.keywords?.trim()) {
            sendJson(res, 400, { error: 'Topic label and keywords are required' });
            return;
          }
          contextLabel = body.label.trim();
          contextKey = slugify(contextLabel);
          keywords = body.keywords
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean)
            .join(',');
          if (!keywords) {
            sendJson(res, 400, { error: 'At least one keyword is required' });
            return;
          }
        } else {
          sendJson(res, 400, { error: "contextType must be 'repo' or 'topic'" });
          return;
        }

        const created = await client.create({
          contextType: body.contextType,
          contextKey,
          contextLabel,
          keywords,
          skillName: body.skillName,
          createdBy: authReq.user?.email ?? authReq.user?.oid ?? null,
        });
        sendJson(res, 201, created);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('UQ_skillreq') || msg.includes('duplicate')) {
          sendJson(res, 409, { error: 'That skill is already required for this repo/topic' });
        } else {
          sendJson(res, 500, { error: msg });
        }
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  // DELETE /api/admin/skill-requirements/:id
  const delMatch = pathname.match(/^\/api\/admin\/skill-requirements\/(\d+)$/);
  if (delMatch && method === 'DELETE') {
    const id = parseInt(delMatch[1], 10);
    const client = new SkillRequirementsClient(kbCfg);
    (async () => {
      try {
        const ok = await client.delete(id);
        if (!ok) sendJson(res, 404, { error: 'Requirement not found' });
        else sendJson(res, 200, { ok: true });
      } catch (err: unknown) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        await client.close();
      }
    })();
    return true;
  }

  return false;
}
