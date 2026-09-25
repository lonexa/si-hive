import { create } from 'zustand';

export type WorkflowType = 'scrape' | 'browser' | 'api' | 'monitor' | 'action';

/** A built-in Hive action that can be created as a Team Workflow automation. */
export interface Automation {
  kind: string;
  label: string;
  description: string;
  defaultCron: string;
  /** Claim granularity — 'weekly' (Monday-of-week) or 'daily' (today). Defaults to 'weekly'. */
  anchor?: 'weekly' | 'daily';
  /** Notify template the wizard pre-selects when adding an email connector for this action. */
  defaultEmailTemplate?: NotifyDirective['template'];
}

export interface Workflow {
  id: number;
  name: string;
  description: string;
  type: WorkflowType;
  templateId: string | null;
  definition: string;
  cronExpression: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  maxRunsKept: number;
  scope?: 'personal' | 'team';
  isDistribution?: boolean;
  subscriberCount?: number;
  isSubscribed?: boolean;
  ownerName?: string | null;
  lastClaimedBy?: string | null;
  userId?: string | null;
  createdAt: string;
  updatedAt: string;
  recentRuns?: WorkflowRun[];
}

export interface WorkflowRun {
  id: number;
  workflowId: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  output: string | null;
  errorMessage: string | null;
  screenshotPath: string | null;
  dataJson: string | null;
  /** Non-fatal: run produced output but a notification (e.g. distribution email) failed to deliver. */
  notifyError?: string | null;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  type: string;
  icon: string;
  defaultCron: string;
  promptHint: string;
}

export interface WorkflowCredential {
  id: number;
  label: string;
  siteUrl: string;
  username: string;
  createdAt: string;
}

export type ConnectorType = 'email' | 'slack' | 'google-chat' | 'webhook';

export interface Connector {
  id: number;
  type: ConnectorType;
  name: string;
  isSystem: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface NotifyDirective {
  connector: string;
  template: 'summary_table' | 'summary_text' | 'raw_data' | 'raw_html';
  lookbackRuns?: number;
  subject?: string;
  message?: string;
  /**
   * Explicit email recipients. Sent via the central SMTP relay, so a team
   * workflow delivers the same way no matter whose machine runs it. Leave empty
   * to fall back to subscribers (distributions) or the workflow owner.
   */
  recipients?: string[];
}

export interface WorkflowRecipe {
  id: number;
  name: string;
  description: string;
  type: string;
  definition: string;
  tags: string | null;
  author: string | null;
  version: number;
  requiresCredential: boolean;
  credentialHint: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowState {
  workflows: Workflow[];
  teamWorkflows: Workflow[];
  selectedWorkflow: Workflow | null;
  runs: WorkflowRun[];
  templates: WorkflowTemplate[];
  credentials: WorkflowCredential[];
  connectors: Connector[];
  recipes: WorkflowRecipe[];
  loading: boolean;
  generating: boolean;
  error: string | null;

  setWorkflows: (workflows: Workflow[]) => void;
  setTeamWorkflows: (teamWorkflows: Workflow[]) => void;
  setSelectedWorkflow: (workflow: Workflow | null) => void;
  setRuns: (runs: WorkflowRun[]) => void;
  setTemplates: (templates: WorkflowTemplate[]) => void;
  setCredentials: (credentials: WorkflowCredential[]) => void;
  setConnectors: (connectors: Connector[]) => void;
  setRecipes: (recipes: WorkflowRecipe[]) => void;
  addWorkflow: (workflow: Workflow) => void;
  updateWorkflow: (id: number, updates: Partial<Workflow>) => void;
  removeWorkflow: (id: number) => void;
  setLoading: (loading: boolean) => void;
  setGenerating: (generating: boolean) => void;
  setError: (error: string | null) => void;
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  workflows: [],
  teamWorkflows: [],
  selectedWorkflow: null,
  runs: [],
  templates: [],
  credentials: [],
  connectors: [],
  recipes: [],
  loading: false,
  generating: false,
  error: null,

  setWorkflows: (workflows) => set({ workflows }),
  setTeamWorkflows: (teamWorkflows) => set({ teamWorkflows }),
  setSelectedWorkflow: (workflow) => set({ selectedWorkflow: workflow }),
  setRuns: (runs) => set({ runs }),
  setTemplates: (templates) => set({ templates }),
  setCredentials: (credentials) => set({ credentials }),
  setConnectors: (connectors) => set({ connectors }),
  setRecipes: (recipes) => set({ recipes }),
  addWorkflow: (workflow) => set((s) => ({ workflows: [workflow, ...s.workflows] })),
  updateWorkflow: (id, updates) => set((s) => ({
    workflows: s.workflows.map((w) => w.id === id ? { ...w, ...updates } : w),
    teamWorkflows: s.teamWorkflows.map((w) => w.id === id ? { ...w, ...updates } : w),
    selectedWorkflow: s.selectedWorkflow?.id === id ? { ...s.selectedWorkflow, ...updates } : s.selectedWorkflow,
  })),
  removeWorkflow: (id) => set((s) => ({
    workflows: s.workflows.filter((w) => w.id !== id),
    selectedWorkflow: s.selectedWorkflow?.id === id ? null : s.selectedWorkflow,
  })),
  setLoading: (loading) => set({ loading }),
  setGenerating: (generating) => set({ generating }),
  setError: (error) => set({ error }),
}));
