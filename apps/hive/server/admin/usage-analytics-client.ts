import { sql } from 'kysely';
import { getSharedDb } from '../../../../packages/shared/src/server/storage/index.js';
import { estimateCostUSD } from './model-pricing.js';

/**
 * Usage-analytics aggregation for the "Hive Usage" dashboard.
 *
 * Joins three already-populated shared tables — no new tracking:
 *   user_events    who clicked/navigated what, when (per-event log)
 *   users          login facts (last_login, login_count, email)
 *   ai_usage_log   per-session AI assistant usage (project, model, tokens)
 *
 * Aggregation happens in JS over the rows in the window: per-day and
 * per-minute bucketing by ISO timestamp prefix keeps the queries portable.
 *
 * "Active time" and cost are **estimates**: active minutes = count of distinct
 * minute-buckets with activity; per-page time on the daily timeline = gap to
 * the next event, capped at a 5-minute idle ceiling so an idle tab isn't
 * counted as hours. Cost is derived from tokens via model-pricing.ts.
 */

const IDLE_CAP_MS = 5 * 60_000;     // Per-page dwell is capped here (idle ceiling)
const LAST_DWELL_MS = 30_000;       // Assumed dwell for the final event of the day

// ── Public shapes ─────────────────────────────────────────────────────

export interface UsageUserRow {
  oid: string;
  displayName: string;
  email: string;
  lastLogin: string;
  loginCount: number;
  activeDays: number;
  events: number;
  activeMinutes: number;
  features: number;
  aiSessions: number;
  tokens: number;
  estCostUSD: number;
  lastActiveAt: string;
}

export interface UsageProjectRow {
  project: string;
  sessions: number;
  users: number;
  tokens: number;
  estCostUSD: number;
  lastActiveAt: string;
}

export interface UsageModelRow {
  model: string;
  sessions: number;
  tokens: number;
  estCostUSD: number;
}

export interface UsageDailyRow {
  day: string;
  events: number;
  users: number;
}

export interface UsageOverview {
  summary: {
    activeUsers: number;
    totalEvents: number;
    totalActiveMinutes: number;
    aiSessions: number;
    totalTokens: number;
    estCostUSD: number;
  };
  daily: UsageDailyRow[];
  topProjects: UsageProjectRow[];
  byModel: UsageModelRow[];
  topUsers: UsageUserRow[];
  warning?: string;
}

export type TimelineStep =
  | { kind: 'login'; at: string }
  | { kind: 'visit'; at: string; route: string; durationSec: number; events: number }
  | { kind: 'idle'; at: string; durationSec: number }
  | { kind: 'ai'; at: string; project: string; model: string; tokens: number; estCostUSD: number; messages: number; durationSec: number };

export interface UsageTimeline {
  oid: string;
  date: string;
  displayName: string;
  email: string;
  summary: {
    firstAt: string;
    lastAt: string;
    activeMinutes: number;
    pagesVisited: number;
    topRoute: string;
    aiSessions: number;
    tokens: number;
    estCostUSD: number;
  };
  steps: TimelineStep[];
  warning?: string;
}

// ── Row types from SQL ────────────────────────────────────────────────

interface EventRow { occurredAt: string; route: string | null }
interface AiSessionRow {
  username: string;
  startTime: string;
  projectPath: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  messageCount: number;
  durationSeconds: number;
}

// ── Client ────────────────────────────────────────────────────────────

export class UsageAnalyticsClient {
  // ── Per-user rollup ─────────────────────────────────────────────────

  async getUserRollup(days: number): Promise<{ rows: UsageUserRow[]; warning?: string }> {
    const db = await getSharedDb();
    const since = daysAgoIso(days);

    const users = await db.selectFrom('users')
      .select(['oid', 'email', 'display_name', 'last_login', 'login_count'])
      .execute();

    const events = await db.selectFrom('user_events')
      .select(['user_oid', 'name', 'occurred_at'])
      .where('occurred_at', '>', since)
      .execute();

    const eventAgg = new Map<string, { events: number; names: Set<string>; days: Set<string>; minutes: Set<string>; lastActiveAt: string }>();
    for (const e of events) {
      const at = String(e.occurred_at);
      const cur = eventAgg.get(e.user_oid) ?? { events: 0, names: new Set(), days: new Set(), minutes: new Set(), lastActiveAt: '' };
      cur.events++;
      cur.names.add(e.name);
      cur.days.add(at.slice(0, 10));
      cur.minutes.add(at.slice(0, 16));
      if (at > cur.lastActiveAt) cur.lastActiveAt = at;
      eventAgg.set(e.user_oid, cur);
    }

    const aiByEmail = new Map<string, { aiSessions: number; tokens: number; estCostUSD: number; lastActiveAt: string }>();
    for (const s of await this.getAiSessions(since)) {
      const key = (s.username || '').toLowerCase();
      const cur = aiByEmail.get(key) ?? { aiSessions: 0, tokens: 0, estCostUSD: 0, lastActiveAt: '' };
      cur.aiSessions++;
      cur.tokens += s.inputTokens + s.outputTokens;
      cur.estCostUSD += costOf(s);
      if (s.startTime > cur.lastActiveAt) cur.lastActiveAt = s.startTime;
      aiByEmail.set(key, cur);
    }

    const rows: UsageUserRow[] = users.map((u) => {
      const ev = eventAgg.get(u.oid);
      const ai = aiByEmail.get((u.email || '').toLowerCase());
      const evLast = ev?.lastActiveAt ?? '';
      const aiLast = ai?.lastActiveAt ?? '';
      return {
        oid: u.oid,
        displayName: u.display_name || u.email || 'unknown',
        email: u.email || '',
        lastLogin: u.last_login ?? '',
        loginCount: Number(u.login_count) || 0,
        activeDays: ev?.days.size ?? 0,
        events: ev?.events ?? 0,
        activeMinutes: ev?.minutes.size ?? 0,
        features: ev?.names.size ?? 0,
        aiSessions: ai?.aiSessions ?? 0,
        tokens: ai?.tokens ?? 0,
        estCostUSD: ai?.estCostUSD ?? 0,
        lastActiveAt: evLast > aiLast ? evLast : aiLast,
      };
    })
    // Only surface users with activity in-window, most active first.
    .filter((r) => r.events > 0 || r.aiSessions > 0)
    .sort((a, b) => (b.activeMinutes - a.activeMinutes) || (b.events - a.events));

    return { rows };
  }

  // ── Overview ────────────────────────────────────────────────────────

  async getOverview(days: number): Promise<UsageOverview> {
    const { rows: topUsersAll, warning: rollupWarning } = await this.getUserRollup(days);
    const db = await getSharedDb();
    const since = daysAgoIso(days);

    const events = await db.selectFrom('user_events')
      .select(['user_oid', 'occurred_at'])
      .where('occurred_at', '>', since)
      .execute();
    const byDay = new Map<string, { events: number; users: Set<string> }>();
    for (const e of events) {
      const day = String(e.occurred_at).slice(0, 10);
      const cur = byDay.get(day) ?? { events: 0, users: new Set<string>() };
      cur.events++;
      cur.users.add(e.user_oid);
      byDay.set(day, cur);
    }
    const daily: UsageDailyRow[] = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({ day, events: v.events, users: v.users.size }));

    const { topProjects, byModel } = aiBreakdown(await this.getAiSessions(since));

    const summary = {
      activeUsers: topUsersAll.length,
      totalEvents: topUsersAll.reduce((s, u) => s + u.events, 0),
      totalActiveMinutes: topUsersAll.reduce((s, u) => s + u.activeMinutes, 0),
      aiSessions: topUsersAll.reduce((s, u) => s + u.aiSessions, 0),
      totalTokens: topUsersAll.reduce((s, u) => s + u.tokens, 0),
      estCostUSD: topUsersAll.reduce((s, u) => s + u.estCostUSD, 0),
    };

    return {
      summary, daily, topProjects, byModel,
      topUsers: topUsersAll.slice(0, 12),
      warning: rollupWarning,
    };
  }

  // ── Per-user, per-day timeline ──────────────────────────────────────

  /** `date` is a UTC calendar day (YYYY-MM-DD). */
  async getUserTimeline(oid: string, date: string): Promise<UsageTimeline> {
    const db = await getSharedDb();
    const { start, end } = utcDayRange(date);
    let displayName = 'unknown', email = '';

    const u = await db.selectFrom('users').select(['email', 'display_name'])
      .where('oid', '=', oid).executeTakeFirst();
    if (u) { displayName = u.display_name || u.email || 'unknown'; email = u.email || ''; }

    const events: EventRow[] = (await db.selectFrom('user_events')
      .select(['occurred_at', 'route'])
      .where('user_oid', '=', oid)
      .where('occurred_at', '>=', start)
      .where('occurred_at', '<', end)
      .orderBy('occurred_at', 'asc')
      .execute())
      .map((r) => ({ occurredAt: String(r.occurred_at), route: r.route ?? null }));

    // AI sessions for the same user/day, matched by email.
    const aiSessions = email ? await this.getAiSessions(start, end, email) : [];

    return buildTimeline(oid, date, displayName, email, events, aiSessions);
  }

  // ── AI helpers ──────────────────────────────────────────────────────

  /** ai_usage_log sessions starting in [since, until), optionally for one username (case-insensitive). */
  private async getAiSessions(since: string, until?: string, username?: string): Promise<AiSessionRow[]> {
    const db = await getSharedDb();
    let q = db.selectFrom('ai_usage_log')
      .select([
        'username', 'start_time', 'project_path', 'model',
        'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens',
        'message_count', 'duration_seconds',
      ])
      .where('start_time', '>=', since);
    if (until) q = q.where('start_time', '<', until);
    if (username) q = q.where(sql<string>`lower(${sql.ref('username')})`, '=', username.toLowerCase());
    const rows = await q.orderBy('start_time', 'asc').execute();
    return rows.map((r) => ({
      username: r.username ?? '',
      startTime: String(r.start_time),
      projectPath: r.project_path ?? null,
      model: r.model ?? null,
      inputTokens: Number(r.input_tokens) || 0,
      outputTokens: Number(r.output_tokens) || 0,
      cacheCreationTokens: Number(r.cache_creation_tokens) || 0,
      cacheReadTokens: Number(r.cache_read_tokens) || 0,
      messageCount: Number(r.message_count) || 0,
      durationSeconds: Number(r.duration_seconds) || 0,
    }));
  }

  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────

/** Per-project and per-model AI breakdown with estimated cost. */
function aiBreakdown(sessions: AiSessionRow[]): { topProjects: UsageProjectRow[]; byModel: UsageModelRow[] } {
  const projMap = new Map<string, UsageProjectRow & { userSet: Set<string> }>();
  const modelMap = new Map<string, UsageModelRow>();
  for (const s of sessions) {
    const tokens = s.inputTokens + s.outputTokens;
    const cost = costOf(s);

    const project = s.projectPath ?? '(unknown)';
    const p = projMap.get(project) ?? { project, sessions: 0, users: 0, tokens: 0, estCostUSD: 0, lastActiveAt: '', userSet: new Set<string>() };
    p.sessions++;
    p.userSet.add(s.username.toLowerCase());
    p.tokens += tokens;
    p.estCostUSD += cost;
    if (s.startTime > p.lastActiveAt) p.lastActiveAt = s.startTime;
    projMap.set(project, p);

    const model = s.model ?? '(unknown)';
    const m = modelMap.get(model) ?? { model, sessions: 0, tokens: 0, estCostUSD: 0 };
    m.sessions++;
    m.tokens += tokens;
    m.estCostUSD += cost;
    modelMap.set(model, m);
  }
  const topProjects = [...projMap.values()]
    .map(({ userSet, ...p }) => ({ ...p, users: userSet.size }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 50);
  const byModel = [...modelMap.values()].sort((a, b) => b.sessions - a.sessions);
  return { topProjects, byModel };
}

function costOf(s: AiSessionRow): number {
  return estimateCostUSD({
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cacheCreationTokens: s.cacheCreationTokens,
    cacheReadTokens: s.cacheReadTokens,
  }, s.model);
}

function buildTimeline(
  oid: string, date: string, displayName: string, email: string,
  events: EventRow[], aiSessions: AiSessionRow[], warning?: string,
): UsageTimeline {
  const steps: TimelineStep[] = [];

  // Sessionize events into per-route visit segments + idle gaps.
  let seg: { route: string; startAt: number; durationMs: number; events: number } | null = null;
  const flush = () => {
    if (seg) {
      steps.push({ kind: 'visit', at: new Date(seg.startAt).toISOString(), route: seg.route,
        durationSec: Math.round(seg.durationMs / 1000), events: seg.events });
      seg = null;
    }
  };

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const t = new Date(ev.occurredAt).getTime();
    const route = ev.route || '(unknown)';
    const next = events[i + 1];
    const gap = next ? new Date(next.occurredAt).getTime() - t : LAST_DWELL_MS;
    const dwell = Math.min(gap, IDLE_CAP_MS);
    const idleAfter = next ? Math.max(0, gap - IDLE_CAP_MS) : 0;

    if (!seg || seg.route !== route) { flush(); seg = { route, startAt: t, durationMs: 0, events: 0 }; }
    seg.durationMs += dwell;
    seg.events += 1;

    if (idleAfter > 0) {
      flush();
      steps.push({ kind: 'idle', at: new Date(t + dwell).toISOString(), durationSec: Math.round(idleAfter / 1000) });
    }
  }
  flush();

  // Fold in AI sessions.
  let aiTokens = 0, aiCost = 0;
  for (const s of aiSessions) {
    const tokens = s.inputTokens + s.outputTokens;
    const cost = costOf(s);
    aiTokens += tokens;
    aiCost += cost;
    steps.push({
      kind: 'ai', at: new Date(s.startTime).toISOString(),
      project: shortProject(s.projectPath), model: s.model || '(unknown)',
      tokens, estCostUSD: cost, messages: s.messageCount,
      durationSec: s.durationSeconds,
    });
  }

  // Login marker at the first activity of the day.
  if (events.length > 0) {
    steps.push({ kind: 'login', at: new Date(events[0].occurredAt).toISOString() });
  }

  steps.sort((a, b) => a.at.localeCompare(b.at));

  const visitSteps = steps.filter((s): s is Extract<TimelineStep, { kind: 'visit' }> => s.kind === 'visit');
  const topRoute = pickTopRoute(visitSteps);
  // Active time for the day = sum of (idle-capped) per-page dwell, which lines
  // up with what the timeline visibly shows. Distinct-minute buckets undercount
  // reading time (sparse events), so we only use those for the cross-user
  // rollup where per-event dwell isn't computed.
  const activeSec = visitSteps.reduce((s, v) => s + v.durationSec, 0);

  return {
    oid, date, displayName, email,
    summary: {
      firstAt: steps.length ? steps[0].at : '',
      lastAt: steps.length ? steps[steps.length - 1].at : '',
      activeMinutes: Math.round(activeSec / 60),
      pagesVisited: visitSteps.length,
      topRoute,
      aiSessions: aiSessions.length,
      tokens: aiTokens,
      estCostUSD: aiCost,
    },
    steps,
    warning,
  };
}

function pickTopRoute(visits: Array<{ route: string; durationSec: number }>): string {
  const byRoute = new Map<string, number>();
  for (const v of visits) byRoute.set(v.route, (byRoute.get(v.route) ?? 0) + v.durationSec);
  let top = '', max = -1;
  for (const [route, sec] of byRoute) if (sec > max) { max = sec; top = route; }
  return top;
}

function shortProject(p: string | null): string {
  if (!p) return '(unknown)';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** ISO bounds [start, end) of a UTC calendar day. */
function utcDayRange(date: string): { start: string; end: string } {
  const start = new Date(`${date}T00:00:00.000Z`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
}
