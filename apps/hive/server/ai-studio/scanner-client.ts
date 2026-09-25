import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export interface ScanResult {
  projectPath: string;
  scanDate: string;
  healthScore: number;
  todoCount: number;
  fixmeCount: number;
  totalFiles: number;
  totalSizeMb: number;
  outdatedDeps: number;
  largeFiles: Array<{ path: string; sizeKb: number }>;
  todoItems: Array<{ file: string; line: number; text: string; type: 'TODO' | 'FIXME' | 'HACK' | 'XXX' }>;
  outdatedDepsList: Array<{ name: string; current: string; wanted: string; latest: string }>;
  filesByExtension: Record<string, { count: number; totalSizeKb: number }>;
  hasTests: boolean;
  testFileCount: number;
  sourceFileCount: number;
  testCoverageRatio: number;
  errors: string[];
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.cache',
  'coverage', '.nyc_output', '__pycache__', '.venv', 'venv', '.tox',
  'bin', 'obj', '.vs', '.idea', 'packages', '.nuget', 'bower_components',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.cs', '.java', '.go', '.rs',
  '.rb', '.php', '.swift', '.kt', '.scala', '.c', '.cpp', '.h', '.hpp',
  '.vue', '.svelte', '.astro',
]);

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.go$/,
  /test_.*\.py$/,
  /.*_test\.py$/,
  /Tests?\.cs$/,
  /Test\.java$/,
];

const TODO_REGEX = /\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/i;

const LARGE_FILE_THRESHOLD_KB = 500;
const MAX_FILE_SIZE_FOR_SCAN_BYTES = 1024 * 1024; // 1MB - skip scanning content of files larger than this

export class ScannerClient {
  async scanProject(projectPath: string): Promise<ScanResult> {
    const resolvedPath = path.resolve(projectPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`);
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`Project path is not a directory: ${resolvedPath}`);
    }

    const errors: string[] = [];
    const todoItems: ScanResult['todoItems'] = [];
    const largeFiles: ScanResult['largeFiles'] = [];
    const filesByExtension: ScanResult['filesByExtension'] = {};
    let totalFiles = 0;
    let totalSizeBytes = 0;
    let testFileCount = 0;
    let sourceFileCount = 0;

    // Walk the directory tree
    this.walkDirectory(resolvedPath, resolvedPath, (filePath, stats) => {
      totalFiles++;
      totalSizeBytes += stats.size;

      const ext = path.extname(filePath).toLowerCase();
      const relPath = path.relative(resolvedPath, filePath).replace(/\\/g, '/');

      // Track file size distribution
      if (!filesByExtension[ext || '(none)']) {
        filesByExtension[ext || '(none)'] = { count: 0, totalSizeKb: 0 };
      }
      filesByExtension[ext || '(none)'].count++;
      filesByExtension[ext || '(none)'].totalSizeKb += stats.size / 1024;

      // Track large files
      const sizeKb = Math.round(stats.size / 1024);
      if (sizeKb > LARGE_FILE_THRESHOLD_KB) {
        largeFiles.push({ path: relPath, sizeKb });
      }

      // Check if it's a test file
      const isTest = TEST_PATTERNS.some(p => p.test(filePath));
      if (isTest) testFileCount++;

      // Check if it's a source file
      if (SOURCE_EXTENSIONS.has(ext)) {
        sourceFileCount++;
      }

      // Scan for TODO/FIXME in source files
      if (SOURCE_EXTENSIONS.has(ext) && stats.size < MAX_FILE_SIZE_FOR_SCAN_BYTES) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(TODO_REGEX);
            if (match) {
              const type = match[1].toUpperCase() as 'TODO' | 'FIXME' | 'HACK' | 'XXX';
              todoItems.push({
                file: relPath,
                line: i + 1,
                text: match[2]?.trim() || lines[i].trim(),
                type,
              });
            }
          }
        } catch {
          // Skip files that can't be read as UTF-8
        }
      }
    });

    // Sort large files by size descending, take top 20
    largeFiles.sort((a, b) => b.sizeKb - a.sizeKb);
    const topLargeFiles = largeFiles.slice(0, 20);

    // Skip npm outdated check — it's slow and only reports third-party library versions
    const outdatedDepsList: ScanResult['outdatedDepsList'] = [];

    const todoCount = todoItems.filter(t => t.type === 'TODO').length;
    const fixmeCount = todoItems.filter(t => t.type === 'FIXME').length;
    const totalSizeMb = Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100;
    const testCoverageRatio = sourceFileCount > 0 ? Math.round((testFileCount / sourceFileCount) * 100) / 100 : 0;
    const hasTests = testFileCount > 0;

    // Calculate health score (0-100)
    const healthScore = this.calculateHealthScore({
      todoCount: todoItems.length,
      fixmeCount,
      outdatedDeps: outdatedDepsList.length,
      testCoverageRatio,
      hasTests,
      largeFileCount: topLargeFiles.length,
    });

    return {
      projectPath: resolvedPath,
      scanDate: new Date().toISOString(),
      healthScore,
      todoCount,
      fixmeCount,
      totalFiles,
      totalSizeMb,
      outdatedDeps: outdatedDepsList.length,
      largeFiles: topLargeFiles,
      todoItems: todoItems.slice(0, 200), // Limit to 200 items
      outdatedDepsList,
      filesByExtension,
      hasTests,
      testFileCount,
      sourceFileCount,
      testCoverageRatio,
      errors,
    };
  }

  private walkDirectory(
    dir: string,
    rootDir: string,
    callback: (filePath: string, stats: fs.Stats) => void,
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Skip directories we can't read
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;

      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          this.walkDirectory(fullPath, rootDir, callback);
        } else if (entry.isFile()) {
          const stats = fs.statSync(fullPath);
          callback(fullPath, stats);
        }
      } catch {
        // Skip files/dirs we can't access
      }
    }
  }

  // @ts-expect-error Reserved for future use
  private _checkOutdatedDeps(projectDir: string): ScanResult['outdatedDepsList'] {
    try {
      // Check if npm is available and package.json exists
      const result = execSync('npm outdated --json 2>/dev/null || echo "{}"', {
        cwd: projectDir,
        timeout: 30000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const parsed = JSON.parse(result.trim() || '{}');
      const deps: ScanResult['outdatedDepsList'] = [];

      for (const [name, info] of Object.entries(parsed)) {
        const dep = info as { current?: string; wanted?: string; latest?: string };
        if (dep.current && dep.latest && dep.current !== dep.latest) {
          deps.push({
            name,
            current: dep.current || 'unknown',
            wanted: dep.wanted || dep.current || 'unknown',
            latest: dep.latest || 'unknown',
          });
        }
      }

      return deps;
    } catch {
      return [];
    }
  }

  private calculateHealthScore(params: {
    todoCount: number;
    fixmeCount: number;
    outdatedDeps: number;
    testCoverageRatio: number;
    hasTests: boolean;
    largeFileCount: number;
  }): number {
    let score = 100;

    // Deduct for TODOs (up to -15)
    score -= Math.min(15, params.todoCount * 0.5);

    // Deduct for FIXMEs (up to -20, they're more urgent)
    score -= Math.min(20, params.fixmeCount * 2);

    // Deduct for outdated deps (up to -20)
    score -= Math.min(20, params.outdatedDeps * 2);

    // Deduct for no tests (-15)
    if (!params.hasTests) {
      score -= 15;
    } else {
      // Reward for good test ratio (up to +5 bonus, but don't exceed 100)
      if (params.testCoverageRatio > 0.3) {
        score = Math.min(100, score + 5);
      }
    }

    // Deduct for large files (up to -10)
    score -= Math.min(10, params.largeFileCount);

    return Math.max(0, Math.round(score));
  }
}
