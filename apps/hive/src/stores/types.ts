import type { ProviderId } from '@/lib/launch-flags';

// Re-exported so consumers can keep importing it from the store's type
// barrel (dashboard-store and friends already do).
export type { ProviderId };

export interface Team {
  name: string;
  description: string;
  members: TeamMember[];
  createdAt: string;
  leadAgentId: string;
  leadSessionId: string;
  stale: boolean;
}

export interface TeamMember {
  name: string;
  agentId: string;
  agentType: string;
  model: string;
  tmuxPaneId: string;
  cwd: string;
  color: string;
  isActive: boolean;
  backendType: string;
  joinedAt: string;
}

export interface TeamTask {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner: string;
  blocks: string[];
  blockedBy: string[];
}

export interface Session {
  id: string;
  project: string;
  projectDir: string;
  status: 'working' | 'waiting-approval' | 'waiting-input' | 'done' | 'paused' | 'idle' | 'error';
  lastActivity: string;
  feature?: string;
  model?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  slug?: string;
  initialPrompt?: string;
  latestPrompt?: string;
  tasksId?: string;
  paneId?: string;
  terminalApp?: 'iterm2' | 'warp' | 'terminal' | 'tmux' | 'windows-terminal' | 'conemu' | 'pwsh' | 'cmd' | 'mintty' | 'unknown';
  isSubagent: boolean;
  parentSessionId?: string;
  agentId?: string;
  subagentIds: string[];
  fileSize: number;
  /** AI provider that owns this session. Sent by the aggregator; the type had
   *  drifted from apps/hive/server/types.ts, which has carried it all along. */
  provider?: ProviderId;
  /** True when this session is excluded from every shared/logged destination. */
  incognito?: boolean;
}

// Mirrors apps/hive/server/types.ts — the server owns these shapes and sends
// them over /api/templates and /api/prompts.
export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  projectPath: string;
  initialPrompt: string;
  permissionMode: 'default' | 'plan' | 'bypassPermissions';
  model?: string;
  provider?: ProviderId;
  tags: string[];
  category: string;
  icon?: string;
  contextPaths: string[];
  usageCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  description: string;
  tags: string[];
  category: string;
  usageCount: number;
  isFavorite: boolean;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectGroup {
  name: string;
  dirName: string;
  sessions: Session[];
}

export interface HookEvent {
  id: string;
  type: string;
  sessionId: string;
  timestamp: string;
  message: string;
  project?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationConfig {
  macOS: boolean;
  browser: boolean;
}

export interface AppConfig {
  notifications: NotificationConfig;
  projectsRoot: string;
  theme: 'dark' | 'light';
}

export interface SendInputRequest {
  paneId: string;
  input: string;
  type: 'approve' | 'reject' | 'abort' | 'text';
}

export interface SessionActivity {
  sessionId: string;
  tool?: string;
  detail?: string;
  thinking?: boolean;
  model?: string;
  lastSeen: string;
  active: boolean;
}

// --- Task Queue types ---

export interface TaskQueue {
  sessionId: string;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

export type QueueTaskStatus = 'pending' | 'sending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface QueueTask {
  id: string;
  sessionId: string;
  position: number;
  prompt: string;
  status: QueueTaskStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

// --- Scheduled Tasks / Live Loops types ---

export interface ScheduledTask {
  name: string;
  skillContent: string;
  filePath: string;
  modifiedAt: string;
}

export interface LiveLoop {
  id: string;
  sessionId: string;
  interval: string;
  prompt: string;
  status: 'active' | 'stopped' | 'session_ended';
  createdAt: string;
  stoppedAt?: string;
  source: 'hive' | 'tracker';
  /** Tracker issue key when the loop was started from a ticket. */
  ticketId?: string;
}

export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  cronExpression?: string;
  intervalMs?: number;
  projectPath?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  launchFlags?: { dangerouslySkipPermissions?: boolean; autoMode?: boolean };
  maxRunsKept: number;
  type?: 'claude-prompt' | 'pr-review-pipeline';
}

export type ScheduleRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  output: string;
  status: ScheduleRunStatus;
  errorMessage?: string;
}

export interface DashboardState {
  teams: Team[];
  sessions: Session[];
  projects: ProjectGroup[];
  tasksByTeam: Record<string, TeamTask[]>;
  tasksBySession: Record<string, TeamTask[]>;
  events: HookEvent[];
  sessionActivities: Record<string, SessionActivity>;
  queues: Record<string, { queue: TaskQueue; tasks: QueueTask[] }>;
  scheduledTasks: ScheduledTask[];
  schedules: Schedule[];
  liveLoops: LiveLoop[];
  lastUpdated: string;
}

// --- Insights types ---

export interface StatsCache {
  version: number;
  lastComputedDate: string;
  dailyActivity: DailyActivity[];
  dailyModelTokens: { date: string; tokensByModel: Record<string, number> }[];
  modelUsage: Record<string, ModelUsageEntry>;
  totalSessions: number;
  totalMessages: number;
  longestSession: { sessionId: string; duration: number; messageCount: number; timestamp: string };
  firstSessionDate: string;
  hourCounts: Record<string, number>;
  totalSpeculationTimeSavedMs: number;
}

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface ModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface PromptEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId: string;
  provider?: ProviderId;
}

export interface PlanEntry {
  slug: string;
  title: string;
  content: string;
  modifiedAt: string;
  filePath?: string;
}

export type WsMessageType =
  | 'full_state'
  | 'sessions_updated'
  | 'projects_updated'
  | 'teams_updated'
  | 'tasks_updated'
  | 'event_added'
  | 'events_updated'
  | 'session_activities_updated'
  | 'config_updated'
  | 'notification_fired'
  | 'queues_updated'
  | 'scheduled_tasks_updated'
  | 'schedules_updated'
  | 'schedule_run_update'
  | 'live_loops_updated'
  | 'force_update';

export interface WsMessage {
  version: 1;
  type: WsMessageType;
  payload: unknown;
}

// --- Developer Insights types ---

export interface ProjectActivity {
  project: string;
  sessionsTotal: number;
  sessionsThisWeek: number;
  sessionsToday: number;
  lastActive: string;
  promptCount: number;
}

export interface GitProjectStats {
  project: string;
  projectDir: string;
  linesAdded: number;
  linesDeleted: number;
  commits: number;
  period: string;
}

export interface TicketStats {
  configured: boolean;
  activeTickets: number;
  completedThisSprint: number;
  inProgress: number;
  testing: number;
}

export interface KBStats {
  configured: boolean;
  totalEntries: number;
  recentEntries: { title: string; category: string; created_at: string }[];
  categoryCounts: Record<string, number>;
}

export interface DeveloperInsights {
  projectActivity: ProjectActivity[];
  gitStats: GitProjectStats[];
  ticketStats: TicketStats | null;
  kbStats: KBStats | null;
  currentStreak: number;
  longestStreak: number;
  mostActiveProject: string;
  mostActiveDay: string;
  peakHour: number;
  totalDaysActive: number;
}
