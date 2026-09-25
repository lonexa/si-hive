import fs from 'node:fs';
import type { TrackerProvider } from '../integrations/types.js';
import { UserManagementClient } from '../admin/user-management-client.js';
import { listSessions, getSessionInfo } from '../sessions/replay-client.js';
import { loadKBConfig, getKBScopeOwner } from '../kb/env.js';
import { KBClient } from '../kb/client.js';
import { isIncognitoSession } from '../privacy/incognito.js';

/**
 * Federated universal search (B2.1) + retrieval used by Ask Hive (B2.2).
 *
 * Searches the sources a single Hive instance can reach: the shared Knowledge
 * Base (SQL), Azure DevOps work items, the people directory (SQL), and this
 * machine's local Claude session transcripts. Every source is queried
 * independently and failures degrade to an empty group + a warning — nothing
 * here should ever throw out to the caller.
 */

export type SearchSource = 'kb' | 'workitem' | 'session' | 'person';

export interface SearchHit {
  source: SearchSource;
  id: string;
  title: string;
  snippet: string;
  /** In-app route to open the result. */
  url?: string;
  /** Short qualifier (work-item type, KB category, role, project…). */
  badge?: string;
  date?: string;
}

export interface SearchResults {
  query: string;
  kb: SearchHit[];
  workItems: SearchHit[];
  sessions: SearchHit[];
  people: SearchHit[];
  warnings: string[];
}

const MAX_SESSION_FILES = 40;
const MAX_FILE_BYTES = 400_000;

function snippetAround(text: string, query: string, radius = 120): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2).replace(/\s+/g, ' ').trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

// --- Knowledge Base ---------------------------------------------------------

export async function searchKB(query: string, limit = 12): Promise<{ hits: SearchHit[]; warning?: string }> {
  const cfg = loadKBConfig();
  if (!cfg) return { hits: [], warning: 'Knowledge Base not configured.' };
  const client = new KBClient(cfg);
  try {
    const entries = await client.search(query, undefined, undefined, getKBScopeOwner());
    const hits = entries.slice(0, limit).map((e): SearchHit => ({
      source: 'kb',
      id: String(e.id),
      title: e.title,
      snippet: snippetAround(e.content || '', query),
      url: `/knowledge?entry=${e.id}`,
      badge: e.category || 'KB',
      date: e.updated_at,
    }));
    return { hits };
  } catch (err: unknown) {
    return { hits: [], warning: `Knowledge Base search failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    await client.close().catch(() => {});
  }
}

// --- Work items -------------------------------------------------------------

export async function searchWorkItems(tracker: TrackerProvider | null, query: string, limit = 15): Promise<{ hits: SearchHit[]; warning?: string }> {
  if (!tracker) return { hits: [], warning: 'No ticket tracker connected.' };
  try {
    const issues = await tracker.searchIssues({ text: query, limit });
    const hits = issues.map((i): SearchHit => ({
      source: 'workitem',
      id: i.key,
      title: i.title || `Issue ${i.key}`,
      snippet: stripHtml(i.description || '').slice(0, 200),
      url: `/work?issue=${encodeURIComponent(i.key)}`,
      badge: i.type || 'Issue',
      date: i.updatedAt,
    }));
    return { hits };
  } catch (err: unknown) {
    return { hits: [], warning: `Issue search failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// --- People -----------------------------------------------------------------

export async function searchPeople(query: string, limit = 10): Promise<{ hits: SearchHit[]; warning?: string }> {
  const client = new UserManagementClient();
  try {
    const users = await client.listUsers();
    const q = query.toLowerCase();
    const hits = users
      .filter((u) => u.displayName?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
      .slice(0, limit)
      .map((u): SearchHit => ({
        source: 'person',
        id: u.oid,
        title: u.displayName || u.email,
        snippet: u.email,
        url: `/admin/users/${encodeURIComponent(u.oid)}`,
        badge: u.role,
        date: u.lastLogin,
      }));
    return { hits };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Invalid object name/i.test(msg)) return { hits: [] };
    return { hits: [], warning: `People search failed: ${msg}` };
  } finally {
    await client.close().catch(() => {});
  }
}

// --- Session transcripts (local) -------------------------------------------

export async function searchSessions(query: string, limit = 12): Promise<{ hits: SearchHit[]; warning?: string }> {
  try {
    const { sessions } = await listSessions(MAX_SESSION_FILES, 0);
    const q = query.toLowerCase();
    const hits: SearchHit[] = [];

    await Promise.all(sessions.map(async (s) => {
      // Incognito transcripts stay out of federated search — Ask Hive feeds
      // these snippets to Azure OpenAI.
      if (isIncognitoSession(s.id, s.project)) return;

      // Cheap metadata match first (project path / id).
      let matchedText: string | null = null;
      if (s.project.toLowerCase().includes(q)) matchedText = s.project;

      // Then scan the transcript text (bounded read).
      if (!matchedText) {
        try {
          const info = getSessionInfo(s.id);
          if (info.exists && info.filePath && (info.sizeBytes ?? 0) <= MAX_FILE_BYTES) {
            const text = fs.readFileSync(info.filePath, 'utf-8');
            if (text.toLowerCase().includes(q)) matchedText = text;
          }
        } catch { /* unreadable — skip */ }
      }

      if (matchedText) {
        hits.push({
          source: 'session',
          id: s.id,
          title: s.project.split(/[\\/]/).filter(Boolean).pop() || s.id,
          snippet: snippetAround(matchedText, query),
          url: `/sessions/${encodeURIComponent(s.id)}`,
          badge: 'Session',
          date: s.modifiedAt,
        });
      }
    }));

    hits.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { hits: hits.slice(0, limit) };
  } catch (err: unknown) {
    return { hits: [], warning: `Session search failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// --- Federation -------------------------------------------------------------

export async function searchAll(query: string, tracker: TrackerProvider | null): Promise<SearchResults> {
  const [kb, workItems, people, sessions] = await Promise.all([
    searchKB(query),
    searchWorkItems(tracker, query),
    searchPeople(query),
    searchSessions(query),
  ]);

  const warnings = [kb.warning, workItems.warning, people.warning, sessions.warning].filter(Boolean) as string[];

  return {
    query,
    kb: kb.hits,
    workItems: workItems.hits,
    sessions: sessions.hits,
    people: people.hits,
    warnings,
  };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
