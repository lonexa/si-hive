import { create } from 'zustand';
import { API_BASE } from '@/lib/api-config';
import type { DashboardState, Session, HookEvent, Team, TeamTask, SessionActivity, NotificationConfig, AppConfig, ProjectGroup, TaskQueue, QueueTask, ScheduledTask, LiveLoop, Schedule, ProviderId } from './types';

export type { ProviderId } from './types';

export interface ProviderStatus {
  id: ProviderId;
  displayName: string;
  installed: boolean;
  enabled: boolean;
  isPrimary: boolean;
  resolvedPath: string | null;
}

export interface ProvidersConfig {
  primary: ProviderId;
  providers: Partial<Record<ProviderId, { enabled: boolean; customPath?: string }>>;
}

export interface GridCell {
  id: string;
  sessionId: string | null;
  /** Spawn config — how the PTY was started (set once, never changes) */
  cwd?: string;
  command?: string;
  args?: string[];
  label?: string;
  /** Prompt to auto-type after CLI is ready (one-shot, stripped on reload) */
  initialPrompt?: string;
  /** AI provider for this terminal */
  provider?: ProviderId;
}

/** @deprecated Use GridCell spawn fields directly */
export type AdhocTerminal = {
  cwd: string;
  command: string;
  args?: string[];
  label: string;
  initialPrompt?: string;
  provider?: ProviderId;
};

const STORAGE_KEY_GRID = 'hive-grid-layout';
const STORAGE_KEY_GRID_TAB = 'hive-grid-layout-tab'; // per-tab (sessionStorage)
const STORAGE_KEY_VIEW = 'hive-sessions-view';
const STORAGE_KEY_FILTER = 'hive-sessions-time-filter';

function loadGridCells(): GridCell[] {
  // 1. Try per-tab sessionStorage first (survives same-tab navigation)
  //    Strip initialPrompt — prompts are one-shot, never re-sent on reload.
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_GRID_TAB);
    if (raw) {
      const parsed = JSON.parse(raw) as GridCell[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(c => {
          // Migrate legacy adhoc cells to flat fields
          const migrated = migrateAdhoc(c);
          return migrated.initialPrompt ? { ...migrated, initialPrompt: undefined } : migrated;
        });
      }
    }
  } catch { /* ignore */ }

  // 2. If this tab has pending spawn data (DevOps "Open in AI"),
  //    don't reset the grid — the spawn effect in TerminalGridView will add
  //    the new cell. Return a single empty cell only as a fresh-tab fallback;
  //    the localStorage path below may still provide existing cells.
  if (sessionStorage.getItem('hive-terminal-spawn')) {
    // Fall through to localStorage check so existing cells are preserved
  }

  // 3. Fall back to localStorage (shared, provides initial layout for fresh tabs)
  //    Strip spawn config since those PTYs belong to other tabs.
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GRID);
    if (raw) {
      const parsed = JSON.parse(raw) as GridCell[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const cleaned: GridCell[] = parsed.map(c => ({
          id: c.id,
          sessionId: c.sessionId,
        }));
        saveGridCells(cleaned);
        return cleaned;
      }
    }
  } catch { /* ignore */ }

  return [{ id: crypto.randomUUID(), sessionId: null }];
}

/** Migrate legacy adhoc cells to flat GridCell fields */
function migrateAdhoc(c: GridCell & { adhoc?: AdhocTerminal; projectPath?: string }): GridCell {
  if (c.adhoc) {
    return {
      id: c.id,
      sessionId: c.sessionId,
      cwd: c.adhoc.cwd,
      command: c.adhoc.command,
      args: c.adhoc.args,
      label: c.adhoc.label,
      initialPrompt: c.adhoc.initialPrompt,
      provider: c.adhoc.provider,
    };
  }
  // Migrate projectPath to cwd
  if (c.projectPath) {
    return { id: c.id, sessionId: c.sessionId, cwd: c.projectPath };
  }
  return c;
}

function saveGridCells(cells: GridCell[]) {
  // Save to both: sessionStorage for per-tab state, localStorage for persistence
  try { sessionStorage.setItem(STORAGE_KEY_GRID_TAB, JSON.stringify(cells)); } catch { /* ignore */ }
  try { localStorage.setItem(STORAGE_KEY_GRID, JSON.stringify(cells)); } catch { /* ignore */ }
}

interface DashboardStore extends DashboardState {
  connected: boolean;
  notificationConfig: NotificationConfig;
  projectsRoot: string;
  theme: 'dark' | 'light';
  notificationFired: Record<string, number>;

  // AI Provider state
  aiProviders: ProvidersConfig;
  providerStatus: ProviderStatus[];
  primaryProviderId: ProviderId;

  // Update availability
  updatesAvailable: boolean;
  setUpdatesAvailable: (available: boolean) => void;

  // Grid layout persistence
  gridCells: GridCell[];
  gridMaximizedCellId: string | null;
  sessionsView: 'kanban' | 'tree' | 'grid';
  sessionsTimeFilter: '1h' | '24h' | 'all';

  setFullState: (state: DashboardState) => void;
  updateSessions: (sessions: Session[]) => void;
  updateProjects: (projects: ProjectGroup[]) => void;
  updateTeams: (teams: Team[]) => void;
  updateTasks: (tasksByTeam: Record<string, TeamTask[]>, tasksBySession?: Record<string, TeamTask[]>) => void;
  addEvent: (event: HookEvent) => void;
  updateEvents: (events: HookEvent[]) => void;
  setConnected: (connected: boolean) => void;
  updateSessionActivities: (activities: Record<string, SessionActivity>) => void;
  updateNotificationConfig: (config: NotificationConfig) => void;
  updateAppConfig: (config: Partial<AppConfig>) => void;
  addNotificationFired: (sessionId: string) => void;
  updateQueues: (queues: Record<string, { queue: TaskQueue; tasks: QueueTask[] }>) => void;
  updateScheduledTasks: (tasks: ScheduledTask[]) => void;
  updateLiveLoops: (loops: LiveLoop[]) => void;
  updateSchedules: (schedules: Schedule[]) => void;
  updateProviders: (aiProviders: ProvidersConfig, providerStatus: ProviderStatus[]) => void;
  deleteTeam: (teamName: string) => Promise<void>;

  // Grid layout actions
  setGridCells: (cells: GridCell[]) => void;
  setGridMaximizedCellId: (cellId: string | null) => void;
  setSessionsView: (view: 'kanban' | 'tree' | 'grid') => void;
  setSessionsTimeFilter: (filter: '1h' | '24h' | 'all') => void;
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  teams: [],
  sessions: [],
  projects: [],
  tasksByTeam: {},
  tasksBySession: {},
  events: [],
  sessionActivities: {},
  queues: {},
  scheduledTasks: [],
  schedules: [],
  liveLoops: [],
  lastUpdated: '',
  connected: false,
  notificationConfig: { macOS: true, browser: true },
  projectsRoot: '',
  theme: (localStorage.getItem('hive-theme') as 'dark' | 'light') || 'dark',
  notificationFired: {},

  // Update availability
  updatesAvailable: false,
  setUpdatesAvailable: (available) => set({ updatesAvailable: available }),

  // AI Provider defaults
  aiProviders: { primary: 'claude', providers: { claude: { enabled: true } } },
  providerStatus: [],
  primaryProviderId: 'claude',

  // Grid layout persistence defaults (loaded from localStorage)
  gridCells: loadGridCells(),
  gridMaximizedCellId: null,
  sessionsView: (localStorage.getItem(STORAGE_KEY_VIEW) as 'kanban' | 'tree' | 'grid') || 'kanban',
  sessionsTimeFilter: (localStorage.getItem(STORAGE_KEY_FILTER) as '1h' | '24h' | 'all') || '1h',

  setFullState: (state) =>
    set({
      teams: state.teams ?? [],
      sessions: state.sessions ?? [],
      projects: state.projects ?? [],
      tasksByTeam: state.tasksByTeam ?? {},
      tasksBySession: state.tasksBySession ?? {},
      events: state.events ?? [],
      queues: state.queues ?? {},
      scheduledTasks: state.scheduledTasks ?? [],
      schedules: state.schedules ?? [],
      liveLoops: state.liveLoops ?? [],
      lastUpdated: state.lastUpdated || new Date().toISOString(),
    }),

  updateSessions: (sessions) =>
    set({ sessions, lastUpdated: new Date().toISOString() }),

  updateProjects: (projects) =>
    set({ projects, lastUpdated: new Date().toISOString() }),

  updateTeams: (teams) =>
    set({ teams, lastUpdated: new Date().toISOString() }),

  updateTasks: (tasksByTeam, tasksBySession) =>
    set((state) => ({
      tasksByTeam,
      tasksBySession: tasksBySession ?? state.tasksBySession,
      lastUpdated: new Date().toISOString(),
    })),

  addEvent: (event) =>
    set((state) => ({
      events: [event, ...state.events].slice(0, 200),
      lastUpdated: new Date().toISOString(),
    })),

  updateEvents: (events) =>
    set({ events, lastUpdated: new Date().toISOString() }),

  setConnected: (connected) => set({ connected }),

  updateSessionActivities: (activities) =>
    set((state) => ({
      sessionActivities: { ...state.sessionActivities, ...activities },
    })),

  updateNotificationConfig: (config) =>
    set({ notificationConfig: config }),

  updateAppConfig: (config) =>
    set(() => ({
      ...(config.notifications ? { notificationConfig: config.notifications } : {}),
      ...(config.projectsRoot !== undefined ? { projectsRoot: config.projectsRoot } : {}),
      ...(config.theme ? { theme: config.theme } : {}),
    })),

  addNotificationFired: (sessionId) =>
    set((state) => ({
      notificationFired: { ...state.notificationFired, [sessionId]: Date.now() },
    })),

  updateQueues: (queues) =>
    set({ queues, lastUpdated: new Date().toISOString() }),

  updateScheduledTasks: (scheduledTasks) =>
    set({ scheduledTasks, lastUpdated: new Date().toISOString() }),

  updateLiveLoops: (liveLoops) =>
    set({ liveLoops, lastUpdated: new Date().toISOString() }),

  updateSchedules: (schedules) =>
    set({ schedules, lastUpdated: new Date().toISOString() }),

  updateProviders: (aiProviders, providerStatus) =>
    set({ aiProviders, providerStatus, primaryProviderId: aiProviders.primary }),

  // Grid layout actions (persist to localStorage)
  setGridCells: (cells) => {
    saveGridCells(cells);
    set({ gridCells: cells });
  },
  setGridMaximizedCellId: (cellId) => set({ gridMaximizedCellId: cellId }),
  setSessionsView: (view) => {
    try { localStorage.setItem(STORAGE_KEY_VIEW, view); } catch { /* ignore */ }
    set({ sessionsView: view });
  },
  setSessionsTimeFilter: (filter) => {
    try { localStorage.setItem(STORAGE_KEY_FILTER, filter); } catch { /* ignore */ }
    set({ sessionsTimeFilter: filter });
  },

  deleteTeam: async (teamName) => {
    try {
      const res = await fetch(`${API_BASE}/api/teams/${encodeURIComponent(teamName)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        console.error('Failed to delete team:', data.error);
      }
    } catch (err) {
      console.error('Failed to delete team:', err);
    }
  },
}));
