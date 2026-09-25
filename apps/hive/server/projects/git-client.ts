import { execSync } from 'node:child_process';
import fs from 'node:fs';

export interface GitFileStatus {
  status: string;       // 'M' | 'A' | 'D' | '?' | 'R' | 'C' | 'U' | 'MM' | 'AM' etc.
  staged: boolean;
  file: string;
  origFile?: string;    // For renames
}

export interface GitStatusResult {
  branch: string;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
}

export interface GitDiffResult {
  staged: string;
  unstaged: string;
  fullDiff: string;
  stagedDiff: string;
  summary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

export interface GitBranch {
  name: string;
  shortHash: string;
  date: string;
  subject: string;
  isCurrent: boolean;
  isRemote: boolean;
  isStale: boolean;
}

export interface GitBranchesResult {
  current: string;
  branches: GitBranch[];
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export class GitClient {
  /**
   * Run a git command in a project directory and return stdout.
   * On error, returns whatever stdout was produced (some git commands
   * write useful output to stdout even when they exit non-zero).
   */
  private exec(projectPath: string, command: string): string {
    try {
      return execSync(command, {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 10000,
        windowsHide: true,
      }).trim();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'stdout' in err) {
        return ((err as { stdout: string }).stdout ?? '').trim();
      }
      throw err;
    }
  }

  /**
   * Get the `origin` remote URL for a project, or null if there is none
   * (no remote, or not a git repo). Used to tie skill requirements to the
   * actual remote repo rather than a local folder name.
   */
  getOriginUrl(projectPath: string): string | null {
    if (!fs.existsSync(projectPath)) return null;
    try {
      const out = this.exec(projectPath, 'git remote get-url origin');
      if (!out || out.startsWith('fatal') || out.startsWith('error')) return null;
      return out.trim();
    } catch {
      return null;
    }
  }

  /** Check whether a directory is inside a git repo. */
  isGitRepo(projectPath: string): boolean {
    if (!fs.existsSync(projectPath)) return false;
    try {
      this.exec(projectPath, 'git rev-parse --is-inside-work-tree');
      return true;
    } catch {
      return false;
    }
  }

  getStatus(projectPath: string, compareBranch?: string): GitStatusResult {
    let branch = this.exec(projectPath, 'git branch --show-current');
    // Fallback for detached HEAD (--show-current returns empty)
    if (!branch) {
      try {
        branch = this.exec(projectPath, 'git rev-parse --abbrev-ref HEAD');
      } catch {
        branch = '';
      }
    }

    if (compareBranch) {
      // Show files that differ between HEAD and the selected branch
      const nameStatus = this.exec(projectPath, `git diff --name-status ${compareBranch}...HEAD`);
      const files = this.parseBranchDiffStatus(nameStatus);

      // Ahead/behind relative to the compare branch
      let ahead = 0;
      let behind = 0;
      try {
        const abOutput = this.exec(projectPath, `git rev-list --left-right --count HEAD...${compareBranch}`);
        const parts = abOutput.split(/\s+/);
        if (parts.length >= 2) {
          ahead = parseInt(parts[0], 10) || 0;
          behind = parseInt(parts[1], 10) || 0;
        }
      } catch {
        // ignore
      }

      return { branch: branch || '(detached)', files, ahead, behind };
    }

    const status = this.exec(projectPath, 'git status --porcelain');

    // Ahead/behind
    let ahead = 0;
    let behind = 0;
    try {
      const abOutput = this.exec(projectPath, 'git rev-list --left-right --count HEAD...@{u}');
      const parts = abOutput.split(/\s+/);
      if (parts.length >= 2) {
        ahead = parseInt(parts[0], 10) || 0;
        behind = parseInt(parts[1], 10) || 0;
      }
    } catch {
      // No upstream configured
    }

    return {
      branch: branch || '(detached)',
      files: this.parseStatusLines(status),
      ahead,
      behind,
    };
  }

  getDiff(projectPath: string, compareBranch?: string): GitDiffResult {
    if (compareBranch) {
      // Diff current branch against the specified branch
      const branchDiff = this.exec(projectPath, `git diff ${compareBranch}...HEAD`);
      const branchStat = this.exec(projectPath, `git diff ${compareBranch}...HEAD --stat`);
      const summary = this.parseDiffSummary(branchStat, '');
      return { staged: '', unstaged: '', fullDiff: branchDiff, stagedDiff: '', summary };
    }
    const staged = this.exec(projectPath, 'git diff --cached --stat');
    const unstaged = this.exec(projectPath, 'git diff --stat');
    const fullDiff = this.exec(projectPath, 'git diff');
    const stagedDiff = this.exec(projectPath, 'git diff --cached');

    // Parse summary from --stat outputs
    const summary = this.parseDiffSummary(staged, unstaged);

    return { staged, unstaged, fullDiff, stagedDiff, summary };
  }

  getBranches(projectPath: string): GitBranchesResult {
    const current = this.exec(projectPath, 'git branch --show-current');
    const output = this.exec(
      projectPath,
      'git branch -a --format="%(refname:short)|%(objectname:short)|%(committerdate:relative)|%(committerdate:iso8601)|%(subject)"'
    );
    return {
      current: current || '(detached)',
      branches: this.parseBranches(output, current),
    };
  }

  // --- Parsers ---

  private parseBranchDiffStatus(output: string): GitFileStatus[] {
    if (!output) return [];
    const files: GitFileStatus[] = [];
    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      // Format: "M\tfile" or "R100\told\tnew"
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const statusCode = parts[0].trim();
      const status = statusCode[0]; // M, A, D, R, C, etc.
      if (status === 'R' || status === 'C') {
        files.push({ status, staged: false, file: parts[2] || parts[1], origFile: parts[1] });
      } else {
        files.push({ status, staged: false, file: parts[1] });
      }
    }
    return files;
  }

  private parseStatusLines(output: string): GitFileStatus[] {
    if (!output) return [];
    const files: GitFileStatus[] = [];

    for (const line of output.split('\n')) {
      if (line.length < 4) continue; // minimum: "XY filename"

      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePart = line.slice(3);

      // Handle renames: "R  old -> new"
      let file = filePart;
      let origFile: string | undefined;
      if (filePart.includes(' -> ')) {
        const parts = filePart.split(' -> ');
        origFile = parts[0];
        file = parts[1];
      }

      // Staged changes (index column)
      if (indexStatus !== ' ' && indexStatus !== '?') {
        files.push({
          status: indexStatus,
          staged: true,
          file,
          origFile,
        });
      }

      // Unstaged / untracked changes (work-tree column)
      if (workTreeStatus !== ' ') {
        files.push({
          status: workTreeStatus === '?' ? '?' : workTreeStatus,
          staged: false,
          file,
          origFile,
        });
      }
    }

    return files;
  }

  private parseDiffSummary(
    stagedStat: string,
    unstagedStat: string
  ): { filesChanged: number; insertions: number; deletions: number } {
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;

    for (const stat of [stagedStat, unstagedStat]) {
      if (!stat) continue;
      // Last line looks like: " 3 files changed, 42 insertions(+), 12 deletions(-)"
      const summaryLine = stat.split('\n').pop() || '';
      const filesMatch = summaryLine.match(/(\d+)\s+file/);
      const insMatch = summaryLine.match(/(\d+)\s+insertion/);
      const delMatch = summaryLine.match(/(\d+)\s+deletion/);
      if (filesMatch) filesChanged += parseInt(filesMatch[1], 10);
      if (insMatch) insertions += parseInt(insMatch[1], 10);
      if (delMatch) deletions += parseInt(delMatch[1], 10);
    }

    return { filesChanged, insertions, deletions };
  }

  private parseBranches(output: string, currentBranch: string): GitBranch[] {
    if (!output) return [];
    const branches: GitBranch[] = [];
    const now = Date.now();

    for (const line of output.split('\n')) {
      if (!line) continue;
      const parts = line.split('|');
      if (parts.length < 5) continue;

      const name = parts[0].trim();
      const shortHash = parts[1].trim();
      const relativeDate = parts[2].trim();
      const isoDate = parts[3].trim();
      const subject = parts[4].trim();

      // Skip HEAD pointer entries
      if (name === 'HEAD' || name.includes('HEAD')) continue;

      const isRemote = name.startsWith('origin/');
      const isCurrent = name === currentBranch;

      // Calculate staleness
      let isStale = false;
      if (isoDate) {
        try {
          const branchTime = new Date(isoDate).getTime();
          isStale = now - branchTime > THIRTY_DAYS_MS;
        } catch {
          // ignore parse errors
        }
      }

      branches.push({
        name,
        shortHash,
        date: relativeDate,
        subject,
        isCurrent,
        isRemote,
        isStale,
      });
    }

    return branches;
  }
}

// Singleton
export const gitClient = new GitClient();
