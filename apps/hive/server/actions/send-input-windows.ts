import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SendInputRequest } from '../types.js';

const execFileAsync = promisify(execFile);

/**
 * PowerShell script that writes text directly to a process's console input
 * buffer using AttachConsole + WriteConsoleInput.
 *
 * This avoids all window-focusing issues (SendKeys, SetForegroundWindow)
 * because it writes to the console buffer, not to a GUI window.
 */
function buildWriteConsoleInputScript(claudePid: number, text: string, pressEnter: boolean): string {
  // Escape for PowerShell string embedding (single quotes inside here-string)
  const psText = text.replace(/'/g, "''");

  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class ConsoleInput {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AttachConsole(uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern IntPtr CreateFile(
        string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        IntPtr lpSecurityAttributes, uint dwCreationDisposition,
        uint dwFlagsAndAttributes, IntPtr hTemplateFile
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUT_RECORD {
        [FieldOffset(0)] public ushort EventType;
        [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
    }

    [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
    public struct KEY_EVENT_RECORD {
        [FieldOffset(0)]  public bool bKeyDown;
        [FieldOffset(4)]  public ushort wRepeatCount;
        [FieldOffset(6)]  public ushort wVirtualKeyCode;
        [FieldOffset(8)]  public ushort wVirtualScanCode;
        [FieldOffset(10)] public char UnicodeChar;
        [FieldOffset(12)] public uint dwControlKeyState;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool WriteConsoleInput(
        IntPtr hConsoleInput,
        INPUT_RECORD[] lpBuffer,
        uint nLength,
        out uint lpNumberOfEventsWritten
    );

    public const ushort KEY_EVENT = 0x0001;

    public static bool SendText(uint pid, string text) {
        FreeConsole();
        if (!AttachConsole(pid)) return false;

        // Prevent Ctrl+C from killing us while attached
        SetConsoleCtrlHandler(IntPtr.Zero, true);

        try {
            // Open CONIN$ directly — GetStdHandle returns stale handles
            // after FreeConsole + AttachConsole
            IntPtr hInput = CreateFile("CONIN$",
                0xC0000000, // GENERIC_READ | GENERIC_WRITE
                0x00000001, // FILE_SHARE_READ
                IntPtr.Zero,
                3,          // OPEN_EXISTING
                0, IntPtr.Zero);
            if (hInput == (IntPtr)(-1)) return false;

            var records = new INPUT_RECORD[text.Length * 2];
            for (int i = 0; i < text.Length; i++) {
                char c = text[i];
                ushort vk = 0;
                if (c == '\\r' || c == '\\n') vk = 0x0D; // VK_RETURN

                // Key down
                records[i * 2].EventType = KEY_EVENT;
                records[i * 2].KeyEvent.bKeyDown = true;
                records[i * 2].KeyEvent.wRepeatCount = 1;
                records[i * 2].KeyEvent.wVirtualKeyCode = vk;
                records[i * 2].KeyEvent.UnicodeChar = c;
                records[i * 2].KeyEvent.dwControlKeyState = 0;

                // Key up
                records[i * 2 + 1].EventType = KEY_EVENT;
                records[i * 2 + 1].KeyEvent.bKeyDown = false;
                records[i * 2 + 1].KeyEvent.wRepeatCount = 1;
                records[i * 2 + 1].KeyEvent.wVirtualKeyCode = vk;
                records[i * 2 + 1].KeyEvent.UnicodeChar = c;
                records[i * 2 + 1].KeyEvent.dwControlKeyState = 0;
            }

            uint written;
            bool ok = WriteConsoleInput(hInput, records, (uint)records.Length, out written);
            CloseHandle(hInput);
            return ok && written > 0;
        } finally {
            SetConsoleCtrlHandler(IntPtr.Zero, false);
            FreeConsole();
        }
    }
}
"@

$text = '${psText}'
${pressEnter ? "$text += \"`r\"" : ''}

$targetPid = ${claudePid}
$result = [ConsoleInput]::SendText($targetPid, $text)
if ($result) {
    Write-Output "ok"
} else {
    Write-Output "attach_failed"
}
`;
}

/**
 * PowerShell script to send Ctrl+C to a process's console.
 */
function buildCtrlCScript(claudePid: number): string {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("kernel32.dll")]
    public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);
    [DllImport("kernel32.dll")]
    public static extern bool AttachConsole(uint dwProcessId);
    [DllImport("kernel32.dll")]
    public static extern bool FreeConsole();
    [DllImport("kernel32.dll")]
    public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
}
"@

$targetPid = ${claudePid}

try {
    [WinAPI]::FreeConsole() | Out-Null
    if ([WinAPI]::AttachConsole($targetPid)) {
        [WinAPI]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
        [WinAPI]::GenerateConsoleCtrlEvent(0, 0) | Out-Null
        Start-Sleep -Milliseconds 100
        [WinAPI]::SetConsoleCtrlHandler([IntPtr]::Zero, $false) | Out-Null
        [WinAPI]::FreeConsole() | Out-Null
        Write-Output "ok"
        exit 0
    }
} catch {}

Write-Output "attach_failed"
`;
}

/**
 * Send input to a Windows terminal pane.
 *
 * Uses AttachConsole + WriteConsoleInput to write directly to the
 * console input buffer. No window focusing or SendKeys needed.
 *
 * paneId format: "win:{terminal}:{pid}:{hwnd}"
 */
export async function sendInputWindows(
  paneId: string,
  input: string,
  type: SendInputRequest['type'],
): Promise<{ ok: boolean; error?: string }> {
  if (!paneId.startsWith('win:')) {
    return { ok: false, error: `Not a Windows pane ID: ${paneId}` };
  }

  const parts = paneId.split(':');
  if (parts.length < 3) {
    return { ok: false, error: `Invalid Windows pane ID: ${paneId}` };
  }

  const claudePid = parseInt(parts[2], 10);
  if (isNaN(claudePid)) {
    return { ok: false, error: `Invalid PID: ${paneId}` };
  }

  try {
    let script: string;

    switch (type) {
      case 'approve':
      case 'reject':
      case 'text': {
        const text = type === 'approve' ? 'y' : type === 'reject' ? 'n' : input;
        script = buildWriteConsoleInputScript(claudePid, text, true);
        break;
      }
      case 'abort':
        script = buildCtrlCScript(claudePid);
        break;
      default:
        return { ok: false, error: `Unknown input type: ${type}` };
    }

    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      script,
    ], { timeout: 15000 });

    const result = stdout.trim();
    if (result === 'ok') {
      return { ok: true };
    }
    if (result === 'attach_failed') {
      return { ok: false, error: 'Could not attach to process console' };
    }
    return { ok: false, error: `Unexpected result: ${result}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
