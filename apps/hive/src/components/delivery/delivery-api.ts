/**
 * Client-side shapes + fetch helper for the Delivery module API
 * (server/delivery/routes.ts). Types mirror server/integrations/types.ts and
 * server/delivery/feeds.ts — keep them in sync when those change.
 */
import { API_BASE } from '@/lib/api-config';

export type StateCategory = 'todo' | 'in_progress' | 'done';

export interface Person {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface Issue {
  id: string;
  key: string;
  title: string;
  description?: string;
  state: string;
  stateCategory: StateCategory;
  type?: string;
  assignee?: Person | null;
  labels: string[];
  priority?: string;
  iteration?: string;
  url: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IssueComment {
  id: string;
  author: Person | null;
  body: string;
  createdAt: string;
}

export interface Iteration {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
}

export interface WorkStatus {
  tracker: {
    connected: boolean;
    connectionId?: string;
    label?: string;
    provider?: string;
    capabilities?: string[];
    ticketRefPattern?: string;
  };
  gitHosts: { connectionId: string; label: string; provider?: string }[];
  ai: boolean;
}

export type PullRequestState = 'open' | 'closed' | 'merged' | 'draft';

export interface PullRequest {
  id: string;
  number: number;
  repo: string;
  title: string;
  description?: string;
  state: PullRequestState;
  author: Person | null;
  sourceBranch: string;
  targetBranch: string;
  headSha?: string;
  url: string;
  createdAt: string;
  updatedAt?: string;
  reviewers?: Person[];
  labels?: string[];
}

export interface PrComment {
  id: string;
  author: Person | null;
  body: string;
  createdAt: string;
  path?: string;
  line?: number;
}

export interface PrDetail {
  pr: PullRequest;
  comments: PrComment[];
  diff: string;
  capabilities: string[];
  localPath: string | null;
}

export interface LocalRepoInfo {
  path: string;
  remoteUrl: string;
  connectionId: string;
  repo: string;
  connectionLabel?: string;
}

export interface LandedCommit {
  sha: string;
  message: string;
  author: Person | null;
  date: string;
  url: string;
  repo: string;
  connectionId: string;
}

export interface LandedFeed {
  days: { date: string; commits: LandedCommit[] }[];
  highlights?: string;
  warnings: string[];
}

export interface BuildFailure {
  id: string;
  buildId: string;
  definition: string;
  buildNumber: string;
  repo: string;
  connectionId: string;
  branch?: string;
  finishTime: string;
  url: string;
  triage?: string;
}

export interface BuildFailuresFeed {
  failures: BuildFailure[];
  warnings: string[];
}

/** JSON fetch against the Hive server; throws with the server's `error` text on non-2xx. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const hasBody = init?.body !== undefined;
  const res = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? 'GET',
    credentials: 'include',
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export function issuePath(key: string, sub = ''): string {
  return `/api/work/issues/${encodeURIComponent(key)}${sub}`;
}

export function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeLocal(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
