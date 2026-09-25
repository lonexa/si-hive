import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readSharedStorageConfig, SHARED_DB_PASSWORD_REF } from '../../../../packages/shared/src/server/storage/index.js';
import { hasSecret } from '../../../../packages/shared/src/server/credentials.js';
import { loadConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudePermissions {
  settingsPath: string;
  exists: boolean;
  permissions: Record<string, unknown> | null;
  allowedTools: string[];
  deniedTools: string[];
  mcpServers: McpServerInfo[];
}

export interface McpServerInfo {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ClaudeMdInfo {
  projectPath: string;
  filePath: string;
  exists: boolean;
  sizeBytes: number;
  snippet: string;
}

export interface DatabaseAccessInfo {
  database: string;
  accountType: 'primary' | 'processing';
  user: string;
  hasCredentials: boolean;
}

export interface ProjectPermissionSummary {
  projectName: string;
  projectPath: string;
  hasClaudeMd: boolean;
  claudeMdSnippet: string | null;
  hasProjectSettings: boolean;
}

export interface PermissionFlags {
  excessiveDbAccess: boolean;
  noClaudeMdRestrictions: string[];
  mcpServerCount: number;
  unreviewedProjects: string[];
}

export interface PermissionAuditReport {
  timestamp: string;
  machine: string;
  username: string;
  claudePermissions: ClaudePermissions;
  claudeMdFiles: ClaudeMdInfo[];
  databaseAccess: DatabaseAccessInfo[];
  projectSummaries: ProjectPermissionSummary[];
  flags: PermissionFlags;
  nextQuarterlyReview: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class PermissionsClient {

  /**
   * Build a full permission audit report by reading local config files.
   */
  async getPermissionAudit(): Promise<PermissionAuditReport> {
    const username = os.userInfo().username;
    const machine = os.hostname();

    const claudePermissions = this.readClaudeSettings();
    const claudeMdFiles = this.scanClaudeMdFiles();
    const databaseAccess = this.getDatabaseAccessInfo();
    const projectSummaries = this.getProjectSummaries(claudeMdFiles);
    const flags = this.computeFlags(claudePermissions, claudeMdFiles, projectSummaries, databaseAccess);

    // Next quarterly review: first day of next quarter
    const now = new Date();
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const nextQuarterMonth = (currentQuarter + 1) * 3;
    const nextReviewDate = new Date(now.getFullYear(), nextQuarterMonth, 1);
    if (nextQuarterMonth >= 12) {
      nextReviewDate.setFullYear(now.getFullYear() + 1);
      nextReviewDate.setMonth(nextQuarterMonth - 12);
    }

    return {
      timestamp: new Date().toISOString(),
      machine,
      username,
      claudePermissions,
      claudeMdFiles,
      databaseAccess,
      projectSummaries,
      flags,
      nextQuarterlyReview: nextReviewDate.toISOString().slice(0, 10),
    };
  }

  // -------------------------------------------------------------------------
  // Read ~/.claude/settings.json
  // -------------------------------------------------------------------------

  private readClaudeSettings(): ClaudePermissions {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const result: ClaudePermissions = {
      settingsPath,
      exists: false,
      permissions: null,
      allowedTools: [],
      deniedTools: [],
      mcpServers: [],
    };

    try {
      if (!fs.existsSync(settingsPath)) return result;
      result.exists = true;

      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      result.permissions = raw;

      // Extract allowed/denied tools
      if (Array.isArray(raw.permissions?.allow)) {
        result.allowedTools = raw.permissions.allow.map((t: unknown) =>
          typeof t === 'string' ? t : JSON.stringify(t)
        );
      }
      if (Array.isArray(raw.permissions?.deny)) {
        result.deniedTools = raw.permissions.deny.map((t: unknown) =>
          typeof t === 'string' ? t : JSON.stringify(t)
        );
      }

      // Extract MCP servers
      if (raw.mcpServers && typeof raw.mcpServers === 'object') {
        for (const [name, serverConfig] of Object.entries(raw.mcpServers)) {
          const cfg = serverConfig as Record<string, unknown>;
          result.mcpServers.push({
            name,
            command: typeof cfg.command === 'string' ? cfg.command : '',
            args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
            env: (cfg.env && typeof cfg.env === 'object') ? cfg.env as Record<string, string> : {},
          });
        }
      }
    } catch {
      // File exists but couldn't parse — leave defaults
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Scan for CLAUDE.md files in known project directories
  // -------------------------------------------------------------------------

  private scanClaudeMdFiles(): ClaudeMdInfo[] {
    const results: ClaudeMdInfo[] = [];

    try {
      const config = loadConfig();
      const projectPaths = config.projects?.map((p: { path: string }) => p.path) ?? [];

      const allPaths = [...new Set(projectPaths)];

      for (const projectPath of allPaths) {
        const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
        try {
          if (fs.existsSync(claudeMdPath)) {
            const stat = fs.statSync(claudeMdPath);
            const content = fs.readFileSync(claudeMdPath, 'utf-8');
            results.push({
              projectPath,
              filePath: claudeMdPath,
              exists: true,
              sizeBytes: stat.size,
              snippet: content.slice(0, 500),
            });
          } else {
            results.push({
              projectPath,
              filePath: claudeMdPath,
              exists: false,
              sizeBytes: 0,
              snippet: '',
            });
          }
        } catch {
          // Skip inaccessible paths
        }
      }
    } catch {
      // Config load failed — return empty
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Get database access info from config
  // -------------------------------------------------------------------------

  private getDatabaseAccessInfo(): DatabaseAccessInfo[] {
    const results: DatabaseAccessInfo[] = [];

    // The shared database (Settings → Storage) is the only database Hive holds credentials for.
    const cfg = readSharedStorageConfig();
    results.push({
      database: cfg.type === 'sqlite' ? `SQLite (${cfg.file || 'shared.db'})` : `${cfg.type} ${cfg.host ?? ''}/${cfg.database ?? ''}`,
      accountType: 'primary',
      user: cfg.type === 'sqlite' ? '(local file)' : cfg.user || '(not configured)',
      hasCredentials: cfg.type === 'sqlite' || hasSecret(SHARED_DB_PASSWORD_REF),
    });

    return results;
  }

  // -------------------------------------------------------------------------
  // Per-project permission summary
  // -------------------------------------------------------------------------

  private getProjectSummaries(claudeMdFiles: ClaudeMdInfo[]): ProjectPermissionSummary[] {
    const results: ProjectPermissionSummary[] = [];

    try {
      const config = loadConfig();
      const projects = config.projects ?? [];

      for (const project of projects) {
        const claudeMd = claudeMdFiles.find((c) => c.projectPath === project.path);

        // Check for project-level .claude/settings.json
        const projectSettingsPath = path.join(project.path, '.claude', 'settings.json');
        let hasProjectSettings = false;
        try {
          hasProjectSettings = fs.existsSync(projectSettingsPath);
        } catch { /* skip */ }

        results.push({
          projectName: project.name,
          projectPath: project.path,
          hasClaudeMd: claudeMd?.exists ?? false,
          claudeMdSnippet: claudeMd?.exists ? claudeMd.snippet : null,
          hasProjectSettings,
        });
      }
    } catch {
      // Config load failed
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Flag excessive permissions
  // -------------------------------------------------------------------------

  private computeFlags(
    claude: ClaudePermissions,
    _claudeMdFiles: ClaudeMdInfo[],
    projects: ProjectPermissionSummary[],
    dbAccess: DatabaseAccessInfo[],
  ): PermissionFlags {
    // Excessive DB access: more than 3 databases configured with credentials
    const dbsWithCreds = dbAccess.filter((d) => d.hasCredentials).length;

    // Projects with no CLAUDE.md (no restrictions defined)
    const noClaudeMd = projects
      .filter((p) => !p.hasClaudeMd)
      .map((p) => p.projectName);

    // Projects not reviewed recently (we can't track review dates without the audit_log table,
    // so just flag all projects as needing review if no project settings exist)
    const unreviewed = projects
      .filter((p) => !p.hasProjectSettings)
      .map((p) => p.projectName);

    return {
      excessiveDbAccess: dbsWithCreds > 3,
      noClaudeMdRestrictions: noClaudeMd,
      mcpServerCount: claude.mcpServers.length,
      unreviewedProjects: unreviewed,
    };
  }
}
