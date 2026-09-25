import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { isWindows } from '../platform.js';
import type { AIProvider } from './types.js';

let _resolvedClaudePath: string | null = null;

export const claudeProvider: AIProvider = {
  id: 'claude',
  displayName: 'Claude Code',

  processName(): string {
    return isWindows ? 'claude.exe' : 'claude';
  },

  exePath(customPath?: string): string {
    if (customPath) return customPath;
    if (_resolvedClaudePath && fs.existsSync(_resolvedClaudePath)) return _resolvedClaudePath;

    // Try `where`/`which` — only works if the exe is on the spawning process's PATH.
    // When Hive runs as a Windows service (LocalSystem), it does NOT inherit the
    // logged-in user's PATH, so this can fail even when claude runs fine in the
    // user's terminal. We only CACHE verified-existing paths so a bad fallback
    // doesn't poison the lifetime of the process.
    try {
      if (isWindows) {
        const result = execSync('where claude.exe', { encoding: 'utf-8', timeout: 5000 }).trim();
        const first = result.split(/\r?\n/)[0].trim();
        if (first && fs.existsSync(first)) {
          _resolvedClaudePath = first;
          return _resolvedClaudePath;
        }
      } else {
        const which = execSync('which claude', { encoding: 'utf-8', timeout: 5000 }).trim();
        if (which && fs.existsSync(which)) {
          _resolvedClaudePath = which;
          return _resolvedClaudePath;
        }
      }
    } catch { /* fall through to per-user scan */ }

    // Scan well-known install locations across all user profiles. The service's
    // homedir is often C:\Windows\system32\config\systemprofile which is useless,
    // so we enumerate real user homes under C:\Users.
    if (isWindows) {
      const homeDirs = new Set<string>([os.homedir()]);
      try {
        for (const entry of fs.readdirSync('C:\\Users', { withFileTypes: true })) {
          if (entry.isDirectory() && !['Public', 'Default', 'Default User', 'All Users'].includes(entry.name)) {
            homeDirs.add(path.join('C:\\Users', entry.name));
          }
        }
      } catch { /* can't list C:\Users */ }
      const candidates: string[] = [];
      for (const home of homeDirs) {
        candidates.push(
          path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
          path.join(home, 'AppData', 'Roaming', 'npm', 'claude.exe'),
          path.join(home, 'AppData', 'Local', 'Programs', 'claude-code', 'claude.exe'),
          path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
          path.join(home, '.local', 'bin', 'claude.exe'),
          path.join(home, 'scoop', 'shims', 'claude.exe'),
        );
      }
      for (const c of candidates) {
        try {
          if (fs.existsSync(c)) {
            _resolvedClaudePath = c;
            return _resolvedClaudePath;
          }
        } catch { /* skip */ }
      }
      // Last resort — return a plausible default but DO NOT cache it, so a later
      // call (after the user sets a customPath or installs claude) can re-resolve.
      return path.join(os.homedir(), '.local', 'bin', 'claude.exe');
    }

    return '/usr/local/bin/claude';
  },

  isInstalled(customPath?: string): boolean {
    try {
      const p = this.exePath(customPath);
      return fs.existsSync(p);
    } catch {
      return false;
    }
  },

  interactiveArgs(opts?: {
    permissionMode?: string;
    model?: string;
    contextPaths?: string[];
  }): string[] {
    const args: string[] = [];

    if (opts?.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    } else if (opts?.permissionMode === 'autoMode') {
      args.push('--enable-auto-mode');
    }

    if (opts?.model) {
      args.push('--model', opts.model);
    }

    if (opts?.contextPaths) {
      for (const dir of opts.contextPaths) {
        args.push('--add-dir', dir);
      }
    }

    return args;
  },

  batchArgs(prompt: string, opts?: { skipPermissions?: boolean }): string[] {
    const args: string[] = [];
    if (opts?.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }
    args.push('--print', '--output-format', 'text', prompt);
    return args;
  },

  cleanEnv(
    env: Record<string, string | undefined>,
    opts?: { configDir?: string },
  ): Record<string, string | undefined> {
    const cleaned = { ...env };
    for (const key of Object.keys(cleaned)) {
      if (key.startsWith('CLAUDE')) {
        delete cleaned[key];
      }
    }
    // Re-add CLAUDE_CONFIG_DIR after the strip — it is the one CLAUDE* var we
    // set deliberately, selecting which credential identity the session runs
    // under. Skills, agents, plugins and session history are junctioned back to
    // the primary dir, so only the credentials differ. Absent => default account.
    if (opts?.configDir) {
      cleaned.CLAUDE_CONFIG_DIR = opts.configDir;
    }
    return cleaned;
  },

  readyPatterns: ['/help', 'Tips:'],

  wrapPromptForInput(prompt: string): string {
    return `\x1b[200~${prompt}\x1b[201~\r`;
  },

  sessionDir(): string | null {
    return path.join(os.homedir(), '.claude', 'projects');
  },

  sessionFileGlob(): string {
    return '**/*.jsonl';
  },

  homeDir(): string {
    return path.join(os.homedir(), '.claude');
  },

  resumeArgs(sessionId: string): string[] {
    return ['--resume', sessionId];
  },

  formatModelName(model: string): string {
    return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
  },

  availableModels() {
    return [
      { id: 'claude-fable-5', displayName: 'Fable 5', description: 'Latest flagship model' },
      { id: 'claude-opus-4-8', displayName: 'Opus 4.8', description: 'Latest flagship Opus' },
      { id: 'claude-opus-4-7', displayName: 'Opus 4.7', description: 'Previous Opus' },
      { id: 'claude-opus-4-6', displayName: 'Opus 4.6', description: 'Earlier Opus' },
      { id: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', description: 'Balanced coding model' },
      { id: 'claude-haiku-4-5', displayName: 'Haiku 4.5', description: 'Fast lightweight model' },
    ];
  },
};
