export type ProviderId = 'claude' | 'gemini' | 'codex';

/**
 * A named credential identity for a provider (e.g. a work Claude account and a
 * personal one). Each account is a separate provider config dir holding its own
 * credentials; everything else (skills, agents, plugins, session history) is
 * shared back to the primary dir via junctions so switching accounts changes
 * only which subscription the tokens bill against.
 */
export interface AccountConfig {
  /** Stable slug used in config + API calls. `default` is implicit and reserved. */
  id: string;
  /** Human label shown in the launch dialog picker. */
  label: string;
  /**
   * Absolute path to this account's provider config dir. Omitted for the
   * implicit default account, which uses the provider's own `homeDir()`.
   */
  configDir?: string;
}

export interface ProviderModel {
  id: string;
  displayName: string;
  description?: string;
}

export interface AIProvider {
  id: ProviderId;
  displayName: string;

  // Binary resolution
  processName(): string;
  exePath(customPath?: string): string;
  isInstalled(customPath?: string): boolean;

  // Interactive PTY args
  interactiveArgs(opts?: {
    permissionMode?: string;
    model?: string;
    reasoningEffort?: string;
    contextPaths?: string[];
  }): string[];

  // Batch/headless args (for scheduler, PR review)
  batchArgs(prompt: string, opts?: { skipPermissions?: boolean; model?: string; reasoningEffort?: string }): string[];

  // Env cleanup when spawning. `opts.configDir` selects a non-default account
  // by pointing the CLI at an alternate config dir.
  cleanEnv(
    env: Record<string, string | undefined>,
    opts?: { configDir?: string },
  ): Record<string, string | undefined>;

  // PTY output patterns indicating REPL is ready for input
  readyPatterns: string[];

  // Wrap prompt text for stdin delivery to the interactive REPL
  wrapPromptForInput(prompt: string): string;

  // Where this provider stores session files (null if unknown/none)
  sessionDir(): string | null;

  // Session file glob pattern within sessionDir
  sessionFileGlob(): string;

  // Provider config home directory (~/.claude, ~/.gemini, ~/.codex)
  homeDir(): string;

  // Build resume args for a given session ID
  resumeArgs(sessionId: string): string[];

  // Format a model name for display (strip provider-specific prefixes/suffixes)
  formatModelName(model: string): string;

  // Models exposed in Hive model pickers for this provider
  availableModels(): ProviderModel[];
}

export interface ProviderConfig {
  enabled: boolean;
  customPath?: string;
  /**
   * Additional credential identities beyond the implicit default. Empty or
   * absent means single-account behaviour (identical to before this existed).
   */
  accounts?: AccountConfig[];
  /** Account id pre-selected in launch dialogs. Defaults to `default`. */
  defaultAccount?: string;
}

export interface ProvidersConfig {
  primary: ProviderId;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  /** Provider used for PR code reviews (defaults to primary) */
  reviewProvider?: ProviderId;
}

export interface ProviderStatus {
  id: ProviderId;
  displayName: string;
  installed: boolean;
  enabled: boolean;
  isPrimary: boolean;
  resolvedPath: string | null;
  models: ProviderModel[];
  /** Selectable accounts, always including the implicit default first. */
  accounts: AccountStatus[];
  /** Account id to preselect in pickers. */
  defaultAccount: string;
}

export interface AccountStatus {
  id: string;
  label: string;
  configDir: string | null;
  /** True once the account's config dir holds credentials. */
  authenticated: boolean;
  /** True for the implicit default account, which cannot be deleted. */
  isDefault: boolean;
  /** Signed-in identity, from `auth status`. Only on the per-account endpoint. */
  email?: string;
  orgName?: string;
  subscriptionType?: string;
}
