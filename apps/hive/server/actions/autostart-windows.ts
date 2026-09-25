import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const STARTUP_DIR = path.join(
  os.homedir(),
  'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
);
const SCRIPT_NAME = 'HiveServer.vbs';
const SCRIPT_PATH = path.join(STARTUP_DIR, SCRIPT_NAME);

export function enableAutostart(): { ok: boolean; message?: string; error?: string } {
  try {
    const serverScript = path.resolve(import.meta.dirname, '..', '..', 'dist-server', 'index.js');
    const serverDir = path.resolve(import.meta.dirname, '..', '..');

    const vbsContent = `
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "${serverDir.replace(/\\/g, '\\\\')}"
WshShell.Run "node ""${serverScript.replace(/\\/g, '\\\\')}"" ", 0, False
WScript.Sleep 2000
WshShell.Run "http://localhost:4747", 0, False
`.trim();

    fs.writeFileSync(SCRIPT_PATH, vbsContent, 'utf-8');
    return { ok: true, message: 'Auto-start enabled' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export function disableAutostart(): { ok: boolean; message?: string; error?: string } {
  try {
    if (fs.existsSync(SCRIPT_PATH)) {
      fs.unlinkSync(SCRIPT_PATH);
    }
    return { ok: true, message: 'Auto-start disabled' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export function isAutostartEnabled(): boolean {
  return fs.existsSync(SCRIPT_PATH);
}
