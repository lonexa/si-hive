import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const isWindows = os.platform() === 'win32';

let _resolvedClaudePath: string | null = null;

export function claudeExePath(): string {
  if (_resolvedClaudePath) return _resolvedClaudePath;

  if (isWindows) {
    const home = os.homedir();
    // Try multiple name variants: claude.exe, claude.cmd, claude
    const candidates = ['claude.exe', 'claude.cmd', 'claude'];

    // 1. Try where.exe (works if Claude is in system PATH or current user PATH)
    for (const candidate of candidates) {
      try {
        const result = execFileSync('where.exe', [candidate], {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        }).trim();
        const lines = result.split(/\r?\n/).filter(Boolean);
        // Prefer .cmd or .exe files over extensionless files
        const preferred = lines.find(l => /\.(cmd|exe|bat)$/i.test(l)) ?? lines[0];
        if (preferred && fs.existsSync(preferred)) {
          console.log(`[claude-detect] Found via where.exe: ${preferred}`);
          _resolvedClaudePath = preferred;
          return _resolvedClaudePath;
        }
      } catch { /* where failed, try next candidate */ }
    }

    // 2. Well-known fallback locations
    //    Service runs as LocalSystem so PATH won't include user directories.
    //    os.homedir() may point to the installing user, not the current user.
    //    Scan ALL user profiles under C:\Users to find Claude wherever it's installed.
    const basenames = ['claude.exe', 'claude.cmd', 'claude'];
    const perUserSubdirs = [
      path.join('AppData', 'Roaming', 'npm'),
      path.join('AppData', 'Local', 'Programs'),
      path.join('AppData', 'Local', 'Programs', 'claude-code'),
      path.join('AppData', 'Local', 'Microsoft', 'WinGet', 'Links'),
      path.join('.local', 'bin'),
      path.join('AppData', 'Roaming', 'fnm', 'aliases', 'default'),
      path.join('scoop', 'shims'),
    ];

    // Build list of user home dirs to check (current homedir + all profiles)
    const homeDirs = new Set<string>([home]);
    // Always scan C:\Users regardless of what os.homedir() returns
    // (under LocalSystem, homedir is C:\Windows\system32\config\systemprofile)
    const usersRoots = new Set<string>(['C:\\Users']);
    // Also try parent of homedir in case it's a normal user profile
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
    console.log(`[claude-detect] Scanning ${homeDirs.size} user profiles: ${[...homeDirs].join(', ')}`);

    const dirs: string[] = [];
    for (const h of homeDirs) {
      for (const sub of perUserSubdirs) {
        dirs.push(path.join(h, sub));
      }
    }
    // Global locations
    dirs.push('C:\\Program Files\\nodejs', 'C:\\Program Files (x86)\\nodejs');

    for (const dir of dirs) {
      for (const name of basenames) {
        const p = path.join(dir, name);
        try {
          if (fs.existsSync(p)) {
            console.log(`[claude-detect] Found via fallback scan: ${p}`);
            _resolvedClaudePath = p;
            return _resolvedClaudePath;
          }
        } catch { /* skip inaccessible dirs */ }
      }
    }

    // 3. Scan user's PATH env var directly (may be forwarded by install-service)
    const userPath = process.env.PATH || '';
    for (const dir of userPath.split(';').filter(Boolean)) {
      for (const name of basenames) {
        const p = path.join(dir, name);
        try {
          if (fs.existsSync(p)) {
            console.log(`[claude-detect] Found via PATH scan: ${p}`);
            _resolvedClaudePath = p;
            return _resolvedClaudePath;
          }
        } catch { /* skip invalid path entries */ }
      }
    }

    console.warn(`[claude-detect] Could not find claude in any known location (homedir=${home})`);
    // Last resort fallback
    _resolvedClaudePath = 'claude.exe';
  } else {
    try {
      _resolvedClaudePath = execFileSync('which', ['claude'], {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch {
      _resolvedClaudePath = '/usr/local/bin/claude';
    }
  }

  return _resolvedClaudePath;
}

export function isClaudeInstalled(): boolean {
  const exePath = claudeExePath();
  return fs.existsSync(exePath);
}

export function getClaudeStatus(): { installed: boolean; exePath: string } {
  const exePath = claudeExePath();
  return {
    installed: fs.existsSync(exePath),
    exePath,
  };
}

/** Diagnostic endpoint — returns everything we checked so the user can report what's wrong */
export function getClaudeDiagnostics(): Record<string, unknown> {
  const home = os.homedir();
  const diag: Record<string, unknown> = {
    platform: os.platform(),
    homedir: home,
    userprofile: process.env.USERPROFILE,
    homeEnv: process.env.HOME,
    cwd: process.cwd(),
    resolvedPath: _resolvedClaudePath,
  };

  if (!isWindows) return diag;

  // Check where.exe
  const whereResults: Record<string, string> = {};
  for (const name of ['claude.exe', 'claude.cmd', 'claude']) {
    try {
      whereResults[name] = execFileSync('where.exe', [name], {
        encoding: 'utf-8', timeout: 5000, windowsHide: true,
      }).trim();
    } catch {
      whereResults[name] = 'NOT FOUND';
    }
  }
  diag.whereResults = whereResults;

  // List user profiles found
  const profiles: string[] = [];
  try {
    for (const entry of fs.readdirSync('C:\\Users', { withFileTypes: true })) {
      if (entry.isDirectory()) profiles.push(entry.name);
    }
  } catch (e) {
    diag.usersListError = String(e);
  }
  diag.profiles = profiles;

  // Check specific known paths
  const checks: Record<string, boolean> = {};
  for (const profile of profiles) {
    if (['Public', 'Default', 'Default User', 'All Users'].includes(profile)) continue;
    for (const name of ['claude.exe', 'claude.cmd', 'claude']) {
      const p = `C:\\Users\\${profile}\\AppData\\Roaming\\npm\\${name}`;
      try { checks[p] = fs.existsSync(p); } catch { checks[p] = false; }
    }
  }
  diag.fileChecks = checks;

  // PATH
  diag.path = (process.env.PATH || '').split(';').filter(Boolean);

  return diag;
}
