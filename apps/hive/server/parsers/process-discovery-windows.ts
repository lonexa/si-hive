import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import type { ClaudePaneMapping } from './process-discovery.js';

const execFileAsync = promisify(execFile);

/**
 * Windows-specific implementation of Claude process discovery.
 *
 * Strategy:
 * 1. Find all claude.exe processes using WMIC/PowerShell
 * 2. Walk parent chains to identify hosting terminal (Windows Terminal, ConEmu, cmd, pwsh)
 * 3. Map to session files using CWD and file timestamps
 */
export async function discoverClaudePanesWindows(): Promise<ClaudePaneMapping> {
  const result: ClaudePaneMapping = {
    byTasksDir: new Map(),
    byPid: new Map(),
    bySessionId: new Map(),
    byPaneTitle: new Map(),
    panePrompts: new Map(),
    byItermSession: new Map(),
    orphanItermSessions: [],
  };

  const claudeHome = path.join(os.homedir(), '.claude');

  try {
    // Step 1: Find all claude.exe processes
    const claudePids = await findClaudePidsWindows();
    if (claudePids.length === 0) {
      console.log('[discovery-win] No claude.exe processes found');
      return result;
    }

    console.log(`[discovery-win] Found ${claudePids.length} claude.exe PIDs: ${claudePids.join(', ')}`);

    // Step 2: Get process details (CWD, parent chain, creation time) for each
    const processDetails = await getProcessDetailsWindows(claudePids);

    // Step 3: For each claude process, determine terminal type and create pane ID
    for (const [pid, details] of processDetails) {
      const terminal = details.terminalType;
      const hwnd = details.windowHandle ?? '0';
      const paneId = `win:${terminal}:${pid}:${hwnd}`;

      result.byPid.set(pid, paneId);

      // Step 4: Match to session files using CWD
      if (details.cwd) {
        const sessionId = await matchCwdToSession(details.cwd, details.creationTime, claudeHome);
        if (sessionId) {
          result.bySessionId.set(sessionId, paneId);
        }
      }

      // Step 5: Check for tasks dir references
      if (details.cwd) {
        const tasksId = await findTasksDirForPid(pid, claudeHome);
        if (tasksId) {
          result.byTasksDir.set(tasksId, paneId);
        }
      }

      console.log(`[discovery-win] PID ${pid} → ${terminal} (cwd=${details.cwd?.slice(-40) ?? 'unknown'}, hwnd=${details.windowHandle ?? 'none'})`);
    }

    console.log(`[discovery-win] Mapped ${result.byPid.size} claude PIDs, ${result.bySessionId.size} sessions`);
  } catch (err) {
    console.error('[discovery-win] Discovery error:', err);
  }

  return result;
}

/**
 * Find all PIDs of claude.exe processes using WMIC.
 */
async function findClaudePidsWindows(): Promise<number[]> {
  try {
    // Use PowerShell Get-CimInstance for reliability on modern Windows
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Select-Object -ExpandProperty ProcessId`,
    ], { timeout: 10000 });

    return stdout.trim().split(/\r?\n/)
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n));
  } catch {
    // Fallback to tasklist
    try {
      const { stdout } = await execFileAsync('tasklist', [
        '/FI', 'IMAGENAME eq claude.exe', '/FO', 'CSV', '/NH',
      ], { timeout: 10000 });

      const pids: number[] = [];
      for (const line of stdout.trim().split(/\r?\n/)) {
        if (!line.trim()) continue;
        // CSV format: "name","PID","session","session#","mem"
        const match = /"[^"]*","(\d+)"/.exec(line);
        if (match) pids.push(parseInt(match[1], 10));
      }
      return pids;
    } catch {
      return [];
    }
  }
}

interface WindowsProcessDetails {
  pid: number;
  parentPid: number;
  cwd: string | undefined;
  commandLine: string | undefined;
  creationTime: number;
  terminalType: 'windows-terminal' | 'conemu' | 'pwsh' | 'cmd' | 'mintty' | 'unknown';
  windowHandle: string | undefined;
}

/**
 * Get detailed process info for each PID including CWD, parent chain, and terminal type.
 */
async function getProcessDetailsWindows(pids: number[]): Promise<Map<number, WindowsProcessDetails>> {
  const result = new Map<number, WindowsProcessDetails>();

  // Get full process tree in one call
  const processTree = await getProcessTree();

  for (const pid of pids) {
    const proc = processTree.get(pid);
    if (!proc) continue;

    // Walk parent chain to find terminal type
    const terminalType = detectTerminalWindows(pid, processTree);

    // Get CWD for this process
    const cwd = await getProcessCwdWindows(pid);

    // Find window handle for the terminal hosting this process
    const windowHandle = await findTerminalWindowHandle(pid, processTree);

    result.set(pid, {
      pid,
      parentPid: proc.parentPid,
      cwd,
      commandLine: proc.commandLine,
      creationTime: proc.creationTime,
      terminalType,
      windowHandle,
    });
  }

  return result;
}

interface ProcessTreeEntry {
  pid: number;
  parentPid: number;
  name: string;
  commandLine: string;
  creationTime: number;
}

/**
 * Build the full process tree using PowerShell.
 */
async function getProcessTree(): Promise<Map<number, ProcessTreeEntry>> {
  const tree = new Map<number, ProcessTreeEntry>();

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.CreationDate)|$($_.CommandLine)" }`,
    ], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });

    for (const line of stdout.trim().split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split('|');
      if (parts.length < 4) continue;

      const pid = parseInt(parts[0], 10);
      const parentPid = parseInt(parts[1], 10);
      const name = parts[2];
      const creationStr = parts[3];
      const commandLine = parts.slice(4).join('|'); // CommandLine may contain |

      if (isNaN(pid)) continue;

      let creationTime = 0;
      if (creationStr) {
        const parsed = new Date(creationStr).getTime();
        if (!isNaN(parsed)) creationTime = parsed;
      }

      tree.set(pid, { pid, parentPid, name, commandLine, creationTime });
    }
  } catch (err) {
    console.error('[discovery-win] Failed to build process tree:', err);
  }

  return tree;
}

/**
 * Detect which terminal application hosts a given PID by walking the parent chain.
 *
 * Priority: GUI terminal hosts take precedence over shell processes.
 * e.g., claude.exe → node.exe → pwsh.exe → WindowsTerminal.exe → explorer.exe
 * should return 'windows-terminal', not 'pwsh'.
 */
function detectTerminalWindows(
  pid: number,
  tree: Map<number, ProcessTreeEntry>,
): WindowsProcessDetails['terminalType'] {
  let current = pid;
  const visited = new Set<number>();

  let shellType: WindowsProcessDetails['terminalType'] = 'unknown';

  while (current > 0 && !visited.has(current)) {
    visited.add(current);
    const proc = tree.get(current);
    if (!proc) break;

    const name = proc.name.toLowerCase();

    // GUI terminal hosts — return immediately (highest priority)
    if (name === 'windowsterminal.exe') return 'windows-terminal';
    if (name === 'conemu64.exe' || name === 'conemu.exe') return 'conemu';
    if (name === 'mintty.exe') return 'mintty';

    // Shell processes — remember but keep walking (a GUI host may be above)
    if (name === 'pwsh.exe' || name === 'powershell.exe') {
      if (shellType === 'unknown') shellType = 'pwsh';
    }
    if (name === 'cmd.exe') {
      if (shellType === 'unknown') shellType = 'cmd';
    }

    current = proc.parentPid;
  }

  return shellType;
}

/**
 * Get the CWD of a process on Windows.
 *
 * Strategy: Find recently active .claude/projects/* directories and match
 * the most recently modified JSONL file. Unlike macOS (which has lsof),
 * Windows has no easy way to get a process's CWD from outside. So we
 * correlate process creation time with JSONL file timestamps.
 */
async function getProcessCwdWindows(pid: number): Promise<string | undefined> {
  const claudeHome = path.join(os.homedir(), '.claude');
  const projectsDir = path.join(claudeHome, 'projects');

  if (!fs.existsSync(projectsDir)) return undefined;

  // Get process creation time
  let creationTime = 0;
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction Stop).CreationDate.ToString('o')`,
    ], { timeout: 5000 });
    const parsed = new Date(stdout.trim()).getTime();
    if (!isNaN(parsed)) creationTime = parsed;
  } catch {
    return undefined;
  }

  if (!creationTime) return undefined;

  // Scan project directories for recently modified JSONL files
  // that were created after the PID started
  try {
    const projectDirs = fs.readdirSync(projectsDir).filter(d => {
      try { return fs.statSync(path.join(projectsDir, d)).isDirectory(); } catch { return false; }
    });

    let bestDir: string | undefined;
    let bestMtime = 0;
    const now = Date.now();

    for (const dir of projectDirs) {
      const dirPath = path.join(projectsDir, dir);
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl') && !f.includes(':'));

      for (const f of files) {
        try {
          const stat = fs.statSync(path.join(dirPath, f));
          const createdAfterPid = stat.birthtimeMs >= creationTime - 60_000;
          const recentlyModified = now - stat.mtimeMs < 5 * 60 * 1000;
          if (createdAfterPid && recentlyModified && stat.mtimeMs > bestMtime) {
            bestMtime = stat.mtimeMs;
            bestDir = dir;
          }
        } catch { /* skip */ }
      }
    }

    if (bestDir) {
      // Decode the project directory name back to a path
      return decodeWindowsProjectDir(bestDir);
    }
  } catch { /* best effort */ }

  return undefined;
}

/**
 * Find the terminal window handle for a process by walking up the parent chain.
 *
 * Special handling for Windows Terminal (WinUI 3) — Get-Process.MainWindowHandle
 * returns 0 for WinUI 3 apps, so we use EnumWindows to find visible windows
 * owned by the WindowsTerminal.exe process. We also exclude explorer.exe
 * which is the Windows shell and would match any open File Explorer window.
 */
async function findTerminalWindowHandle(
  pid: number,
  tree: Map<number, ProcessTreeEntry>,
): Promise<string | undefined> {
  let current = pid;
  const visited = new Set<number>();
  const candidatePids: number[] = [];
  let terminalProcessPid: number | undefined;

  while (current > 0 && !visited.has(current)) {
    visited.add(current);
    const proc = tree.get(current);
    if (!proc) break;

    const name = proc.name.toLowerCase();

    // Skip explorer.exe — it's the Windows shell, not a terminal.
    // Its MainWindowHandle points to File Explorer windows.
    if (name !== 'explorer.exe') {
      candidatePids.push(proc.pid);
    }

    // Remember if we found the actual GUI terminal process
    if (name === 'windowsterminal.exe' || name === 'conemu64.exe' || name === 'conemu.exe' || name === 'mintty.exe') {
      terminalProcessPid = proc.pid;
    }

    current = proc.parentPid;
  }

  // For Windows Terminal (WinUI 3), MainWindowHandle is 0 via Get-Process.
  // Use EnumWindows + GetWindowThreadProcessId to find its visible windows.
  if (terminalProcessPid) {
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class WinEnum {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    public static List<IntPtr> GetVisibleWindows(uint targetPid) {
        var result = new List<IntPtr>();
        EnumWindows((hWnd, lParam) => {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == targetPid && IsWindowVisible(hWnd) && GetWindowTextLength(hWnd) > 0) {
                result.Add(hWnd);
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
"@
$windows = [WinEnum]::GetVisibleWindows(${terminalProcessPid})
if ($windows.Count -gt 0) {
    Write-Output $windows[0].ToString()
} else {
    Write-Output ""
}
`,
      ], { timeout: 8000 });

      const handle = stdout.trim();
      if (handle && handle !== '0' && handle !== '') {
        return handle;
      }
    } catch {
      // Fall through to standard approach
    }
  }

  if (candidatePids.length === 0) return undefined;

  // Fallback: check candidate PIDs for MainWindowHandle (explorer.exe already excluded)
  try {
    const pidList = candidatePids.join(',');
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `@(${pidList}) | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { "$($_.ToString())|$($p.MainWindowHandle)" } }`,
    ], { timeout: 8000 });

    for (const line of stdout.trim().split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split('|');
      if (parts.length >= 2 && parts[1] !== '0') {
        return parts[1];
      }
    }
  } catch {
    // Best effort
  }

  return undefined;
}

/**
 * Match a CWD to a session by finding the most recently modified JSONL file
 * in the corresponding project directory.
 */
async function matchCwdToSession(
  cwd: string,
  pidCreationTime: number,
  claudeHome: string,
): Promise<string | undefined> {
  try {
    // Encode the CWD path to match Claude's project directory naming
    const projectDir = encodeWindowsPath(cwd);
    const sessionsDir = path.join(claudeHome, 'projects', projectDir);

    if (!fs.existsSync(sessionsDir)) return undefined;

    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl') && !f.includes(':'));

    let bestFile = '';
    let bestMtime = 0;
    const now = Date.now();

    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(sessionsDir, f));
        // File must be created after PID started (with 60s tolerance)
        // and modified recently (within 5 minutes)
        const createdAfterPid = stat.birthtimeMs >= pidCreationTime - 60_000;
        const recentlyModified = now - stat.mtimeMs < 5 * 60 * 1000;
        if (createdAfterPid && recentlyModified && stat.mtimeMs > bestMtime) {
          bestMtime = stat.mtimeMs;
          bestFile = f;
        }
      } catch { /* skip */ }
    }

    if (bestFile) return bestFile.replace('.jsonl', '');
  } catch { /* best effort */ }

  return undefined;
}

/**
 * Find a tasks directory reference for a given PID by scanning
 * the .claude/tasks directory for recently modified files.
 */
async function findTasksDirForPid(
  pid: number,
  _claudeHome: string,
): Promise<string | undefined> {
  try {
    // Try to find open file handles for this process that reference tasks dirs
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`,
    ], { timeout: 5000 });

    // Check command line for tasks dir references
    const tasksRe = /\.claude[\\/]tasks[\\/]([^\s\\/]+)/;
    const match = tasksRe.exec(stdout);
    if (match) return match[1];
  } catch { /* best effort */ }

  return undefined;
}

/**
 * Encode a Windows path to match Claude's project directory naming convention.
 * e.g., "C:\Users\alice\project" → "C--Users-alice-project"
 */
export function encodeWindowsPath(filePath: string): string {
  // Claude encodes EVERY non-alphanumeric char as a single dash.
  return filePath.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Decode a Windows-encoded project directory name back to a path.
 * e.g., "C--Users-alice-project" → "C:\Users\alice\project"
 *
 * Heuristic: The first segment is a drive letter (single char followed by --),
 * then remaining dashes are path separators.
 */
export function decodeWindowsProjectDir(dirName: string): string {
  // Pattern: "C--Users-..." where "C-" is the drive letter followed by double-dash
  const driveMatch = /^([A-Za-z])-(-.*)?$/.exec(dirName);
  if (!driveMatch) {
    return dirName.replace(/-/g, '\\');
  }

  const drive = driveMatch[1];
  const rest = driveMatch[2] ?? '';

  // Naive decode: every dash becomes a backslash
  const naive = `${drive}:${rest.replace(/^-/, '\\').replace(/-/g, '\\')}`;

  // Smart decode: Claude CLI encodes both path separators AND spaces as dashes.
  // Always run the smart decoder because the naive path may match a spurious
  // directory tree (e.g. created by a previous buggy decode), while the real
  // project lives in a path with spaces like "Claude Code Projects".
  const segments = rest.replace(/^-/, '').split('-');
  if (segments.length === 0) return naive;

  let resolved = `${drive}:${path.sep}`;
  let i = 0;
  while (i < segments.length) {
    // Try progressively joining segments with spaces to find a match
    let matched = false;
    for (let j = segments.length; j > i; j--) {
      const candidate = segments.slice(i, j).join(' ');
      const testPath = resolved + candidate;
      if (fs.existsSync(testPath)) {
        resolved = testPath + path.sep;
        i = j;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // No filesystem match — use the segment as-is (separator-separated)
      resolved += segments[i] + path.sep;
      i++;
    }
  }

  // Remove trailing separator
  const smart = resolved.replace(/[\\/]$/, '');

  // Prefer the smart result if it exists, otherwise fall back to naive
  if (fs.existsSync(smart)) return smart;
  return naive;
}
