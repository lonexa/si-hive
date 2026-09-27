import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isWindows } from '../platform.js';
import { decodeWindowsProjectDir } from '../parsers/process-discovery-windows.js';
import { loadConfig } from '../config.js';
import { isProjectDirInScope } from '../project-scope.js';

/**
 * Resolve the user's Claude home (~/.claude) accounting for Windows service
 * mode. When Hive runs as a service (LocalSystem), os.homedir() points at the
 * system profile dir, not the actual user — so the JSONL scan would miss every
 * session. Mirrors getClaudeHome() in chat/jsonl-bridge.ts.
 */
function getClaudeHomeDir(): string {
  if (process.env['CLAUDE_HOME']) return process.env['CLAUDE_HOME'];
  let home = os.homedir();
  try {
    const userHomePath = path.join(path.dirname(process.execPath), '..', 'user-home.txt');
    if (fs.existsSync(userHomePath)) {
      home = fs.readFileSync(userHomePath, 'utf-8').trim();
    }
  } catch { /* ignore */ }
  return path.join(home, '.claude');
}

export function getClaudeProjectsDir(): string {
  return path.join(getClaudeHomeDir(), 'projects');
}

export interface SessionListEntry {
  id: string;
  project: string;           // decoded project path
  projectEncoded: string;    // raw directory name
  modifiedAt: string;        // ISO timestamp
  sizeBytes: number;
  lineCount?: number;
}

export interface SessionEntry {
  index: number;
  type: string;
  role?: string;
  content?: string;
  toolName?: string;
  toolUseId?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  isSidechain?: boolean;
  raw?: Record<string, unknown>;
}

export interface SessionDetail {
  id: string;
  project: string;
  projectEncoded: string;
  entries: SessionEntry[];
  summary: {
    totalEntries: number;
    userTurns: number;
    assistantTurns: number;
    toolCalls: number;
    systemMessages: number;
    progressMessages: number;
    duration?: string;
  };
}

/**
 * Decode a project directory name to a human-readable path.
 * On Windows, uses the Windows path decoder. On other platforms,
 * replaces dashes with slashes.
 */
function decodeProjectDir(dirName: string): string {
  if (isWindows) {
    return decodeWindowsProjectDir(dirName);
  }
  // macOS/Linux: directory names use dashes for slashes
  return '/' + dirName.replace(/-/g, '/');
}

/**
 * Read the true working directory from a session JSONL. Claude records the launch
 * cwd verbatim in each turn's `cwd` field — authoritative. Decoding the project-dir
 * NAME is lossy on Windows ('\\', ':', '.', ' ' all encode to '-'), so paths like
 * "C:\Users\jane.doe\Documents\My Projects\..." can't be reconstructed.
 */
function readCwdFromJsonl(filePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.includes('"cwd"')) continue;
      try {
        const obj = JSON.parse(line) as { cwd?: unknown };
        if (typeof obj.cwd === 'string' && obj.cwd) return obj.cwd;
      } catch { /* skip malformed line */ }
    }
  } catch { /* unreadable — caller falls back to name decode */ }
  return undefined;
}

/**
 * List all available sessions across all projects.
 */
export async function listSessions(limit = 100, offset = 0): Promise<{ sessions: SessionListEntry[]; total: number }> {
  const projectsRoot = getClaudeProjectsDir();
  if (!fs.existsSync(projectsRoot)) {
    return { sessions: [], total: 0 };
  }

  const allSessions: SessionListEntry[] = [];

  const projectDirs = fs.readdirSync(projectsRoot).filter(d => {
    try {
      return fs.statSync(path.join(projectsRoot, d)).isDirectory();
    } catch {
      return false;
    }
  });

  const config = loadConfig();
  for (const projectDir of projectDirs) {
    // Only history from this install's project folders (see project-scope.ts).
    if (!isProjectDirInScope(config, projectDir)) continue;
    const dirPath = path.join(projectsRoot, projectDir);

    let files: string[];
    try {
      files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;

        allSessions.push({
          id: file.replace('.jsonl', ''),
          project: decodeProjectDir(projectDir),
          projectEncoded: projectDir,
          modifiedAt: stat.mtime.toISOString(),
          sizeBytes: stat.size,
        });
      } catch {
        // skip inaccessible files
      }
    }
  }

  // Sort by modified time descending (most recent first)
  allSessions.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

  return {
    sessions: allSessions.slice(offset, offset + limit),
    total: allSessions.length,
  };
}

/**
 * Extract displayable text content from a message object.
 */
function extractContent(message: Record<string, unknown>): string {
  if (!message) return '';

  const content = message.content;

  // Simple string content
  if (typeof content === 'string') return content;

  // Array of content blocks (Claude API format)
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block);
      } else if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          parts.push(b.text);
        } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
          parts.push(`[thinking] ${b.thinking}`);
        } else if (b.type === 'tool_use') {
          const name = (b.name as string) || 'unknown';
          const input = b.input ? JSON.stringify(b.input).slice(0, 500) : '';
          parts.push(`[tool_use: ${name}] ${input}`);
        } else if (b.type === 'tool_result') {
          const resultContent = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '').slice(0, 500);
          parts.push(`[tool_result] ${resultContent}`);
        }
      }
    }
    return parts.join('\n');
  }

  return '';
}

/**
 * Extract tool name from an assistant message's content blocks.
 */
function extractToolInfo(message: Record<string, unknown>): { toolName?: string; toolUseId?: string } {
  const content = message?.content;
  if (!Array.isArray(content)) return {};

  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>;
      if (b.type === 'tool_use') {
        return {
          toolName: (b.name as string) || undefined,
          toolUseId: (b.id as string) || undefined,
        };
      }
    }
  }
  return {};
}

export interface SessionInfo {
  exists: boolean;
  /** Decoded working directory (where Claude must be launched from to resume) */
  cwd?: string;
  /** Raw encoded directory name under ~/.claude/projects/ */
  projectEncoded?: string;
  /** Absolute path to the JSONL file */
  filePath?: string;
  modifiedAt?: string;
  sizeBytes?: number;
  /** Set when a live `claude` process currently owns this session ID */
  liveHolder?: LiveSessionHolder;
}

/**
 * A live `claude` process holding a session, as recorded by Claude Code in
 * ~/.claude/sessions/<pid>.json.
 */
export interface LiveSessionHolder {
  pid: number;
  /** 'interactive' for a normal REPL, 'bg' for a background agent */
  kind: string;
  status?: string;
  name?: string;
  cwd?: string;
  startedAt?: number;
}

/**
 * Look up the live `claude` process (if any) currently holding a session ID.
 *
 * Claude Code writes one JSON file per running process into
 * ~/.claude/sessions/, keyed by pid, recording `sessionId` and `kind`.
 * This matters for resume: the CLI refuses `--resume <id>` while a background
 * agent owns that session ("...is currently running as a background agent
 * (bg). Use `claude agents` ... or add --fork-session"), so we need to know
 * before spawning whether a plain resume can possibly succeed.
 *
 * Files are keyed by pid and can outlive a crashed process, so every candidate
 * is checked for liveness before being reported.
 */
export function getLiveSessionHolder(sessionId: string): LiveSessionHolder | undefined {
  return listLiveSessionHolders().find((h) => h.sessionId === sessionId);
}

/** Every live `claude` process that currently holds a session. */
export function listLiveSessionHolders(): Array<LiveSessionHolder & { sessionId: string }> {
  const dir = path.join(getClaudeHomeDir(), 'sessions');
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }

  const holders: Array<LiveSessionHolder & { sessionId: string }> = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as {
        pid?: number; sessionId?: string; kind?: string; status?: string;
        name?: string; cwd?: string; startedAt?: number;
      };
      if (typeof raw.sessionId !== 'string' || typeof raw.pid !== 'number') continue;
      // Stale-file guard: signal 0 probes existence without touching the
      // process. ESRCH means gone; EPERM means alive but not ours to signal.
      try {
        process.kill(raw.pid, 0);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EPERM') continue;
      }
      holders.push({
        sessionId: raw.sessionId,
        pid: raw.pid,
        kind: raw.kind ?? 'interactive',
        status: raw.status,
        name: raw.name,
        cwd: raw.cwd,
        startedAt: raw.startedAt,
      });
    } catch { /* unreadable or partially written — skip */ }
  }
  return holders;
}

/**
 * Quick lookup of session metadata by ID — scans ~/.claude/projects/ for a
 * matching JSONL file without parsing its contents. Used to recover the cwd
 * for a session that's no longer in the in-memory dashboard store.
 */
export function getSessionInfo(sessionId: string): SessionInfo {
  const projectsRoot = getClaudeProjectsDir();
  if (!fs.existsSync(projectsRoot)) return { exists: false };

  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(projectsRoot).filter(d => {
      try {
        return fs.statSync(path.join(projectsRoot, d)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return { exists: false };
  }

  const target = `${sessionId}.jsonl`;
  for (const dir of projectDirs) {
    const candidate = path.join(projectsRoot, dir, target);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return {
          exists: true,
          cwd: readCwdFromJsonl(candidate) ?? decodeProjectDir(dir),
          projectEncoded: dir,
          filePath: candidate,
          modifiedAt: stat.mtime.toISOString(),
          sizeBytes: stat.size,
          liveHolder: getLiveSessionHolder(sessionId),
        };
      }
    } catch { /* not in this dir, try next */ }
  }
  return { exists: false };
}

/**
 * Read and parse a specific session's JSONL file for replay.
 */
export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const projectsRoot = getClaudeProjectsDir();
  if (!fs.existsSync(projectsRoot)) return null;

  // Find the session file across all project directories
  const projectDirs = fs.readdirSync(projectsRoot).filter(d => {
    try {
      return fs.statSync(path.join(projectsRoot, d)).isDirectory();
    } catch {
      return false;
    }
  });

  let targetPath: string | null = null;
  let projectDir = '';

  for (const dir of projectDirs) {
    const candidate = path.join(projectsRoot, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) {
      targetPath = candidate;
      projectDir = dir;
      break;
    }
  }

  if (!targetPath) return null;

  const fileContent = fs.readFileSync(targetPath, 'utf-8');
  const lines = fileContent.split('\n').filter(Boolean);

  const entries: SessionEntry[] = [];
  let userTurns = 0;
  let assistantTurns = 0;
  let toolCalls = 0;
  let systemMessages = 0;
  let progressMessages = 0;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      continue; // skip malformed lines
    }

    const type = (parsed.type as string) || 'unknown';
    const message = parsed.message as Record<string, unknown> | undefined;

    // Skip file-history-snapshot entries - not useful for replay
    if (type === 'file-history-snapshot') continue;

    // Track timestamps from sessionId or cwd fields
    const entrySessionId = parsed.sessionId as string | undefined;
    const cwd = parsed.cwd as string | undefined;
    const isSidechain = parsed.isSidechain as boolean | undefined;

    let role: string | undefined;
    let content = '';
    let toolName: string | undefined;
    let toolUseId: string | undefined;
    let timestamp: string | undefined;

    if (type === 'user') {
      role = 'user';
      userTurns++;
      if (message) {
        content = extractContent(message);
      }
    } else if (type === 'assistant') {
      role = 'assistant';
      assistantTurns++;
      if (message) {
        content = extractContent(message);
        const toolInfo = extractToolInfo(message);
        toolName = toolInfo.toolName;
        toolUseId = toolInfo.toolUseId;
        if (toolName) toolCalls++;
      }
    } else if (type === 'progress') {
      progressMessages++;
      role = 'progress';
      const data = parsed.data as Record<string, unknown> | undefined;
      if (data?.message) {
        const innerMsg = data.message as Record<string, unknown>;
        content = extractContent(innerMsg);
      }
      toolUseId = parsed.toolUseID as string | undefined;
    } else if (type === 'system') {
      systemMessages++;
      role = 'system';
      const subtype = parsed.subtype as string | undefined;
      const slug = parsed.slug as string | undefined;
      content = [subtype, slug].filter(Boolean).join(': ');
    } else if (type === 'queue-operation') {
      role = 'system';
      const operation = parsed.operation as string | undefined;
      const opContent = parsed.content as string | undefined;
      timestamp = parsed.timestamp as string | undefined;
      content = `[queue: ${operation || 'unknown'}] ${opContent || ''}`;
    } else {
      // Unknown type - include raw
      role = type;
      content = JSON.stringify(parsed).slice(0, 500);
    }

    if (!firstTimestamp && timestamp) firstTimestamp = timestamp;
    if (timestamp) lastTimestamp = timestamp;

    entries.push({
      index: entries.length,
      type,
      role,
      content,
      toolName,
      toolUseId,
      timestamp,
      sessionId: entrySessionId,
      cwd,
      isSidechain: isSidechain || undefined,
    });
  }

  // Calculate duration if we have timestamps
  let duration: string | undefined;
  if (firstTimestamp && lastTimestamp) {
    const ms = new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime();
    if (ms > 0) {
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    }
  }

  return {
    id: sessionId,
    project: decodeProjectDir(projectDir),
    projectEncoded: projectDir,
    entries,
    summary: {
      totalEntries: entries.length,
      userTurns,
      assistantTurns,
      toolCalls,
      systemMessages,
      progressMessages,
      duration,
    },
  };
}
