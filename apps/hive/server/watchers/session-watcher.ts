import fs from 'node:fs';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { Aggregator } from '../state/aggregator.js';
import type { HiveConfig, ProviderId } from '../types.js';
import { processFileUpdate, getOrBootstrap, removeFileState, toSessionActivity } from '../parsers/session-state.js';
import { getEnabledProviders } from '../providers/registry.js';
import { recordSessionUpdate } from '../analytics/usage-logger.js';
import { isSessionInScope } from '../project-scope.js';

interface WatchTarget {
  dir: string;
  providerId: ProviderId;
  glob: string;
}

export class SessionWatcher {
  private watchers: FSWatcher[] = [];
  private aggregator: Aggregator;
  private config: HiveConfig;
  private activityTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private sessionRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private _ready = false;

  constructor(aggregator: Aggregator, _claudeHome: string, config?: HiveConfig) {
    this.aggregator = aggregator;
    this.config = config ?? { projects: [], claudeHome: _claudeHome, server: { port: 4747 }, notifications: { macOS: true, browser: true }, projectsRoot: '', theme: 'dark' };
  }

  start(): void {
    // Build watch targets from all enabled providers
    const watchTargets: WatchTarget[] = [];
    const watchedDirs = new Set<string>();

    for (const provider of getEnabledProviders(this.config)) {
      const sessionDir = provider.sessionDir();
      if (sessionDir && fs.existsSync(sessionDir) && !watchedDirs.has(sessionDir)) {
        watchTargets.push({ dir: sessionDir, providerId: provider.id, glob: provider.sessionFileGlob() });
        watchedDirs.add(sessionDir);
      }
    }

    if (watchTargets.length === 0) {
      console.log(`[session-watcher] No session directories found, skipping watch`);
      this._ready = true;
      return;
    }

    let readyCount = 0;

    for (const target of watchTargets) {
      console.log(`[session-watcher] Watching ${target.dir} (${target.providerId})`);

      const watcher = watch(target.dir, {
        ignoreInitial: true,
        persistent: true,
      });

      watcher.on('all', (event: string, filePath: string) => {
        // Check if the file matches the expected pattern for this provider
        if (!this.matchesProviderGlob(filePath, target)) return;

        if (event === 'add' || event === 'unlink') {
          if (event === 'unlink') {
            removeFileState(filePath);
          }
          this.scheduleSessionRefresh();
        }

        if (event === 'change' || event === 'add') {
          this.handleActivityChange(filePath, target.providerId);
        }
      });

      watcher.on('ready', () => {
        readyCount++;
        if (readyCount === watchTargets.length) {
          this._ready = true;
          console.log(`[session-watcher] Ready (watching ${watchTargets.length} directories)`);
        }
      });

      watcher.on('error', (err: unknown) => {
        console.error(`[session-watcher] Error on ${target.dir}:`, err);
      });

      this.watchers.push(watcher);
    }
  }

  get ready(): boolean {
    return this._ready;
  }

  async stop(): Promise<void> {
    for (const timer of this.activityTimers.values()) {
      clearTimeout(timer);
    }
    this.activityTimers.clear();
    if (this.sessionRefreshTimer) {
      clearTimeout(this.sessionRefreshTimer);
      this.sessionRefreshTimer = null;
    }
    for (const watcher of this.watchers) {
      await watcher.close();
    }
    this.watchers = [];
  }

  private async parseNonClaudeSession(filePath: string, providerId: ProviderId): Promise<void> {
    try {
      let state;
      if (providerId === 'gemini') {
        const { parseGeminiSession } = await import('../parsers/gemini-session-parser.js');
        state = parseGeminiSession(filePath);
      } else if (providerId === 'codex') {
        const { parseCodexSession } = await import('../parsers/codex-session-parser.js');
        state = parseCodexSession(filePath);
      }
      if (state) {
        this.aggregator.updateSessionFromFileState(filePath, state);
      }
    } catch (err) {
      console.error(`[session-watcher] Error parsing ${providerId} session ${filePath}:`, err);
    }
  }

  private matchesProviderGlob(filePath: string, target: WatchTarget): boolean {
    // Simple glob matching — check file extension
    if (target.providerId === 'claude' || target.providerId === 'codex') {
      return filePath.endsWith('.jsonl');
    }
    if (target.providerId === 'gemini') {
      // Match chats/*.json files, but NOT logs.json or other non-chat files
      const normalized = filePath.replace(/\\/g, '/');
      return normalized.includes('/chats/') && filePath.endsWith('.json');
    }
    return true;
  }

  private scheduleSessionRefresh(): void {
    if (this.sessionRefreshTimer) {
      clearTimeout(this.sessionRefreshTimer);
    }
    this.sessionRefreshTimer = setTimeout(() => {
      this.sessionRefreshTimer = null;
      console.log('[session-watcher] Refreshing sessions (new/deleted file detected)');
      this.aggregator.refreshSessions();
    }, 1000);
  }

  /** Is this session file inside the configured project folders? */
  private inScope(filePath: string, cwd: string | null | undefined): boolean {
    // ~/.claude/projects/<encodedDir>/<session>.jsonl (subagents nest deeper)
    const rel = path.relative(path.join(this.config.claudeHome, 'projects'), filePath);
    const encodedDir = rel.split(/[\\/]/)[0];
    return isSessionInScope(this.config, cwd, encodedDir);
  }

  private handleActivityChange(filePath: string, providerId: ProviderId): void {
    const existing = this.activityTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    this.activityTimers.set(filePath, setTimeout(() => {
      this.activityTimers.delete(filePath);

      // For non-Claude providers, use their specific parsers
      if (providerId !== 'claude') {
        void this.parseNonClaudeSession(filePath, providerId);
        return;
      }

      // Claude: use existing incremental parser
      const state = processFileUpdate(filePath);
      // Ignore agent sessions outside this install's project folders.
      if (!this.inScope(filePath, state?.cwd)) return;
      if (state) {
        const activity = toSessionActivity(state);
        if (activity && activity.active) {
          console.log(`[session-watcher] Activity for session ${activity.sessionId}: ${activity.tool ?? (activity.thinking ? 'thinking' : 'idle')}`);
          this.aggregator.updateSessionFromFileState(filePath, state);
        } else {
          this.aggregator.updateSessionFromFileState(filePath, state);
        }
        if (state.sessionId) {
          recordSessionUpdate(state.sessionId, filePath, state.cwd ?? null, 'claude');
        }
      } else {
        const bootstrapped = getOrBootstrap(filePath);
        if (bootstrapped) {
          this.aggregator.updateSessionFromFileState(filePath, bootstrapped);
          if (bootstrapped.sessionId) {
            recordSessionUpdate(bootstrapped.sessionId, filePath, bootstrapped.cwd ?? null, 'claude');
          }
        }
      }
    }, 500));
  }
}
