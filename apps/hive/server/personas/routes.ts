import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { PersonaClient } from './client.js';
import type { PersonaInput } from './types.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';

function getCurrentUser(): string {
  return os.userInfo().username;
}

/** Encode a project path to Claude's directory name format (e.g. C--Users-alice-project) */
function encodeProjectDirName(projectPath: string): string {
  // On Windows: C:\Users\foo\bar -> C--Users-foo-bar
  // On Mac/Linux: /Users/foo/bar -> -Users-foo-bar
  return projectPath
    .replace(/\\/g, '-')
    .replace(/\//g, '-')
    .replace(/:/g, '-');
}

const PERSONAS_START_MARKER = '<!-- HIVE PERSONAS: Start -->';
const PERSONAS_END_MARKER = '<!-- HIVE PERSONAS: End -->';
const personasRegex = /\n*<!-- HIVE PERSONAS: Start -->[\s\S]*?<!-- HIVE PERSONAS: End -->\n*/;

async function injectPersonasIntoUserClaudeMd(projectPath: string, client: PersonaClient): Promise<void> {
  const userId = getCurrentUser();
  const personas = await client.getAssignedPersonas(projectPath, userId);

  const claudeHome = process.env['CLAUDE_HOME'] ?? path.join(os.homedir(), '.claude');
  const encodedDir = encodeProjectDirName(projectPath);
  const targetDir = path.join(claudeHome, 'projects', encodedDir);
  const targetFile = path.join(targetDir, 'CLAUDE.md');

  // Read existing content
  let content = '';
  if (fs.existsSync(targetFile)) {
    content = fs.readFileSync(targetFile, 'utf-8');
  }

  // Strip existing persona section
  let updated = content.replace(personasRegex, '');

  if (personas.length > 0) {
    const sections = personas.map((p) => {
      let section = `## ${p.name}\n`;
      if (p.description) section += `${p.description}\n\n`;
      section += p.content;
      return section;
    });
    const block = `\n\n${PERSONAS_START_MARKER}\n${sections.join('\n\n')}\n${PERSONAS_END_MARKER}\n`;
    updated = updated.trimEnd() + block;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(targetFile, updated, 'utf-8');
}

let sharedClient: PersonaClient | null = null;

function getClient(): PersonaClient {
  if (!sharedClient) {
    sharedClient = new PersonaClient();
  }
  return sharedClient;
}

export function registerPersonaRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = url.pathname;

  // GET /api/personas
  if (pathname === '/api/personas' && req.method === 'GET') {
    const client = getClient();
    const q = url.searchParams.get('q') || undefined;
    const scopeOwner = url.searchParams.get('scopeOwner') || getCurrentUser();
    (async () => {
      try {
        const personas = q
          ? await client.search(q, scopeOwner)
          : await client.list(scopeOwner);
        sendJson(res, 200, personas);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  // GET /api/personas/tags
  if (pathname === '/api/personas/tags' && req.method === 'GET') {
    const client = getClient();
    (async () => {
      try {
        const personas = await client.list();
        const tagSet = new Set<string>();
        for (const p of personas) {
          for (const t of p.tags.split(',')) {
            const trimmed = t.trim();
            if (trimmed) tagSet.add(trimmed);
          }
        }
        sendJson(res, 200, [...tagSet].sort());
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  // GET /api/personas/current-user
  if (pathname === '/api/personas/current-user' && req.method === 'GET') {
    sendJson(res, 200, { username: getCurrentUser() });
    return true;
  }

  // POST /api/personas
  if (pathname === '/api/personas' && req.method === 'POST') {
    const client = getClient();
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as PersonaInput;
        if (!body.name || !body.content) {
          sendJson(res, 400, { error: 'name and content are required' });
          return;
        }
        if (!body.created_by) body.created_by = getCurrentUser();
        const persona = await client.create(body);
        sendJson(res, 201, persona);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  // Parameterized routes: /api/personas/:id
  const idMatch = pathname.match(/^\/api\/personas\/(\d+)$/);

  // GET /api/personas/:id
  if (idMatch && req.method === 'GET') {
    const client = getClient();
    const id = parseInt(idMatch[1], 10);
    (async () => {
      try {
        const persona = await client.getById(id);
        if (!persona) {
          sendJson(res, 404, { error: 'Persona not found' });
        } else {
          sendJson(res, 200, persona);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  // PUT /api/personas/:id
  if (idMatch && req.method === 'PUT') {
    const client = getClient();
    const id = parseInt(idMatch[1], 10);
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as Partial<PersonaInput>;
        const persona = await client.update(id, body);
        if (!persona) {
          sendJson(res, 404, { error: 'Persona not found' });
        } else {
          sendJson(res, 200, persona);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  // DELETE /api/personas/:id
  if (idMatch && req.method === 'DELETE') {
    const client = getClient();
    const id = parseInt(idMatch[1], 10);
    (async () => {
      try {
        const deleted = await client.delete(id);
        if (!deleted) {
          sendJson(res, 404, { error: 'Persona not found' });
        } else {
          sendJson(res, 200, { ok: true });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  // GET /api/personas/assignments/:encodedProjectPath
  const assignMatch = pathname.match(/^\/api\/personas\/assignments\/(.+)$/);
  if (assignMatch && req.method === 'GET') {
    const client = getClient();
    const projectPath = decodeURIComponent(assignMatch[1]);
    const userId = getCurrentUser();
    (async () => {
      try {
        const personaIds = await client.getAssignments(projectPath, userId);
        sendJson(res, 200, { projectPath, userId, personaIds });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  // POST /api/personas/assignments
  if (pathname === '/api/personas/assignments' && req.method === 'POST') {
    const client = getClient();
    (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { projectPath: string; personaIds: number[] };
        if (!body.projectPath || !Array.isArray(body.personaIds)) {
          sendJson(res, 400, { error: 'projectPath and personaIds[] required' });
          return;
        }
        const userId = getCurrentUser();
        await client.setAssignments(body.projectPath, userId, body.personaIds);

        // Inject into user-level CLAUDE.md
        await injectPersonasIntoUserClaudeMd(body.projectPath, client);

        sendJson(res, 200, { ok: true, personaIds: body.personaIds });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  return false;
}
