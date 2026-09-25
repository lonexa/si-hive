import { API_BASE } from '@/lib/api-config';

export interface WorkItemCardData {
  /** Tracker issue key. */
  id: string;
  title: string;
  type: string;
  state: string;
  assignedTo?: { displayName: string; uniqueName: string };
  priority?: string;
  tags: string[];
  iterationPath: string;
  url: string;
  changedDate: string;
}

/**
 * Per-page cache of work-item cards. Keyed by ID, survives the page lifetime.
 * The server endpoint enforces its own 60s TTL so stale entries here aren't
 * load-bearing — they're just to avoid a network round-trip every time the
 * same ID appears (hover card + auto-chip both consume this).
 */
const cardCache = new Map<string, WorkItemCardData>();
const pendingFetches = new Map<string, Promise<WorkItemCardData | null>>();

/**
 * Look up a work-item card by ID, with built-in deduplication. Two simultaneous
 * callers for the same ID will share one in-flight fetch. Returns null on any
 * failure (404, 5xx, network error) so callers can fall back gracefully.
 */
export async function fetchWorkItemCard(id: string): Promise<WorkItemCardData | null> {
  if (cardCache.has(id)) return cardCache.get(id)!;
  const inflight = pendingFetches.get(id);
  if (inflight) return inflight;
  const promise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/work/issue-card?key=${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { ok?: boolean; card?: WorkItemCardData };
      if (!data.ok || !data.card) return null;
      cardCache.set(id, data.card);
      return data.card;
    } catch {
      return null;
    } finally {
      pendingFetches.delete(id);
    }
  })();
  pendingFetches.set(id, promise);
  return promise;
}

/** Synchronous read for already-cached cards. */
export function getCachedWorkItem(id: string): WorkItemCardData | null {
  return cardCache.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// Ticket reference pattern (from the connected tracker)
// ---------------------------------------------------------------------------

let refPattern: RegExp | null = null;
let patternLoaded = false;

/** Fetch the tracker's reference pattern once per page load. */
export async function loadTicketRefPattern(): Promise<RegExp | null> {
  if (patternLoaded) return refPattern;
  try {
    const res = await fetch(`${API_BASE}/api/work/status`);
    const data = (await res.json()) as { tracker?: { connected?: boolean; ticketRefPattern?: string } };
    refPattern = data.tracker?.connected && data.tracker.ticketRefPattern ? new RegExp(data.tracker.ticketRefPattern, 'g') : null;
  } catch {
    refPattern = null;
  }
  patternLoaded = true;
  return refPattern;
}

/** The loaded pattern, or null (not loaded yet / no tracker). */
export function getTicketRefPattern(): RegExp | null {
  if (!patternLoaded) void loadTicketRefPattern();
  return refPattern;
}

/** The issue key for a match: first non-empty capture group, else the whole match. */
export function ticketKeyFromMatch(m: RegExpExecArray): string {
  for (let i = 1; i < m.length; i++) if (m[i]) return m[i];
  return m[0];
}
