import { getSharedDb } from '../../../../packages/shared/src/server/storage/index.js';

/**
 * Team-wide AI usage. Aggregates the shared ai_usage_log across all users
 * into per-user / per-project / per-model rollups. This is *usage*, not
 * cost — we surface sessions, messages, tool calls, active time, and tokens.
 *
 * Each Hive instance only sees its own machine's live sessions, so the only
 * cross-user signal is what every instance logs to the shared database.
 * Rollups are computed in JS over the sessions in the window (one row per
 * session), which keeps the query portable across dialects.
 */

export interface UsageByUser {
  user: string;
  displayName: string;
  sessions: number;
  messages: number;
  toolUses: number;
  activeSeconds: number;
  tokens: number;
  projects: number;
  models: string[];
  lastActiveAt: string;
}

export interface UsageByProject {
  project: string;
  sessions: number;
  users: number;
  activeSeconds: number;
  messages: number;
  tokens: number;
  lastActiveAt: string;
}

export interface UsageByModel {
  model: string;
  sessions: number;
  tokens: number;
}

export interface UsageDaily {
  day: string;
  sessions: number;
  users: number;
  activeSeconds: number;
}

export interface TeamUsage {
  byUser: UsageByUser[];
  byProject: UsageByProject[];
  byModel: UsageByModel[];
  daily: UsageDaily[];
  summary: {
    totalSessions: number;
    activeUsers: number;
    totalActiveSeconds: number;
    totalMessages: number;
    totalTokens: number;
  };
  warning?: string;
}

export class TeamUsageClient {
  async getUsage(days = 30): Promise<TeamUsage> {
    const db = await getSharedDb();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await db.selectFrom('ai_usage_log')
      .select([
        'username', 'display_name', 'project_path', 'model', 'start_time',
        'duration_seconds', 'message_count', 'tool_use_count', 'input_tokens', 'output_tokens',
      ])
      .where('start_time', '>=', since)
      .execute();

    const users = new Map<string, UsageByUser & { projectSet: Set<string | null>; modelSet: Set<string> }>();
    const projects = new Map<string, UsageByProject & { userSet: Set<string> }>();
    const models = new Map<string, UsageByModel>();
    const days_ = new Map<string, UsageDaily & { userSet: Set<string> }>();

    for (const r of rows) {
      const user = (r.username as string) || 'unknown';
      const displayName = (r.display_name as string | null) || user;
      const startTime = String(r.start_time);
      const seconds = Number(r.duration_seconds) || 0;
      const messages = Number(r.message_count) || 0;
      const toolUses = Number(r.tool_use_count) || 0;
      const tokens = (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0);

      const u = users.get(user) ?? {
        user, displayName, sessions: 0, messages: 0, toolUses: 0, activeSeconds: 0, tokens: 0,
        projects: 0, models: [], lastActiveAt: '', projectSet: new Set(), modelSet: new Set(),
      };
      u.sessions++;
      u.messages += messages;
      u.toolUses += toolUses;
      u.activeSeconds += seconds;
      u.tokens += tokens;
      if (displayName > u.displayName) u.displayName = displayName;
      if (r.project_path) u.projectSet.add(r.project_path);
      if (r.model) u.modelSet.add(r.model);
      if (startTime > u.lastActiveAt) u.lastActiveAt = startTime;
      users.set(user, u);

      const project = (r.project_path as string | null) ?? '(unknown)';
      const p = projects.get(project) ?? {
        project, sessions: 0, users: 0, activeSeconds: 0, messages: 0, tokens: 0, lastActiveAt: '', userSet: new Set(),
      };
      p.sessions++;
      p.userSet.add(user);
      p.activeSeconds += seconds;
      p.messages += messages;
      p.tokens += tokens;
      if (startTime > p.lastActiveAt) p.lastActiveAt = startTime;
      projects.set(project, p);

      const model = (r.model as string | null) ?? '(unknown)';
      const m = models.get(model) ?? { model, sessions: 0, tokens: 0 };
      m.sessions++;
      m.tokens += tokens;
      models.set(model, m);

      const day = startTime.slice(0, 10);
      const d = days_.get(day) ?? { day, sessions: 0, users: 0, activeSeconds: 0, userSet: new Set() };
      d.sessions++;
      d.userSet.add(user);
      d.activeSeconds += seconds;
      days_.set(day, d);
    }

    const byUser: UsageByUser[] = [...users.values()]
      .map(({ projectSet, modelSet, ...u }) => ({ ...u, projects: projectSet.size, models: [...modelSet].sort() }))
      .sort((a, b) => b.sessions - a.sessions);
    const byProject: UsageByProject[] = [...projects.values()]
      .map(({ userSet, ...p }) => ({ ...p, users: userSet.size }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 50);
    const byModel: UsageByModel[] = [...models.values()].sort((a, b) => b.sessions - a.sessions);
    const daily: UsageDaily[] = [...days_.values()]
      .map(({ userSet, ...d }) => ({ ...d, users: userSet.size }))
      .sort((a, b) => a.day.localeCompare(b.day));

    const summary = {
      totalSessions: byUser.reduce((s, u) => s + u.sessions, 0),
      activeUsers: byUser.length,
      totalActiveSeconds: byUser.reduce((s, u) => s + u.activeSeconds, 0),
      totalMessages: byUser.reduce((s, u) => s + u.messages, 0),
      totalTokens: byUser.reduce((s, u) => s + u.tokens, 0),
    };

    return { byUser, byProject, byModel, daily, summary };
  }

  /** Kept for API compatibility — the shared DB connection is process-wide. */
  async close(): Promise<void> {
    /* no-op */
  }
}
