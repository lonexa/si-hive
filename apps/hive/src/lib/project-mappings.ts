import { API_BASE } from '@/lib/api-config';

let cachedDirs: string[] | null = null;

export async function getAvailableDirs(): Promise<string[]> {
  if (cachedDirs) return cachedDirs;
  try {
    const res = await fetch(`${API_BASE}/api/projects`);
    const data = await res.json();
    const dirs = (data.projects || data || []).map((p: { path?: string }) => p.path).filter(Boolean) as string[];
    cachedDirs = dirs;
    return dirs;
  } catch {
    return [];
  }
}

/**
 * Working directory for helper AI sessions launched from the UI ("ask Claude
 * about this", analysis buttons, …). Uses the first known project; callers
 * fall back to the server's own cwd when this is empty.
 */
export async function resolveDefaultProjectDir(): Promise<string> {
  const dirs = await getAvailableDirs();
  return dirs[0] || '';
}

/**
 * Resolve a directory basename hint (e.g., "ReportEngineToPython") to the local
 * full path on this user's machine. Each user may have the project checked out
 * in a different parent directory, so this matches against the user's own
 * /api/projects list rather than assuming a shared path.
 *
 * Returns '' if no match is found.
 */
export async function resolveDirHint(hint: string): Promise<string> {
  if (!hint || !hint.trim()) return '';
  const dirs = await getAvailableDirs();
  const trimmed = hint.trim();

  // If the hint already looks like an absolute path AND exists in the user's
  // list (or its basename does), use it as-is or via basename match.
  const looksAbsolute = /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('/');
  if (looksAbsolute) {
    if (dirs.includes(trimmed)) return trimmed;
    // fall through to basename match below
  }

  const lastSegment = trimmed.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || trimmed;
  const target = lastSegment.toLowerCase();

  // 1. Exact basename match (case-insensitive)
  for (const dir of dirs) {
    const base = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.toLowerCase() ?? '';
    if (base === target) return dir;
  }
  // 2. Substring match anywhere in the dir
  for (const dir of dirs) {
    if (dir.toLowerCase().includes(target)) return dir;
  }
  return '';
}

export function invalidateProjectDirsCache() {
  cachedDirs = null;
}
