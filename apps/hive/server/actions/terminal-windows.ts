import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// PowerShell script to focus a window by process ID using Win32 API
const FOCUS_WINDOW_SCRIPT = `
param([int]$ProcessId)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
}
"@
$proc = Get-Process -Id $ProcessId -ErrorAction Stop
$hwnd = $proc.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output "no_window"
    exit 0
}
if ([WinAPI]::IsIconic($hwnd)) {
    [WinAPI]::ShowWindow($hwnd, 9)  # SW_RESTORE
}
[WinAPI]::SetForegroundWindow($hwnd) | Out-Null
Write-Output "ok"
`;

// PowerShell script to focus a window by its raw window handle (hwnd)
const FOCUS_HWND_SCRIPT = `
param([long]$Hwnd)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI2 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
}
"@
$h = [IntPtr]$Hwnd
if (-not [WinAPI2]::IsWindow($h)) {
    Write-Output "invalid_hwnd"
    exit 0
}
if ([WinAPI2]::IsIconic($h)) {
    [WinAPI2]::ShowWindow($h, 9)  # SW_RESTORE
}
[WinAPI2]::SetForegroundWindow($h) | Out-Null
Write-Output "ok"
`;

/**
 * Focus a Windows terminal window.
 *
 * paneId format: "win:{terminal}:{pid}:{hwnd}" where terminal is one of:
 *   windows-terminal, conemu, pwsh, cmd, mintty, unknown
 */
export async function focusPaneWindows(paneId: string): Promise<{ ok: boolean; error?: string }> {
  if (!paneId.startsWith('win:')) {
    return { ok: false, error: `Not a Windows pane ID: ${paneId}` };
  }

  const parts = paneId.split(':');
  if (parts.length < 3) {
    return { ok: false, error: `Invalid Windows pane ID format: ${paneId}` };
  }

  const terminalType = parts[1];
  const claudePid = parseInt(parts[2], 10);
  const cachedHwnd = parts[3] ?? '0';

  if (isNaN(claudePid)) {
    return { ok: false, error: `Invalid PID in pane ID: ${paneId}` };
  }

  // Check if the claude process is still alive
  let pidAlive = false;
  try {
    process.kill(claudePid, 0);
    pidAlive = true;
  } catch { /* process exited */ }

  // If PID is alive, try the normal approach (walk process tree to find terminal window)
  if (pidAlive) {
    try {
      const terminalPid = await findTerminalPid(claudePid, terminalType);
      const targetPid = terminalPid ?? claudePid;

      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        FOCUS_WINDOW_SCRIPT.replace('param([int]$ProcessId)', `$ProcessId = ${targetPid}`),
      ], { timeout: 10000 });

      const result = stdout.trim();
      if (result === 'ok') {
        return { ok: true };
      }

      if (result === 'no_window' && terminalPid && terminalPid !== claudePid) {
        return await focusByPidDirect(claudePid);
      }
    } catch { /* fall through to hwnd approach */ }
  }

  // Fallback: use the cached window handle directly
  if (cachedHwnd && cachedHwnd !== '0') {
    return await focusByHwnd(cachedHwnd);
  }

  return { ok: false, error: 'Terminal window not found (process exited and no cached window handle)' };
}

/**
 * Walk up the process tree to find the terminal's PID.
 */
async function findTerminalPid(claudePid: number, terminalType: string): Promise<number | undefined> {
  const terminalNames: Record<string, string[]> = {
    'windows-terminal': ['WindowsTerminal.exe'],
    'conemu': ['ConEmu64.exe', 'ConEmu.exe'],
    'mintty': ['mintty.exe'],
    'pwsh': ['pwsh.exe', 'powershell.exe'],
    'cmd': ['cmd.exe'],
  };

  const targetNames = terminalNames[terminalType];
  if (!targetNames) return undefined;

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `
      $pid = ${claudePid}
      $visited = @{}
      while ($pid -gt 0 -and -not $visited.ContainsKey($pid)) {
        $visited[$pid] = $true
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
        if (-not $proc) { break }
        $name = $proc.Name
        if ($name -in @(${targetNames.map(n => `'${n}'`).join(',')})) {
          Write-Output $pid
          exit 0
        }
        $pid = $proc.ParentProcessId
      }
      Write-Output ""
      `,
    ], { timeout: 8000 });

    const result = parseInt(stdout.trim(), 10);
    return isNaN(result) ? undefined : result;
  } catch {
    return undefined;
  }
}

/**
 * Directly focus a window by its PID.
 */
async function focusByPidDirect(pid: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      FOCUS_WINDOW_SCRIPT.replace('param([int]$ProcessId)', `$ProcessId = ${pid}`),
    ], { timeout: 10000 });

    return stdout.trim() === 'ok'
      ? { ok: true }
      : { ok: false, error: 'Could not focus terminal window' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Focus a window by its cached window handle (hwnd).
 * Used when the claude.exe process has exited but the terminal is still open.
 */
async function focusByHwnd(hwnd: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      FOCUS_HWND_SCRIPT.replace('param([long]$Hwnd)', `$Hwnd = ${hwnd}`),
    ], { timeout: 10000 });

    const result = stdout.trim();
    if (result === 'ok') return { ok: true };
    if (result === 'invalid_hwnd') return { ok: false, error: 'Window handle is no longer valid (terminal closed)' };
    return { ok: false, error: `Unexpected result: ${result}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
