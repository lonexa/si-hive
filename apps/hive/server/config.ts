import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { HiveConfig } from './types.js';
import { DEFAULT_PORT } from '../../../packages/shared/src/brand.js';
import { hiveHome } from '../../../packages/shared/src/server/paths.js';

const CONFIG_DIR = hiveHome();
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function resolveHome(filePath: string): string {
  if (filePath.startsWith('~/') || filePath.startsWith('~\\') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Fresh-install defaults. Everything optional (login, integrations, shared
 * storage, LLM API) starts off — Hive runs single-user on local SQLite with
 * the installed AI CLI until the user turns more on in Settings.
 */
function defaultConfig(): HiveConfig {
  return {
    projects: [],
    claudeHome: '~/.claude',
    server: {
      port: DEFAULT_PORT,
    },
    notifications: {
      macOS: true,
      browser: true,
    },
    projectsRoot: '',
    theme: 'dark',
    projectRoots: [],
    integrations: [],
    aiProviders: {
      primary: 'claude',
      providers: { claude: { enabled: true } },
    },
  };
}

export function loadConfig(): HiveConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const defaults = defaultConfig();
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2), 'utf-8');
      console.log(`[config] Created default config at ${CONFIG_PATH}`);
      return resolveConfig(defaults);
    }

    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HiveConfig>;
    return resolveConfig(mergeConfig(defaultConfig(), parsed));
  } catch (err) {
    console.error(`[config] Error loading config from ${CONFIG_PATH}, using defaults:`, err);
    return resolveConfig(defaultConfig());
  }
}

/**
 * Overlay the saved config on the defaults. Unknown top-level keys are kept
 * as-is so module-owned settings survive a load/save round trip; only the
 * small nested objects with required fields are merged key-by-key.
 */
function mergeConfig(defaults: HiveConfig, parsed: Partial<HiveConfig>): HiveConfig {
  return {
    ...defaults,
    ...parsed,
    server: { ...defaults.server, ...(parsed.server ?? {}) },
    notifications: { ...defaults.notifications, ...(parsed.notifications ?? {}) },
    projects: parsed.projects ?? defaults.projects,
    aiProviders: parsed.aiProviders ?? defaults.aiProviders,
  };
}

export function saveConfig(config: HiveConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

function resolveConfig(config: HiveConfig): HiveConfig {
  return {
    ...config,
    claudeHome: resolveHome(config.claudeHome),
    projects: config.projects.map((p) => ({
      ...p,
      path: resolveHome(p.path),
    })),
  };
}
