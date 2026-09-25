import type { ProviderId, AIProvider, ProvidersConfig, ProviderStatus } from './types.js';
import { claudeProvider } from './claude-provider.js';
import { geminiProvider } from './gemini-provider.js';
import { codexProvider } from './codex-provider.js';
import type { HiveConfig } from '../types.js';
import { listAccounts, defaultAccountId } from './accounts.js';

const ALL_PROVIDERS: Record<ProviderId, AIProvider> = {
  claude: claudeProvider,
  gemini: geminiProvider,
  codex: codexProvider,
};

export function getProvider(id: ProviderId): AIProvider {
  return ALL_PROVIDERS[id];
}

export function getPrimaryProvider(config: HiveConfig): AIProvider {
  const providersConfig = (config as any).aiProviders as ProvidersConfig | undefined ??
    { primary: 'claude' as ProviderId, providers: { claude: { enabled: true } } };
  return ALL_PROVIDERS[providersConfig.primary];
}

export function getEnabledProviders(config: HiveConfig): AIProvider[] {
  const providersConfig = (config as any).aiProviders as ProvidersConfig | undefined ??
    { primary: 'claude' as ProviderId, providers: { claude: { enabled: true } } };
  return Object.entries(providersConfig.providers)
    .filter(([, cfg]) => cfg?.enabled)
    .map(([id]) => ALL_PROVIDERS[id as ProviderId])
    .filter(Boolean);
}

export function getAllProviderStatus(config: HiveConfig): ProviderStatus[] {
  const providersConfig = (config as any).aiProviders as ProvidersConfig | undefined ??
    { primary: 'claude' as ProviderId, providers: { claude: { enabled: true } } };
  return (Object.keys(ALL_PROVIDERS) as ProviderId[]).map((id) => {
    const provider = ALL_PROVIDERS[id];
    const cfg = providersConfig.providers[id];
    let resolvedPath: string | null = null;
    let installed = false;
    try {
      resolvedPath = provider.exePath(cfg?.customPath);
      installed = provider.isInstalled(cfg?.customPath);
    } catch { /* not installed */ }
    return {
      id,
      displayName: provider.displayName,
      installed,
      enabled: cfg?.enabled ?? false,
      isPrimary: providersConfig.primary === id,
      resolvedPath,
      models: provider.availableModels(),
      accounts: listAccounts(config, id),
      defaultAccount: defaultAccountId(config, id),
    };
  });
}
