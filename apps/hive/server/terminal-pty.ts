import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isWindows, isWindowsService } from './platform.js';

/**
 * Directory holding the Hive-bundled agent tools (hive-img, hive-chart, …).
 * Resolved relative to this file so it works in both dev (`tsx`) and the
 * built dist-server layout. Prepended to the PATH of every spawned PTY so
 * agents can run `hive-img <path>` without knowing where the tool lives.
 */
const HIVE_TOOLS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
);
import type WebSocket from 'ws';
import type { ProviderId } from './types.js';
import { getProvider } from './providers/registry.js';
import { resolveAccountConfigDir } from './providers/accounts.js';
import {
  buildLocalEnv,
  getEndpointForAccount,
  withLocalModelArg,
  type LocalModelEndpoint,
} from './local-models/endpoints.js';
import { loadConfig } from './config.js';
import type { ProvidersConfig } from './providers/types.js';
import {
  createImagePreviewState,
  processChunk as processImagePreviewChunk,
  type ImagePreviewState,
} from './terminal-pty/interceptors/image-preview.js';
import { noteBytes as noteActivityBytes, forgetSession as forgetActivitySession } from './sessions/activity-stream.js';

// node-pty uses native bindings, import dynamically
let ptyModule: typeof import('node-pty') | null = null;

async function getPty() {
  if (!ptyModule) {
    ptyModule = await import('node-pty');
  }
  return ptyModule;
}

/** Max output to buffer per session when no WebSocket is connected (256KB) */
const MAX_BUFFER_SIZE = 256 * 1024;

/** How long an orphaned PTY (no WebSocket) stays alive before auto-cleanup (15 minutes) */
const ORPHAN_TTL_MS = 15 * 60 * 1000;

export interface SessionEnhancements {
  /** Inject iTerm2 inline-image escapes for image paths Claude reads. */
  inlineImages: boolean;
}

const DEFAULT_ENHANCEMENTS: SessionEnhancements = {
  inlineImages: true,
};

export interface PtySession {
  id: string;
  pty: import('node-pty').IPty;
  cwd: string;
  /** Arguments the process was started with (e.g. `--resume <sessionId>`). */
  args: string[];
  /**
   * Credential identity this PTY was spawned under (undefined = default
   * account). The account is fixed by the process environment at spawn time, so
   * a reattach request asking for a different account must respawn rather than
   * reuse — see the 'spawn' handler in index.ts.
   */
  accountId?: string;
  autoTrustDone?: boolean;
  /** Buffered output while no WebSocket is attached */
  outputBuffer: string;
  /**
   * Attached WebSockets. Several clients (e.g. a desktop tab and a phone) can
   * watch the same PTY; output is broadcast to all of them. Empty = detached.
   */
  clients: Set<WebSocket>;
  /** Whether the PTY process has exited */
  exited: boolean;
  /** Exit code if process has exited */
  exitCode?: number;
  /** Timer for auto-cleanup when no WebSocket is attached */
  orphanTimer: ReturnType<typeof setTimeout> | null;
  /** Disposable for the onData listener */
  dataDisposable: import('node-pty').IDisposable | null;
  /** Disposable for the onExit listener */
  exitDisposable: import('node-pty').IDisposable | null;
  /** Disposable for the interceptor onData listener */
  interceptorDisposable: import('node-pty').IDisposable | null;
  /** Per-session client-controlled enhancement flags. */
  enhancements: SessionEnhancements;
  /** Per-interceptor state (rolling buffers, dedup sets). */
  imagePreviewState: ImagePreviewState;
  /**
   * Paths of images previously injected into the session, in display order.
   * Capped FIFO. Replayed on reconnect by re-reading the files and emitting
   * fresh iTerm2 escapes — we deliberately do NOT keep the multi-MB base64
   * payloads in `outputBuffer` (the 256 KB cap would truncate mid-escape and
   * leak raw base64 into the terminal on resume).
   */
  injectedImagePaths: string[];
  /** Pending second step of a widening resize (see resizePty). */
  resizeTimer?: ReturnType<typeof setTimeout>;
}

/** Max images to remember per session for resume-replay. */
const MAX_INJECTED_IMAGES = 20;

const activeSessions = new Map<string, PtySession>();

/**
 * Resolve a command to its full path on Windows using `where.exe`.
 * Falls back to well-known locations if `where` fails.
 */
function resolveCommand(cmd: string): string {
  if (!isWindows) return cmd;

  // If already an absolute path, just return it
  if (path.isAbsolute(cmd)) return cmd;

  // Try `where.exe` first — prefer .cmd/.exe over extensionless (which may be a bash shim)
  const base = cmd.replace(/\.(exe|cmd|bat)$/i, '');
  const candidates = [...new Set([`${base}.cmd`, `${base}.exe`, cmd, base])];
  for (const candidate of candidates) {
    try {
      const result = execFileSync('where.exe', [candidate], {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      }).trim();
      const lines = result.split(/\r?\n/).filter(Boolean);
      // Prefer .cmd or .exe files over extensionless files on Windows
      const preferred = lines.find(l => /\.(cmd|exe|bat)$/i.test(l)) ?? lines[0];
      if (preferred && fs.existsSync(preferred)) {
        return preferred;
      }
    } catch { /* where failed, try next candidate */ }
  }

  // Build base name variants: try all extensions
  const basenames = [...new Set([`${base}.cmd`, `${base}.exe`, cmd, base])];

  // Scan all user profiles — service homedir may differ from logged-in user
  const home = os.homedir();
  const perUserSubdirs = [
    path.join('AppData', 'Roaming', 'npm'),
    path.join('AppData', 'Local', 'Programs'),
    path.join('AppData', 'Local', 'Programs', 'claude-code'),
    path.join('AppData', 'Local', 'Microsoft', 'WinGet', 'Links'),
    path.join('.local', 'bin'),
    path.join('AppData', 'Roaming', 'fnm', 'aliases', 'default'),
    path.join('scoop', 'shims'),
  ];
  const homeDirs = new Set<string>([home]);
  const usersRoots = new Set<string>(['C:\\Users']);
  const parentOfHome = path.dirname(home);
  if (parentOfHome && parentOfHome !== home) usersRoots.add(parentOfHome);
  for (const usersRoot of usersRoots) {
    try {
      for (const entry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && !['Public', 'Default', 'Default User', 'All Users'].includes(entry.name)) {
          homeDirs.add(path.join(usersRoot, entry.name));
        }
      }
    } catch { /* can't list directory — skip */ }
  }

  const dirs: string[] = [];
  for (const h of homeDirs) {
    for (const sub of perUserSubdirs) {
      dirs.push(path.join(h, sub));
    }
  }
  dirs.push('C:\\Program Files\\nodejs', 'C:\\Program Files (x86)\\nodejs');

  for (const dir of dirs) {
    for (const name of basenames) {
      try {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) {
          console.log(`[pty] Found "${cmd}" at ${p}`);
          return p;
        }
      } catch { /* skip inaccessible dirs */ }
    }
  }

  // Scan PATH entries directly
  for (const dir of (process.env.PATH || '').split(';').filter(Boolean)) {
    for (const name of basenames) {
      try {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) {
          console.log(`[pty] Found "${cmd}" via PATH scan at ${p}`);
          return p;
        }
      } catch { /* skip */ }
    }
  }

  // Return as-is and let node-pty try PATH resolution
  console.warn(`[pty] Could not resolve "${cmd}" via where.exe or fallback paths (homedir=${home})`);
  return cmd;
}

/** Send a message to one WebSocket if it is open. */
function sendTo(ws: WebSocket, msg: unknown): void {
  if (ws.readyState !== 1 /* WebSocket.OPEN */) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch { /* WebSocket send failed, ignore */ }
}

/** Send a message to every WebSocket attached to a session. */
function broadcast(session: PtySession, msg: unknown): void {
  if (session.clients.size === 0) return;
  const payload = JSON.stringify(msg);
  for (const ws of session.clients) {
    if (ws.readyState !== 1) continue;
    try { ws.send(payload); } catch { /* ignore */ }
  }
}

/**
 * Start the orphan cleanup timer for a detached session.
 * If no WebSocket reattaches within ORPHAN_TTL_MS, the PTY is destroyed.
 */
function startOrphanTimer(session: PtySession): void {
  clearOrphanTimer(session);
  session.orphanTimer = setTimeout(() => {
    if (session.clients.size === 0 && !session.exited) {
      console.log(`[pty] Orphan timeout reached for ${session.id}, destroying`);
      destroyPty(session.id);
    }
  }, ORPHAN_TTL_MS);
}

function clearOrphanTimer(session: PtySession): void {
  if (session.orphanTimer) {
    clearTimeout(session.orphanTimer);
    session.orphanTimer = null;
  }
}

/**
 * Append data to the session's output buffer, trimming if too large.
 */
function appendBuffer(session: PtySession, data: string): void {
  session.outputBuffer += data;
  if (session.outputBuffer.length > MAX_BUFFER_SIZE) {
    // Keep the last MAX_BUFFER_SIZE bytes
    session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_SIZE);
  }
}

/**
 * Spawn a new PTY session.
 *
 * If `command` and `args` are provided, runs that command directly.
 * Otherwise spawns a default shell.
 */
export async function spawnPty(
  id: string,
  cwd: string,
  cols: number = 120,
  rows: number = 30,
  command?: string,
  args?: string[],
  providerId?: ProviderId,
  enhancements?: Partial<SessionEnhancements>,
  accountId?: string,
): Promise<PtySession> {
  const pty = await getPty();

  let shell = command ?? (isWindows ? 'pwsh.exe' : (process.env.SHELL ?? '/bin/bash'));
  // -NoLogo is for the default PowerShell only — with a providerId the shell is
  // swapped for the provider CLI below, which rejects it.
  let shellArgs = args ?? (isWindows && !command && !providerId ? ['-NoLogo'] : []);

  // A local model endpoint: pin the CLI to its model before the args are
  // wrapped for cmd.exe below. Any --model from the UI is an Anthropic name.
  let localEndpoint: LocalModelEndpoint | null = null;
  try {
    localEndpoint = getEndpointForAccount(loadConfig(), providerId, accountId);
  } catch (err) {
    console.warn(`[pty] Local model lookup failed, using default account:`, (err as Error).message);
  }
  if (localEndpoint) {
    shellArgs = withLocalModelArg(shellArgs, localEndpoint.model);
  }

  // Guard: if command was empty string, fall back to default shell
  if (!shell) {
    console.warn(`[pty] Received empty command, falling back to default shell`);
    shell = isWindows ? 'pwsh.exe' : (process.env.SHELL ?? '/bin/bash');
  }

  // Resolve command to full path on Windows (node-pty doesn't always search PATH).
  // If a provider is specified and already resolved the path, use it directly to avoid
  // the expensive where.exe + filesystem scan (can take 20-30s on Windows).
  if (providerId && !path.isAbsolute(shell)) {
    const provider = getProvider(providerId);
    // Honor the per-provider customPath from config so users can point Hive at a
    // claude.exe installed in a non-standard location — critical when the service
    // runs as LocalSystem and can't see the user's PATH.
    let customPath: string | undefined;
    try {
      const cfg = loadConfig();
      const providersCfg = (cfg as { aiProviders?: ProvidersConfig }).aiProviders;
      customPath = providersCfg?.providers?.[providerId]?.customPath;
    } catch { /* ignore config read failures */ }
    try {
      const providerPath = provider.exePath(customPath);
      if (providerPath && fs.existsSync(providerPath)) {
        shell = providerPath;
      } else {
        shell = resolveCommand(shell);
      }
    } catch {
      shell = resolveCommand(shell);
    }
  } else {
    shell = resolveCommand(shell);
  }

  // If default shell (pwsh.exe) wasn't found, fall back to cmd.exe
  if (isWindows && !command && shell === 'pwsh.exe') {
    const resolved = resolveCommand('powershell.exe');
    if (resolved === 'powershell.exe') {
      shell = 'cmd.exe';
      shellArgs = [];
    } else {
      shell = resolved;
    }
  }

  // node-pty can't spawn .cmd/.bat files directly — wrap with cmd.exe /c
  if (isWindows && /\.(cmd|bat)$/i.test(shell)) {
    shellArgs = ['/c', shell, ...shellArgs];
    shell = 'cmd.exe';
  }

  // Validate CWD exists, fall back to home directory
  let safeCwd = cwd;
  try {
    if (!safeCwd || !fs.existsSync(safeCwd)) {
      safeCwd = os.homedir();
    }
  } catch {
    safeCwd = os.homedir();
  }

  // Build clean env — use provider's cleanEnv if specified, else default to stripping CLAUDE* vars
  let env = { ...process.env } as Record<string, string>;
  if (providerId) {
    const provider = getProvider(providerId);
    // Resolve the selected credential identity to a config dir. Unknown or
    // missing accounts resolve to undefined (the default account) rather than
    // failing the spawn — see resolveAccountConfigDir.
    let accountConfigDir: string | undefined;
    try {
      accountConfigDir = resolveAccountConfigDir(loadConfig(), providerId, accountId);
    } catch (err) {
      console.warn(`[pty] Account resolution failed, using default account:`, (err as Error).message);
    }
    env = provider.cleanEnv(env, { configDir: accountConfigDir }) as Record<string, string>;
    if (accountConfigDir) {
      console.log(`[pty] ${providerId} session using account "${accountId}" (${accountConfigDir})`);
    }
    if (localEndpoint) {
      // A stray API key would outrank the auth token and send it to Anthropic.
      delete env.ANTHROPIC_API_KEY;
      Object.assign(env, buildLocalEnv(localEndpoint));
      console.log(`[pty] ${providerId} session using local model "${localEndpoint.model}" at ${localEndpoint.baseUrl}`);
    }
  } else {
    // Default: strip CLAUDE* env vars for backward compatibility
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDE')) {
        delete env[key];
      }
    }
  }

  // Prepend Hive's bundled agent-tools directory (hive-img, ...) to PATH
  // so agents can invoke them by bare name from Bash.
  if (fs.existsSync(HIVE_TOOLS_DIR)) {
    const sep = isWindows ? ';' : ':';
    const currentPath = env.PATH || env.Path || '';
    env.PATH = currentPath ? `${HIVE_TOOLS_DIR}${sep}${currentPath}` : HIVE_TOOLS_DIR;
  }

  // Ensure the spawned process can find user-installed tools.
  // The service may run as LocalSystem or a different user, so add
  // npm/bin dirs for ALL user profiles to PATH.
  if (isWindows) {
    const extraPaths: string[] = [];
    try {
      for (const entry of fs.readdirSync('C:\\Users', { withFileTypes: true })) {
        if (entry.isDirectory() && !['Public', 'Default', 'Default User', 'All Users'].includes(entry.name)) {
          const userHome = path.join('C:\\Users', entry.name);
          extraPaths.push(
            path.join(userHome, 'AppData', 'Roaming', 'npm'),
            path.join(userHome, '.local', 'bin'),
            path.join(userHome, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links'),
          );
        }
      }
    } catch { /* can't list C:\Users */ }
    const existingPath = env.PATH || env.Path || '';
    env.PATH = `${extraPaths.join(';')};${existingPath}`;

    // Resolve the real user home from user-home.txt (written by installer)
    // or by extracting from the CWD (e.g. C:\Users\alice\...)
    let realUserHome = os.homedir();
    try {
      const userHomePath = path.join(path.dirname(process.execPath), '..', 'user-home.txt');
      if (fs.existsSync(userHomePath)) {
        realUserHome = fs.readFileSync(userHomePath, 'utf-8').trim();
      }
    } catch { /* ignore */ }
    // Fallback: extract from CWD if it's under C:\Users\
    if (realUserHome.includes('systemprofile') && safeCwd.match(/^[A-Z]:\\Users\\[^\\]+/)) {
      const match = safeCwd.match(/^([A-Z]:\\Users\\[^\\]+)/);
      if (match) realUserHome = match[1];
    }

    // Set HOME/USERPROFILE so Claude Code finds ~/.claude/ config and credentials
    env.HOME = realUserHome;
    env.USERPROFILE = realUserHome;

    // Auto-detect Git Bash for Claude Code (requires bash.exe on Windows)
    if (!env.CLAUDE_CODE_GIT_BASH_PATH) {
      const gitBashPaths = [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      ];
      // Also check Hive's portable Git (bundled by installer)
      try {
        const installDir = path.resolve(path.dirname(process.execPath), '..');
        gitBashPaths.push(path.join(installDir, 'git', 'bin', 'bash.exe'));
        gitBashPaths.push(path.join(installDir, 'git', 'cmd', 'bash.exe'));
      } catch { /* ignore */ }
      // Check user profile paths (Git installed via winget or user-local installer)
      // Service runs as LocalSystem, so check all user profiles
      try {
        for (const entry of fs.readdirSync('C:\\Users', { withFileTypes: true })) {
          if (entry.isDirectory() && !['Public', 'Default', 'Default User', 'All Users'].includes(entry.name)) {
            const userHome = path.join('C:\\Users', entry.name);
            gitBashPaths.push(
              path.join(userHome, 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe'),
              path.join(userHome, 'AppData', 'Local', 'Programs', 'Git', 'usr', 'bin', 'bash.exe'),
              path.join(userHome, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
            );
          }
        }
      } catch { /* can't list C:\Users */ }
      for (const p of gitBashPaths) {
        if (fs.existsSync(p)) {
          env.CLAUDE_CODE_GIT_BASH_PATH = p;
          break;
        }
      }
      // Fallback: use where.exe to find bash.exe via PATH
      if (!env.CLAUDE_CODE_GIT_BASH_PATH) {
        try {
          const result = execFileSync('where.exe', ['bash.exe'], {
            encoding: 'utf-8',
            timeout: 5000,
            windowsHide: true,
          }).trim();
          const lines = result.split(/\r?\n/).filter(Boolean);
          // Prefer a Git bash.exe (contains "Git" in path) over WSL or others
          const gitBash = lines.find(l => /git/i.test(l)) ?? lines[0];
          if (gitBash && fs.existsSync(gitBash)) {
            env.CLAUDE_CODE_GIT_BASH_PATH = gitBash;
          }
        } catch { /* where.exe failed — bash not in PATH */ }
      }
    }
    if (!env.APPDATA) {
      env.APPDATA = path.join(realUserHome, 'AppData', 'Roaming');
    }
    if (!env.LOCALAPPDATA) {
      env.LOCALAPPDATA = path.join(realUserHome, 'AppData', 'Local');
    }
  }

  const isService = isWindowsService();
  const useConpty = !isService;
  console.log(`[pty] Spawning: ${shell} ${shellArgs.join(' ')} in ${safeCwd} (useConpty=${useConpty}, isService=${isService}, HIVE_SERVICE=${process.env.HIVE_SERVICE})`);

  // Use winpty instead of ConPTY when running as a Windows service (session 0).
  // ConPTY in session 0 does not process pty.write() control characters (\r, \n)
  // correctly — text is delivered but Enter/control keys are silently dropped.
  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: safeCwd,
    env,
    useConpty,
  } as Record<string, unknown>);

  const session: PtySession = {
    id,
    pty: ptyProcess,
    cwd: safeCwd,
    args: args ?? [],
    accountId,
    autoTrustDone: false,
    outputBuffer: '',
    clients: new Set(),
    exited: false,
    orphanTimer: null,
    dataDisposable: null,
    exitDisposable: null,
    interceptorDisposable: null,
    enhancements: { ...DEFAULT_ENHANCEMENTS, ...(enhancements ?? {}) },
    imagePreviewState: createImagePreviewState(),
    injectedImagePaths: [],
  };

  // Set up onData listener — always buffers, and forwards to WebSocket if attached
  session.dataDisposable = ptyProcess.onData((data: string) => {
    appendBuffer(session, data);
    noteActivityBytes(session.id, data.length, { provider: providerId });
    broadcast(session, { type: 'output', data });
  });

  // Set up onExit listener
  session.exitDisposable = ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    console.log(`[pty] PTY exited for ${session.id} with code ${exitCode}`);
    session.exited = true;
    session.exitCode = exitCode;
    broadcast(session, { type: 'exit', code: exitCode });
    // Clean up after exit — no point keeping dead sessions
    clearOrphanTimer(session);
    forgetActivitySession(id);
    activeSessions.delete(id);
  });

  activeSessions.set(id, session);

  // Auto-accept the workspace trust dialog when Claude asks
  // (Skip for chat PTY sessions — those surface the trust prompt in the chat UI instead)
  const isChatSession = id.startsWith('chat-');
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  let trustBuffer = '';
  const trustListener = ptyProcess.onData((data: string) => {
    if (session.autoTrustDone || isChatSession) return;
    trustBuffer += data;
    const clean = stripAnsi(trustBuffer);
    if (clean.includes('trust this folder') || clean.includes('Trust this folder')
        || clean.includes('trustthisfolder') || clean.includes('Trustthisfolder')) {
      session.autoTrustDone = true;
      // Pressing Enter blindly is NOT the same as accepting. The prompt now
      // defaults to the DECLINE option:
      //     > No, exit
      //       Yes, I trust this folder
      // so a bare CR picks 'No, exit' and the CLI exits with code 1 - the
      // session dies instead of being trusted. Read which option is currently
      // selected and step to the accept line first, so a future reordering of
      // the options still works.
      const promptLines = clean.split(/\r?\n/);
      const selected = promptLines.find((l) => /^\s*[\u276F>]\s/.test(l)) ?? '';
      const alreadyOnAccept = /trust this folder/i.test(selected);
      console.log(
        `[pty] Auto-accepting workspace trust for ${id} ` +
        `(selected=${JSON.stringify(selected.trim())}, move=${!alreadyOnAccept})`,
      );
      setTimeout(() => {
        try {
          if (!alreadyOnAccept) ptyProcess.write('\x1b[B');
          setTimeout(() => {
            try { ptyProcess.write('\r'); } catch { /* already exited */ }
          }, 150);
        } catch { /* already exited */ }
      }, 500);
      trustListener.dispose();
    }
    if (trustBuffer.length > 50000) {
      session.autoTrustDone = true;
      trustListener.dispose();
    }
  });
  setTimeout(() => {
    if (!session.autoTrustDone) {
      session.autoTrustDone = true;
      trustListener.dispose();
    }
  }, 10000);

  // Stream-tap interceptor: parallel onData listener that detects file paths
  // for inline-image previews. The interceptor finds candidate paths; we
  // route those through `injectInlineImage`, which both renders the image
  // on the live WS and remembers the path for replay on reconnect.
  session.interceptorDisposable = ptyProcess.onData((data: string) => {
    if (!session.enhancements.inlineImages) return;
    processImagePreviewChunk(data, session.cwd, session.imagePreviewState, (_escape, absPath) => {
      if (absPath) injectInlineImage(session.id, absPath);
    });
  });

  return session;
}

/**
 * Build the iTerm2 inline-image escape sequence for a file. Returns null
 * if the file is missing or oversize.
 */
function buildInlineImageEscape(absPath: string): string | null {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return null;
    const MAX_BYTES = 2 * 1024 * 1024;
    if (stat.size > MAX_BYTES) return null;
    const bytes = fs.readFileSync(absPath);
    const nameB64 = Buffer.from(path.basename(absPath), 'utf-8').toString('base64');
    const dataB64 = bytes.toString('base64');
    return (
      '\r\n' +
      '\x1b]1337;' +
      `File=name=${nameB64};size=${bytes.length};inline=1;width=40;preserveAspectRatio=1:${dataB64}` +
      '\x07' +
      '\r\n'
    );
  } catch {
    return null;
  }
}

/**
 * Send a fully-formed iTerm2 inline-image escape to the live WebSocket
 * WITHOUT putting the multi-megabyte base64 into the session's text buffer.
 * The base64 would otherwise be truncated by the 256 KB buffer cap on
 * resume, leaking raw bytes into the terminal.
 *
 * Uses the `inline-image` message type so the client can capture the cursor
 * position before/after writing and map clicks back to the right path.
 */
function sendInlineEscape(session: PtySession, escape: string, absPath: string): void {
  broadcast(session, { type: 'inline-image', data: escape, path: absPath });
}

/**
 * Remember a path on the session so we can replay it on reconnect. Capped
 * FIFO; the oldest entry is evicted if we exceed the cap.
 */
function rememberInjectedImage(session: PtySession, absPath: string): void {
  // Move to most-recent position if already present.
  const existing = session.injectedImagePaths.indexOf(absPath);
  if (existing !== -1) session.injectedImagePaths.splice(existing, 1);
  session.injectedImagePaths.push(absPath);
  while (session.injectedImagePaths.length > MAX_INJECTED_IMAGES) {
    session.injectedImagePaths.shift();
  }
}

/**
 * Update the enhancement flags for a running session.
 */
export function setSessionEnhancements(id: string, patch: Partial<SessionEnhancements>): void {
  const session = activeSessions.get(id);
  if (!session) return;
  session.enhancements = { ...session.enhancements, ...patch };
}

/**
 * Synthesize an iTerm2 inline-image escape and inject it into the session's
 * stream so xterm's ImageAddon renders it. Used by the drag-and-drop path
 * (the user dropped an image; we want to show it inline even though Claude
 * will never emit a `Read(path)` line for it). Returns true on success.
 *
 * The session's imagePreviewState dedup set is marked so the regex
 * interceptor doesn't re-emit the same image if Claude later mentions it.
 */
export function injectInlineImage(sessionId: string, absPath: string): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) return false;
  const escape = buildInlineImageEscape(absPath);
  if (!escape) return false;
  // Mark this path as already-emitted so the regex interceptor doesn't
  // double-emit on a subsequent Read(path) line.
  if (!session.imagePreviewState.recentSet.has(absPath)) {
    session.imagePreviewState.recentSet.add(absPath);
    session.imagePreviewState.recent.push(absPath);
  }
  rememberInjectedImage(session, absPath);
  sendInlineEscape(session, escape, absPath);
  return true;
}

/**
 * Returns the paths of images previously injected into the session, ordered
 * newest-first. Used by the click-to-expand UI so it can show the original
 * full-resolution file instead of the addon's downscaled render.
 */
export function getInjectedImagePaths(sessionId: string): string[] {
  const session = activeSessions.get(sessionId);
  if (!session) return [];
  return [...session.injectedImagePaths].reverse();
}

/**
 * Re-emit fresh inline-image escapes for every path we previously injected
 * into this session. Called after the text buffer is replayed on reconnect.
 * Files that no longer exist are silently skipped.
 */
function replayInjectedImages(session: PtySession, ws: WebSocket): void {
  for (const p of session.injectedImagePaths) {
    const escape = buildInlineImageEscape(p);
    if (!escape) continue;
    sendTo(ws, { type: 'inline-image', data: escape, path: p });
  }
}

/**
 * Get an existing PTY session.
 */
export function getPtySession(id: string): PtySession | undefined {
  return activeSessions.get(id);
}

/**
 * Attach a WebSocket to a PTY session.
 * Replays buffered output and sets the session's active WebSocket.
 * Returns true if successfully attached.
 */
export function attachWebSocket(id: string, ws: WebSocket): boolean {
  const session = activeSessions.get(id);
  if (!session) return false;

  // Cancel orphan timer since we have a new connection
  clearOrphanTimer(session);

  // Join any other viewers (e.g. desktop + phone) rather than replacing them
  session.clients.add(ws);

  // Tell the new viewer the PTY's size, so a phone can render at it
  sendTo(ws, { type: 'size', cols: session.pty.cols, rows: session.pty.rows });

  // Replay buffered output so the terminal shows history
  if (session.outputBuffer.length > 0) {
    sendTo(ws, { type: 'output', data: session.outputBuffer });
  }

  // Replay any inline images we previously injected — fresh escapes built
  // from the on-disk files, so the base64 doesn't have to survive in the
  // (capped) text buffer.
  replayInjectedImages(session, ws);

  // If the process already exited, notify the new WebSocket
  if (session.exited) {
    sendTo(ws, { type: 'exit', code: session.exitCode ?? -1 });
  }

  return true;
}

/**
 * Detach a WebSocket from a PTY session WITHOUT killing the PTY.
 * The PTY continues running and buffering output.
 * Starts an orphan timer for eventual cleanup.
 */
export function detachWebSocket(id: string, ws: WebSocket): void {
  const session = activeSessions.get(id);
  if (!session) return;

  // Start the orphan timer only once the last viewer has left
  if (session.clients.delete(ws) && session.clients.size === 0 && !session.exited) {
    startOrphanTimer(session);
  }
}

/**
 * Clear the output buffer for a PTY session.
 * Used after trust prompt approval to remove leftover TUI artifacts.
 */
export function clearPtyBuffer(id: string): void {
  const session = activeSessions.get(id);
  if (session) {
    session.outputBuffer = '';
  }
}

/**
 * Destroy a PTY session (kill the process and remove from map).
 */
export function destroyPty(id: string): void {
  const session = activeSessions.get(id);
  if (session) {
    clearOrphanTimer(session);
    session.clients.clear();
    if (session.dataDisposable) session.dataDisposable.dispose();
    if (session.interceptorDisposable) session.interceptorDisposable.dispose();
    if (session.exitDisposable) session.exitDisposable.dispose();
    try { session.pty.kill(); } catch { /* already exited */ }
    activeSessions.delete(id);
  }
}

/**
 * Rename an active PTY session's ID. Used after a temporary terminal
 * (e.g. `new-<uuid>`) discovers its real Claude session ID — re-keying
 * the active session lets the client navigate to `/sessions/<real-id>`
 * and reattach to the same running PTY rather than spawning a duplicate.
 *
 * Returns true if rename succeeded; false if the source isn't found or
 * the destination already has a session.
 */
export function renamePtySession(oldId: string, newId: string): boolean {
  if (oldId === newId) return true;
  const session = activeSessions.get(oldId);
  if (!session) return false;
  if (activeSessions.has(newId)) return false;
  session.id = newId;
  activeSessions.delete(oldId);
  activeSessions.set(newId, session);
  return true;
}

/**
 * Write data to a PTY session with ConPTY activation workaround.
 *
 * On Windows, ConPTY in session 0 (SYSTEM service) silently drops control
 * characters (\r, \n) sent via pty.write() UNLESS a terminal client is
 * actively consuming the output. When xterm.js is attached via WebSocket,
 * the output flows to the client and ConPTY processes input normally.
 *
 * Workaround: temporarily attach a fake WebSocket consumer to the session
 * before writing, so ConPTY sees an active client and processes the input.
 */
export function writeToPtyWithActivation(id: string, data: string): boolean {
  const session = activeSessions.get(id);
  if (!session || session.exited) return false;

  // If no WebSocket attached, temporarily add a no-op consumer to activate ConPTY
  const fake = session.clients.size === 0
    ? ({ readyState: 1, send: () => {}, close: () => {} } as unknown as WebSocket)
    : null;
  if (fake) session.clients.add(fake);

  try {
    session.pty.write(data);
  } catch {
    if (fake) session.clients.delete(fake);
    return false;
  }

  // Remove the fake consumer after a brief delay to let ConPTY process
  if (fake) setTimeout(() => session.clients.delete(fake), 1000);

  return true;
}

/**
 * Resize a PTY. No-op resizes are skipped (a desktop tab re-sends its size when
 * it reconnects), since a real resize makes the CLI redraw.
 *
 * Widening goes one column past the target and then back. Claude Code on
 * Windows reliably redraws on a shrink but often misses a plain grow, leaving
 * it drawn at the old, narrower width.
 */
export function resizePty(id: string, cols: number, rows: number): void {
  const session = activeSessions.get(id);
  if (!session || session.exited) return;
  if (session.resizeTimer) {
    clearTimeout(session.resizeTimer);
    session.resizeTimer = undefined;
  }
  if (session.pty.cols === cols && session.pty.rows === rows) return;
  // Viewers that don't size the PTY themselves (phones) follow along.
  broadcast(session, { type: 'size', cols, rows });
  try {
    if (cols > session.pty.cols) {
      session.pty.resize(cols + 1, rows);
      session.resizeTimer = setTimeout(() => {
        session.resizeTimer = undefined;
        if (!session.exited) {
          try { session.pty.resize(cols, rows); } catch { /* exited */ }
        }
      }, 150);
    } else {
      session.pty.resize(cols, rows);
    }
  } catch { /* exited */ }
}

/**
 * Write data directly to a PTY session's stdin.
 * Returns true if the write succeeded, false if session not found or exited.
 */
export function writeToPty(id: string, data: string): boolean {
  const session = activeSessions.get(id);
  if (!session || session.exited) return false;
  try {
    session.pty.write(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find and write to a PTY session whose ID contains the given substring.
 * Used to send commands to a Claude session by Claude session ID,
 * since PTY IDs are formatted as `${tabId}-grid-${cellId}-${sessionId}`.
 * Returns true if at least one PTY received the data.
 */
export function writeToPtyBySessionId(sessionId: string, data: string): boolean {
  let sent = false;
  for (const [id, session] of activeSessions) {
    if (id.includes(sessionId) && !session.exited) {
      try {
        session.pty.write(data);
        sent = true;
      } catch { /* ignore */ }
    }
  }
  return sent;
}

/**
 * Kill every PTY running a given agent session: PTYs keyed by the session ID
 * (or a grid ID ending in it), PTYs started with it in their arguments
 * (`--resume <id>`), and any `knownIds` the caller has mapped to it.
 * Returns how many were killed.
 */
export function destroyPtysForSession(sessionId: string, knownIds: Iterable<string> = []): number {
  const ids = new Set(knownIds);
  for (const [id, session] of activeSessions) {
    if (id.includes(sessionId) || session.args.includes(sessionId)) ids.add(id);
  }
  let killed = 0;
  for (const id of ids) {
    if (!activeSessions.has(id)) continue;
    destroyPty(id);
    killed++;
  }
  return killed;
}

/** Kill every PTY whose working directory is `dir` or inside it. Returns how many were killed. */
export function destroyPtysUnder(dir: string): number {
  const norm = (p: string) => {
    const r = path.resolve(p).replace(/[\\/]+$/, '');
    return isWindows ? r.toLowerCase() : r;
  };
  const root = norm(dir);
  let killed = 0;
  for (const [id, session] of [...activeSessions]) {
    const cwd = norm(session.cwd);
    if (cwd !== root && !cwd.startsWith(root + path.sep)) continue;
    destroyPty(id);
    killed++;
  }
  return killed;
}

/**
 * Destroy all PTY sessions (for cleanup on shutdown).
 */
export function destroyAllPtys(): void {
  for (const [id] of activeSessions) {
    destroyPty(id);
  }
}
