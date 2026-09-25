export type ProviderId = 'claude' | 'gemini' | 'codex';

export interface ProviderStatus {
  id: ProviderId;
  displayName: string;
  installed: boolean;
  enabled: boolean;
  isPrimary: boolean;
  resolvedPath?: string;
  models?: ProviderModel[];
  /** Credential identities, implicit default first. Absent on older servers. */
  accounts?: AccountStatus[];
  /** Account id to preselect. Absent means DEFAULT_ACCOUNT_ID. */
  defaultAccount?: string;
}

/** Reserved id of the account backed by the provider's primary config dir. */
export const DEFAULT_ACCOUNT_ID = 'default';

export interface AccountStatus {
  id: string;
  label: string;
  configDir: string | null;
  /** True once the account's config dir holds credentials. */
  authenticated: boolean;
  isDefault: boolean;
  /** Signed-in identity; only present on the per-account endpoint. */
  email?: string;
  orgName?: string;
  subscriptionType?: string;
}

/**
 * Accounts worth showing a picker for: only those that can actually be launched.
 * An account mid-setup (dir created, login not finished) is filtered out rather
 * than offered, since selecting it would silently fall back to the default.
 */
export function getSelectableAccounts(
  providerId: ProviderId,
  statuses?: ProviderStatus[],
): AccountStatus[] {
  const accounts = statuses?.find((p) => p.id === providerId)?.accounts ?? [];
  return accounts.filter((a) => a.isDefault || a.authenticated);
}

/** Preselected account for a provider, falling back to the default. */
export function getDefaultAccountId(
  providerId: ProviderId,
  statuses?: ProviderStatus[],
): string {
  const status = statuses?.find((p) => p.id === providerId);
  const stored = status?.defaultAccount;
  if (!stored) return DEFAULT_ACCOUNT_ID;
  const selectable = getSelectableAccounts(providerId, statuses);
  return selectable.some((a) => a.id === stored) ? stored : DEFAULT_ACCOUNT_ID;
}

export interface ProviderModel {
  id: string;
  displayName: string;
  description?: string;
}

export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';
export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = 'medium';
export const CODEX_REASONING_EFFORTS: Array<{ id: CodexReasoningEffort; displayName: string; description: string }> = [
  { id: 'low', displayName: 'Low', description: 'Fast responses with lighter reasoning' },
  { id: 'medium', displayName: 'Medium', description: 'Balanced speed and reasoning depth' },
  { id: 'high', displayName: 'High', description: 'Greater reasoning depth for complex work' },
  { id: 'xhigh', displayName: 'Extra High', description: 'Extra depth for difficult problems' },
  { id: 'max', displayName: 'Max', description: 'Maximum reasoning for the hardest problems' },
  { id: 'ultra', displayName: 'Ultra', description: 'Maximum reasoning with delegation when supported' },
];

const DEFAULT_CODEX_REASONING_BY_MODEL: Record<string, CodexReasoningEffort> = {
  [DEFAULT_CODEX_MODEL]: 'medium',
  'gpt-5.6-terra': 'medium',
  'gpt-5.6-luna': 'medium',
  'gpt-5.5': 'xhigh',
  'gpt-5.4': 'medium',
  'gpt-5.4-mini': 'medium',
};

export function getDefaultCodexReasoningEffort(model?: string): CodexReasoningEffort {
  return (model && DEFAULT_CODEX_REASONING_BY_MODEL[model]) || DEFAULT_CODEX_REASONING_EFFORT;
}

export interface LaunchFlags {
  autoMode: boolean;
  dangerouslySkipPermissions: boolean;
}

let cachedFlags: LaunchFlags | null = null;
let cachedPrimaryProvider: ProviderId | null = null;
let cachedProviderStatus: ProviderStatus[] | null = null;

function getApiBase(): string {
  return `${window.location.protocol}//${window.location.host}`;
}

/**
 * Fetch launch flags from the SI Hive config.
 * Caches the result for the lifetime of the page.
 */
export async function getLaunchFlags(): Promise<LaunchFlags> {
  if (cachedFlags) return cachedFlags;
  try {
    const res = await fetch(`${getApiBase()}/api/config`);
    const data = await res.json();
    cachedFlags = data.launchFlags ?? { autoMode: false, dangerouslySkipPermissions: false };
  } catch {
    cachedFlags = { autoMode: false, dangerouslySkipPermissions: false };
  }
  return cachedFlags!;
}

/** Invalidate cached flags (call when user toggles flags on the permissions page). */
export function invalidateLaunchFlagsCache() {
  cachedFlags = null;
  cachedPrimaryProvider = null;
  cachedProviderStatus = null;
}

/**
 * Build the AI CLI args array, prepending any launch flags before the prompt.
 */
export async function buildAIArgs(_prompt: string, options?: {
  contextPaths?: string[];
  model?: string;
  permissionMode?: string;
}): Promise<string[]> {
  const flags = await getLaunchFlags();
  const args: string[] = [];

  // Permission mode from template overrides global flags
  if (options?.permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions');
  } else if (options?.permissionMode === 'autoMode') {
    args.push('--enable-auto-mode');
  } else if (flags.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  } else if (flags.autoMode) {
    args.push('--enable-auto-mode');
  }

  // Model override — skip generic "default" which isn't a valid model ID
  if (options?.model && options.model !== 'default') {
    args.push('--model', options.model);
  }

  // Context preloader: add directories/files
  if (options?.contextPaths?.length) {
    for (const cp of options.contextPaths) {
      args.push('--add-dir', cp);
    }
  }

  // Don't use -p (print mode) — it exits after processing.
  // The prompt will be sent as interactive input after the session starts.
  return args;
}

/** @deprecated Use buildAIArgs instead */
export const buildClaudeArgs = buildAIArgs;

/**
 * Get the primary provider ID from cached config.
 * Falls back to 'claude' if config is unavailable.
 */
export async function getPrimaryProviderId(): Promise<ProviderId> {
  if (cachedPrimaryProvider) return cachedPrimaryProvider;
  try {
    const res = await fetch(`${getApiBase()}/api/config`);
    const data = await res.json();
    cachedPrimaryProvider = (data.aiProviders?.primary as ProviderId) ?? 'claude';
    cachedProviderStatus = data.providerStatus ?? null;
  } catch {
    cachedPrimaryProvider = 'claude';
  }
  return cachedPrimaryProvider;
}

/**
 * Get the full provider status list from cached config.
 */
export async function getProviderStatus(): Promise<ProviderStatus[]> {
  if (cachedProviderStatus) return cachedProviderStatus;
  try {
    const res = await fetch(`${getApiBase()}/api/config`);
    const data = await res.json();
    cachedPrimaryProvider = (data.aiProviders?.primary as ProviderId) ?? 'claude';
    cachedProviderStatus = data.providerStatus ?? [];
  } catch {
    cachedProviderStatus = [];
  }
  // Assigned in both branches above, but TS can't narrow the module-level
  // `ProviderStatus[] | null` across try/catch.
  return cachedProviderStatus ?? [];
}

/** Provider display short names for icons/labels. */
export const PROVIDER_SHORT_NAMES: Record<ProviderId, string> = {
  claude: 'CC',
  gemini: 'G',
  codex: 'CX',
};

export const FALLBACK_PROVIDER_MODELS: Record<ProviderId, ProviderModel[]> = {
  claude: [
    { id: 'claude-fable-5', displayName: 'Fable 5', description: 'Latest flagship model' },
    { id: 'claude-opus-4-8', displayName: 'Opus 4.8', description: 'Latest flagship Opus' },
    { id: 'claude-opus-4-7', displayName: 'Opus 4.7', description: 'Previous Opus' },
    { id: 'claude-opus-4-6', displayName: 'Opus 4.6', description: 'Earlier Opus' },
    { id: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', description: 'Balanced coding model' },
    { id: 'claude-haiku-4-5', displayName: 'Haiku 4.5', description: 'Fast lightweight model' },
  ],
  gemini: [
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', description: 'Most capable Gemini model' },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', description: 'Fast balanced model' },
    { id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', description: 'Lower latency model' },
  ],
  codex: [
    { id: DEFAULT_CODEX_MODEL, displayName: 'GPT-5.6 Sol', description: 'Latest frontier agentic coding model' },
    { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', description: 'Balanced agentic coding model' },
    { id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', description: 'Fast affordable agentic coding model' },
    { id: 'gpt-5.5', displayName: 'GPT-5.5', description: 'Previous frontier model' },
    { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', description: 'Fast cost-efficient model' },
  ],
};

export function getProviderModels(providerId: ProviderId, statuses?: ProviderStatus[]): ProviderModel[] {
  const providerModels = statuses?.find((p) => p.id === providerId)?.models;
  return providerModels?.length ? providerModels : FALLBACK_PROVIDER_MODELS[providerId];
}

/**
 * Build CLI command + args for any AI provider.
 * Resolves the command path from provider status and builds
 * provider-specific CLI arguments.
 */
export async function buildProviderArgs(providerId: ProviderId, _prompt: string, options?: {
  contextPaths?: string[];
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  permissionMode?: string;
}): Promise<{ command: string; args: string[] }> {
  // Fetch provider status to get resolved path
  const statuses = await getProviderStatus();
  const status = statuses.find(p => p.id === providerId);
  const command = status?.resolvedPath || providerId;

  const flags = await getLaunchFlags();
  const args: string[] = [];

  if (providerId === 'claude') {
    // Same logic as buildAIArgs
    if (options?.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    } else if (options?.permissionMode === 'autoMode') {
      args.push('--enable-auto-mode');
    } else if (flags.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    } else if (flags.autoMode) {
      args.push('--enable-auto-mode');
    }
    if (options?.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    if (options?.contextPaths?.length) {
      for (const cp of options.contextPaths) {
        args.push('--add-dir', cp);
      }
    }
  } else if (providerId === 'gemini') {
    if (options?.permissionMode === 'bypassPermissions' || flags.dangerouslySkipPermissions) {
      args.push('--yolo');
    }
    if (options?.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
  } else if (providerId === 'codex') {
    if (options?.permissionMode === 'bypassPermissions' || flags.dangerouslySkipPermissions) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }
    const model = options?.model && options.model !== 'default' ? options.model : DEFAULT_CODEX_MODEL;
    const reasoningEffort = options?.reasoningEffort ?? getDefaultCodexReasoningEffort(model);
    args.push('--model', model);
    args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
    if (options?.contextPaths?.length) {
      for (const cp of options.contextPaths) {
        args.push('--add-dir', cp);
      }
    }
  }

  return { command, args };
}

/**
 * Build resume args for a given provider and session ID.
 * Single source of truth — eliminates hardcoded --resume everywhere.
 */
export function buildResumeArgs(providerId: ProviderId, sessionId: string): string[] {
  switch (providerId) {
    case 'claude': return ['--resume', sessionId];
    case 'gemini': return ['--resume', sessionId];
    case 'codex': return ['exec', 'resume', sessionId];
  }
}

/**
 * Build provider-specific permission/mode flags from global launch flags.
 * Consolidates the duplicated switch statements in SessionDetailPage and GridCell.
 */
export function buildProviderFlags(providerId: ProviderId, flags: LaunchFlags): string[] {
  const args: string[] = [];
  switch (providerId) {
    case 'claude':
      if (flags.dangerouslySkipPermissions) args.push('--dangerously-skip-permissions');
      else if (flags.autoMode) args.push('--enable-auto-mode');
      break;
    case 'gemini':
      if (flags.dangerouslySkipPermissions) args.push('--yolo');
      break;
    case 'codex':
      if (flags.dangerouslySkipPermissions) args.push('--dangerously-bypass-approvals-and-sandbox');
      break;
  }
  return args;
}

/**
 * Format a model name for display, stripping provider-specific prefixes/suffixes.
 */
export function formatModelDisplay(providerId: ProviderId | undefined, model: string): string {
  switch (providerId) {
    case 'claude':
      return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
    case 'gemini':
      return model.replace(/^models\//, '').replace(/^gemini-/, '');
    case 'codex':
      return model.replace(/^codex-/, '');
    default:
      return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
  }
}

export function buildModelSwitchInput(_providerId: ProviderId, model: string): string {
  return `/model ${model}`;
}

/**
 * Extract session ID from resume args, provider-aware.
 * Claude/Gemini: ['--resume', id] → index 1
 * Codex: ['exec', 'resume', id] → index 2
 */
export function extractSessionIdFromArgs(providerId: ProviderId | undefined, args: string[]): string | undefined {
  if (providerId === 'codex') {
    const resumeIdx = args.indexOf('resume');
    return resumeIdx >= 0 && args.length > resumeIdx + 1 ? args[resumeIdx + 1] : undefined;
  }
  const resumeIdx = args.indexOf('--resume');
  return resumeIdx >= 0 && args.length > resumeIdx + 1 ? args[resumeIdx + 1] : undefined;
}
