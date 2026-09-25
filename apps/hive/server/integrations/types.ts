/**
 * Integration provider contracts.
 *
 * Hive talks to external git hosts (GitHub, GitLab, Azure Repos, …) and ticket
 * trackers (GitHub Issues, Jira, Linear, Azure Boards, …) ONLY through these
 * interfaces. Features never import a concrete provider. To add a provider,
 * implement `IntegrationProviderDefinition` in `providers/<id>/index.ts` and
 * register it in `providers/index.ts` — see docs/extending/adding-a-provider.md.
 *
 * Every model is normalized: ids/keys are strings, states carry a
 * `stateCategory` so features can reason about "done" without knowing a
 * provider's workflow vocabulary, and `raw` keeps the provider payload for
 * provider-specific UI.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export interface Person {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

// ---------------------------------------------------------------------------
// Tracker (tickets / issues / work items)
// ---------------------------------------------------------------------------

export type StateCategory = 'todo' | 'in_progress' | 'done';

export interface Issue {
  /** Provider-internal id (may equal `key`). */
  id: string;
  /** Human-facing reference, e.g. `123`, `ABC-42`, `owner/repo#7`. */
  key: string;
  title: string;
  /** Markdown (providers convert HTML/ADF where needed). */
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
  raw?: unknown;
}

export interface IssueComment {
  id: string;
  author: Person | null;
  body: string;
  createdAt: string;
}

export interface IssueQuery {
  /** Free-text search across title/description. */
  text?: string;
  labels?: string[];
  /** `'me'` = the connection's authenticated user. */
  assignee?: 'me' | string;
  stateCategory?: StateCategory[];
  type?: string;
  iterationId?: string;
  limit?: number;
}

export interface NewIssue {
  title: string;
  description?: string;
  type?: string;
  labels?: string[];
  assignee?: 'me' | string;
}

export interface IssuePatch {
  title?: string;
  description?: string;
  /** Provider-native state name. */
  state?: string;
  /** Move to the provider's default state for this category. */
  stateCategory?: StateCategory;
  assignee?: 'me' | string | null;
  labels?: string[];
}

export interface Iteration {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
}

export type TrackerCapability =
  | 'create'
  | 'comment'
  | 'assign'
  | 'transition'
  | 'labels'
  | 'iterations';

export interface TrackerProvider {
  readonly capabilities: ReadonlySet<TrackerCapability>;
  /**
   * Matches ticket references in free text (terminal output, commit
   * messages). Must be global (`g`). If it has capture groups, the first
   * non-empty group is taken as the issue key (e.g. `AB#(\d+)` → `123`);
   * otherwise the whole match is the key.
   */
  readonly ticketRefPattern: RegExp;
  issueUrl(key: string): string;
  whoAmI(): Promise<Person>;
  searchIssues(query: IssueQuery): Promise<Issue[]>;
  getIssue(key: string): Promise<Issue | null>;
  createIssue(input: NewIssue): Promise<Issue>;
  updateIssue(key: string, patch: IssuePatch): Promise<Issue>;
  addComment(key: string, body: string): Promise<IssueComment>;
  listComments(key: string): Promise<IssueComment[]>;
  /** Only when `capabilities.has('iterations')`. */
  listIterations?(): Promise<Iteration[]>;
}

// ---------------------------------------------------------------------------
// Git host (repos / pull requests / commits / CI)
// ---------------------------------------------------------------------------

export interface Repo {
  id: string;
  /** e.g. `owner/name`, `group/sub/name`, `project/repo`. */
  fullName: string;
  name: string;
  defaultBranch: string;
  webUrl: string;
  cloneUrl: string;
  private?: boolean;
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
  /** Latest commit on the source branch, when the provider reports it. */
  headSha?: string;
  url: string;
  createdAt: string;
  updatedAt?: string;
  reviewers?: Person[];
  labels?: string[];
  raw?: unknown;
}

export interface PrComment {
  id: string;
  author: Person | null;
  body: string;
  createdAt: string;
  /** Present for inline (file/line) comments. */
  path?: string;
  line?: number;
}

export interface Commit {
  sha: string;
  message: string;
  author: Person | null;
  date: string;
  url: string;
}

export type BuildStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Build {
  id: string;
  name: string;
  status: BuildStatus;
  branch?: string;
  commitSha?: string;
  url: string;
  startedAt?: string;
  finishedAt?: string;
}

export type GitHostCapability = 'pullRequests' | 'reviews' | 'merge' | 'builds' | 'archive';

export interface GitHostProvider {
  readonly capabilities: ReadonlySet<GitHostCapability>;
  whoAmI(): Promise<Person>;
  listRepos(): Promise<Repo[]>;
  getRepo(fullName: string): Promise<Repo | null>;
  listPullRequests(repo: string, opts?: { state?: 'open' | 'closed' | 'all'; limit?: number }): Promise<PullRequest[]>;
  getPullRequest(repo: string, number: number): Promise<PullRequest | null>;
  getPullRequestDiff(repo: string, number: number): Promise<string>;
  listPrComments(repo: string, number: number): Promise<PrComment[]>;
  commentOnPr(repo: string, number: number, body: string): Promise<PrComment>;
  approvePr?(repo: string, number: number, body?: string): Promise<void>;
  mergePr?(repo: string, number: number): Promise<void>;
  listCommits(repo: string, opts?: { branch?: string; since?: string; limit?: number }): Promise<Commit[]>;
  listBuilds?(repo: string, opts?: { branch?: string; limit?: number }): Promise<Build[]>;
  getBuildLog?(repo: string, buildId: string): Promise<string>;
  /** Zip archive of `ref` (used by the updater). */
  downloadArchive?(repo: string, ref: string): Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Provider definitions (what a provider package exports)
// ---------------------------------------------------------------------------

export type IntegrationKind = 'git' | 'tracker';

/** Declarative settings field — Settings → Integrations renders forms from these. */
export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'url' | 'secret' | 'select' | 'boolean';
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** Link to the provider's docs for creating the credential. */
  helpUrl?: string;
  options?: { value: string; label: string }[];
  default?: string | boolean;
}

export interface ConnectionContext {
  /** Non-secret settings entered by the user (keys from `configSchema`). */
  settings: Record<string, string | boolean | undefined>;
  /** Secret settings (fields of type `secret`), resolved from the credential store. */
  secrets: Record<string, string | undefined>;
}

export interface IntegrationProviderDefinition {
  id: string;
  displayName: string;
  /** lucide-react icon name used in the UI. */
  icon: string;
  kinds: IntegrationKind[];
  configSchema: ConfigField[];
  /** Returns true when a git remote URL belongs to this provider + settings. */
  matchesRemote?(remoteUrl: string, settings: ConnectionContext['settings']): boolean;
  /** Parse a remote URL into this provider's repo `fullName`. */
  repoFromRemote?(remoteUrl: string): string | null;
  createGitHost?(ctx: ConnectionContext): GitHostProvider;
  createTracker?(ctx: ConnectionContext): TrackerProvider;
  /** Host (e.g. `github.com`) + token for the git CLI credential helper. */
  gitCredential?(ctx: ConnectionContext): { host: string; username: string; password: string } | null;
}

/** A configured connection, persisted in `config.integrations`. */
export interface IntegrationConnection {
  id: string;
  providerId: string;
  label: string;
  /** Which roles this connection fills. */
  kinds: IntegrationKind[];
  settings: Record<string, string | boolean | undefined>;
  /** Default tracker used when a project has no explicit mapping. */
  defaultTracker?: boolean;
}
