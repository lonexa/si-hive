import type { CodexReasoningEffort, ProviderId } from './launch-flags';

/**
 * Persistence for "new session" navigation intent.
 *
 * When the user clicks "New AI" on a project card, we navigate to
 * `/sessions/new-<uuid>` with React Router state `{ newSession, cwd, providerId }`.
 * Router state lives in window.history.state and survives in-tab navigation,
 * but is lost if the tab is closed or the URL is opened fresh later. Without
 * the intent, SessionDetailPage falls into the "resume" branch and runs
 * `claude --resume new-<uuid>` which fails ("No conversation found").
 *
 * Persisting to sessionStorage keeps the intent across reloads of the same
 * tab, so the user can leave a long-running session and come back to a URL
 * that still knows it's a fresh-spawn (not a resume).
 *
 * sessionStorage (per-tab) is intentional — these IDs are scoped to the tab
 * that created them; bleeding into other tabs would be confusing.
 */

export interface NewSessionIntent {
  newSession: true;
  cwd?: string;
  providerId?: ProviderId;
  /**
   * Which credential identity to launch under (see providers/accounts.ts).
   * Absent or `default` means the provider's primary config dir — i.e. exactly
   * the single-account behaviour that predates account support.
   */
  accountId?: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  /** Initial prompt + provider command/args for handoff terminals */
  handoff?: { command: string; args: string[]; provider: ProviderId; initialPrompt?: string };
  /**
   * Epoch ms when the temp ID was minted. The server uses this to scope the
   * resolve fallback to JSONLs created AFTER the click — without it, the
   * heuristic returns any recent JSONL in the project, hijacking +AI clicks
   * into resumes of unrelated existing sessions.
   */
  createdAt?: number;
}

const KEY_PREFIX = 'hive:session-intent:';

function key(terminalId: string): string {
  return `${KEY_PREFIX}${terminalId}`;
}

export function saveSessionIntent(terminalId: string, intent: NewSessionIntent): void {
  try {
    const stamped: NewSessionIntent = { ...intent, createdAt: intent.createdAt ?? Date.now() };
    sessionStorage.setItem(key(terminalId), JSON.stringify(stamped));
  } catch { /* sessionStorage may be unavailable in private mode */ }
}

export function readSessionIntent(terminalId: string): NewSessionIntent | null {
  try {
    const raw = sessionStorage.getItem(key(terminalId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NewSessionIntent;
    return parsed && parsed.newSession === true ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSessionIntent(terminalId: string): void {
  try {
    sessionStorage.removeItem(key(terminalId));
  } catch { /* ignore */ }
}

/**
 * Migrate intent from a temp terminal ID (e.g. `new-<uuid>`) to the real
 * Claude session ID once discovered. Lets a refresh of the new URL still
 * find context if needed (rare), but mostly just cleans up the old key.
 */
export function migrateSessionIntent(oldId: string, newId: string): void {
  const intent = readSessionIntent(oldId);
  if (intent) {
    saveSessionIntent(newId, intent);
    clearSessionIntent(oldId);
  }
}
