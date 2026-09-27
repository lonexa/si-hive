import type { AccountConfig } from './providers/types.js';
import type { IntegrationConnection } from './integrations/types.js';

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

export type ProviderId = 'claude' | 'gemini' | 'codex';

export interface ProviderConfig {
  enabled: boolean;
  customPath?: string;
  /**
   * Extra credential identities beyond the implicit default. Shape is defined
   * once in providers/types.ts and imported here so the two ProviderConfig
   * declarations cannot drift on the account fields.
   */
  accounts?: AccountConfig[];
  /** Account id preselected in launch dialogs. Defaults to `default`. */
  defaultAccount?: string;
}

export interface ProvidersConfig {
  primary: ProviderId;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  /** Provider used for PR code reviews (defaults to primary) */
  reviewProvider?: ProviderId;
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
  provider?: ProviderId;
  /** True when this session is excluded from every shared/logged destination. */
  incognito?: boolean;
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

export interface ProjectConfig {
  name: string;
  path: string;
}

export interface NotificationConfig {
  macOS: boolean;
  browser: boolean;
}

export interface LaunchFlags {
  autoMode: boolean;
  dangerouslySkipPermissions: boolean;
}

export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  apiVersion: string;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface GmailTokenConfig {
  refreshToken: string;
  accessToken: string;
  tokenExpiry: string;
}

export interface UserConfig {
  email: string;
  displayName: string;
}

export interface ClaudeCodeConfig {
  installed: boolean;
  exePath: string;
}

/** Login settings (`config.auth`) — see auth/settings.ts. */
export type AuthConfig = import('./auth/settings.js').AuthSettings;

export interface HiveConfig {
  projects: ProjectConfig[];
  claudeHome: string;
  server: {
    port: number;
  };
  notifications: NotificationConfig;
  projectsRoot: string;
  theme: 'dark' | 'light';
  /** Extra folders scanned for local project checkouts (in addition to projectsRoot). */
  projectRoots?: string[];
  /** Configured git-host / tracker connections (see integrations/types.ts). */
  integrations?: IntegrationConnection[];
  /** Per-project overrides, keyed by absolute project path. */
  projectIntegrations?: Record<string, ProjectIntegrationPrefs>;
  azureOpenAI?: AzureOpenAIConfig;
  sharingDrivePath?: string;
  launchFlags?: LaunchFlags;
  aiProviders?: ProvidersConfig;
  /** Local model servers Claude Code sessions can run on (see local-models/). */
  localModels?: import('./local-models/endpoints.js').LocalModelsConfig;
  // Lite fields (merged)
  google?: GoogleOAuthConfig;
  gmail?: GmailTokenConfig;
  user?: UserConfig;
  claudeCode?: ClaudeCodeConfig;
  // Auth (new)
  auth?: AuthConfig;
  // Per-user sidebar navigation preferences (persona, layout, show/hide)
  nav?: NavPrefs;
  /**
   * Keys owned by optional modules (and future extensions). Unknown top-level
   * keys are preserved on load/save rather than silently dropped.
   */
  [extensionKey: string]: unknown;
}

export interface ProjectIntegrationPrefs {
  /** Connection id of the tracker for this project, or 'none' to disable. */
  tracker?: string;
  /** Connection id of the git host (normally auto-detected from the remote). */
  git?: string;
}

/**
 * Per-user navigation preferences. Stored in the local ~/.hive/config.json
 * (each user runs their own Hive instance, so this is inherently per-user).
 * Purely a UI layout concern — it never grants access; role gating still
 * decides which items are reachable.
 */
export interface NavPrefs {
  /** Chosen persona preset, or 'custom' once the user hand-tweaks the layout. */
  persona?: 'developer' | 'manager' | 'pm' | 'custom';
  /** Route to land on when opening the app (defaults to the dashboard). */
  homeRoute?: string;
  /** Item routes the user has hidden from the sidebar. */
  hidden?: string[];
  /** Section ids in the user's preferred order. */
  sectionOrder?: string[];
  /** Per-section item route ordering: sectionId -> ordered routes. */
  itemOrder?: Record<string, string[]>;
  /** Item routes pinned to the Favorites group. */
  favorites?: string[];
  /** Section ids the user has collapsed. */
  collapsedSections?: string[];
}

export interface SendInputRequest {
  paneId: string;
  input: string;
  type: 'approve' | 'reject' | 'abort' | 'text';
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

export interface StopHookPayload {
  session_id: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
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

export interface ScheduledTask {
  name: string;
  skillContent: string;
  filePath: string;
  modifiedAt: string;
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
  provider?: ProviderId;
  /** Max active (non-merged/closed) PRs from this schedule before skipping new runs. 0 = unlimited. */
  maxActivePrs?: number;
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

// --- Session Template types ---

export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  projectPath: string;
  initialPrompt: string;
  permissionMode: 'default' | 'plan' | 'bypassPermissions';
  model?: string;
  provider?: 'claude' | 'gemini' | 'codex';
  tags: string[];
  category: string;
  icon?: string;
  contextPaths: string[];
  usageCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Saved Prompt types ---

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
  // Lite WS message types (merged)
  | 'health'
  | 'terminal_output'
  | 'gmail_connected'
  | 'todo_generated'
  | 'workflow_run_started'
  | 'workflow_run_completed'
  | 'force_update';

export interface WsMessage {
  version: 1;
  type: WsMessageType;
  payload: unknown;
}

// --- Lite compatibility aliases ---
// After merging Full+Lite, Lite route handlers reference these types.
// These aliases let them work with the unified types.
export type LiteConfig = HiveConfig;
export type LiteWsMessageType = WsMessageType;
export type LiteWsMessage = WsMessage;

