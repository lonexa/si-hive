import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertTriangle, ShieldCheck, Database, Server, FolderOpen, ChevronDown, ChevronRight, CalendarClock, ShieldAlert } from 'lucide-react';

import { API_BASE } from '@/lib/api-config';

// ---------------------------------------------------------------------------
// Types (mirroring server/security/permissions-client.ts)
// ---------------------------------------------------------------------------

interface McpServerInfo {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface ClaudePermissions {
  settingsPath: string;
  exists: boolean;
  permissions: Record<string, unknown> | null;
  allowedTools: string[];
  deniedTools: string[];
  mcpServers: McpServerInfo[];
}

interface ClaudeMdInfo {
  projectPath: string;
  filePath: string;
  exists: boolean;
  sizeBytes: number;
  snippet: string;
}

interface DatabaseAccessInfo {
  database: string;
  accountType: 'primary' | 'processing';
  user: string;
  hasCredentials: boolean;
}

interface ProjectPermissionSummary {
  projectName: string;
  projectPath: string;
  hasClaudeMd: boolean;
  claudeMdSnippet: string | null;
  hasProjectSettings: boolean;
}

interface PermissionFlags {
  excessiveDbAccess: boolean;
  noClaudeMdRestrictions: string[];
  mcpServerCount: number;
  unreviewedProjects: string[];
}

interface PermissionAuditReport {
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
// Helpers
// ---------------------------------------------------------------------------

function FlagBadge({ level, text }: { level: 'warning' | 'info' | 'success'; text: string }) {
  const colors = {
    warning: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    info: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    success: 'bg-green-500/10 text-green-500 border-green-500/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${colors[level]}`}>
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function Section({ title, icon, children, defaultOpen = true }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/30"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {icon}
        <span className="text-sm font-medium">{title}</span>
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PermissionsAuditTab() {
  const [report, setReport] = useState<PermissionAuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/api/security/permission-audit`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: PermissionAuditReport = await resp.json();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading && !report) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Scanning permissions...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
        {error}
      </div>
    );
  }

  if (!report) return null;

  const totalFlags =
    (report.flags.excessiveDbAccess ? 1 : 0) +
    report.flags.noClaudeMdRestrictions.length +
    report.flags.unreviewedProjects.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-green-500" />
          <h2 className="text-lg font-semibold">Permission Audit</h2>
          <span className="text-xs text-muted-foreground">
            {report.username}@{report.machine}
          </span>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Database className="h-3.5 w-3.5" />
            <span className="text-xs">Databases</span>
          </div>
          <p className="text-xl font-bold">{report.databaseAccess.length}</p>
          <p className="text-[10px] text-muted-foreground">
            {report.databaseAccess.filter((d) => d.hasCredentials).length} with credentials
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Server className="h-3.5 w-3.5" />
            <span className="text-xs">MCP Servers</span>
          </div>
          <p className="text-xl font-bold">{report.claudePermissions.mcpServers.length}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="text-xs">Projects</span>
          </div>
          <p className="text-xl font-bold">{report.projectSummaries.length}</p>
          <p className="text-[10px] text-muted-foreground">
            {report.projectSummaries.filter((p) => p.hasClaudeMd).length} with CLAUDE.md
          </p>
        </div>
        <div className={`rounded-lg border p-3 ${totalFlags > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-border'}`}>
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span className="text-xs">Flags</span>
          </div>
          <p className={`text-xl font-bold ${totalFlags > 0 ? 'text-amber-500' : ''}`}>{totalFlags}</p>
        </div>
      </div>

      {/* Quarterly review reminder */}
      <div className="rounded-lg border border-border p-3 flex items-center gap-3">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <div>
          <span className="text-xs font-medium">Next Quarterly Review:</span>{' '}
          <span className="text-xs text-muted-foreground">{report.nextQuarterlyReview}</span>
        </div>
      </div>

      {/* Flags / Warnings */}
      {totalFlags > 0 && (
        <Section title={`Permission Flags (${totalFlags})`} icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}>
          <div className="space-y-2">
            {report.flags.excessiveDbAccess && (
              <div className="flex items-start gap-2 p-2 rounded bg-amber-500/5 border border-amber-500/20">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <span className="font-medium text-amber-600">Excessive Database Access</span>
                  <p className="text-muted-foreground mt-0.5">
                    More than 3 databases have configured credentials. Consider limiting to only needed databases.
                  </p>
                </div>
              </div>
            )}
            {report.flags.noClaudeMdRestrictions.length > 0 && (
              <div className="flex items-start gap-2 p-2 rounded bg-amber-500/5 border border-amber-500/20">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <span className="font-medium text-amber-600">Projects Missing CLAUDE.md</span>
                  <p className="text-muted-foreground mt-0.5">
                    These projects have no CLAUDE.md file defining restrictions:
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {report.flags.noClaudeMdRestrictions.map((p) => (
                      <FlagBadge key={p} level="warning" text={p} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            {report.flags.unreviewedProjects.length > 0 && (
              <div className="flex items-start gap-2 p-2 rounded bg-blue-500/5 border border-blue-500/20">
                <AlertTriangle className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <span className="font-medium text-blue-600">Projects Without Project-Level Settings</span>
                  <p className="text-muted-foreground mt-0.5">
                    These projects have no .claude/settings.json (project-specific permissions not configured):
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {report.flags.unreviewedProjects.map((p) => (
                      <FlagBadge key={p} level="info" text={p} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Claude Code Permissions */}
      <Section title="AI Code Permissions" icon={<ShieldCheck className="h-4 w-4 text-blue-500" />}>
        <div className="text-xs text-muted-foreground mb-2">
          Source: <code className="bg-muted px-1 rounded">{report.claudePermissions.settingsPath}</code>
          {!report.claudePermissions.exists && (
            <FlagBadge level="warning" text="File not found" />
          )}
        </div>

        {report.claudePermissions.allowedTools.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1">Allowed Tools ({report.claudePermissions.allowedTools.length})</p>
            <div className="flex flex-wrap gap-1">
              {report.claudePermissions.allowedTools.map((t, i) => (
                <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-green-500/10 text-green-600 border border-green-500/20">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {report.claudePermissions.deniedTools.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1">Denied Tools ({report.claudePermissions.deniedTools.length})</p>
            <div className="flex flex-wrap gap-1">
              {report.claudePermissions.deniedTools.map((t, i) => (
                <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-red-500/10 text-red-500 border border-red-500/20">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {report.claudePermissions.allowedTools.length === 0 && report.claudePermissions.deniedTools.length === 0 && report.claudePermissions.exists && (
          <p className="text-xs text-muted-foreground">No explicit tool allow/deny rules configured.</p>
        )}
      </Section>

      {/* MCP Servers */}
      <Section title={`MCP Servers (${report.claudePermissions.mcpServers.length})`} icon={<Server className="h-4 w-4 text-purple-500" />} defaultOpen={report.claudePermissions.mcpServers.length > 0}>
        {report.claudePermissions.mcpServers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No MCP servers configured.</p>
        ) : (
          <div className="space-y-2">
            {report.claudePermissions.mcpServers.map((srv) => (
              <div key={srv.name} className="rounded border border-border p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium">{srv.name}</span>
                  <FlagBadge level="info" text={srv.command || 'unknown'} />
                </div>
                {srv.args.length > 0 && (
                  <p className="text-[10px] text-muted-foreground font-mono truncate" title={srv.args.join(' ')}>
                    args: {srv.args.join(' ')}
                  </p>
                )}
                {Object.keys(srv.env).length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    env vars: {Object.keys(srv.env).join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Database Access */}
      <Section title={`Database Access (${report.databaseAccess.length})`} icon={<Database className="h-4 w-4 text-emerald-500" />}>
        {report.databaseAccess.length === 0 ? (
          <p className="text-xs text-muted-foreground">No database access configured.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Database</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Account Type</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">User</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.databaseAccess.map((db) => (
                  <tr key={db.database} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{db.database}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <FlagBadge level={db.accountType === 'primary' ? 'info' : 'success'} text={db.accountType} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground font-mono">{db.user}</td>
                    <td className="px-3 py-2">
                      {db.hasCredentials
                        ? <FlagBadge level="success" text="Configured" />
                        : <FlagBadge level="warning" text="Missing" />
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Project Summaries */}
      <Section title={`Projects (${report.projectSummaries.length})`} icon={<FolderOpen className="h-4 w-4 text-orange-500" />}>
        {report.projectSummaries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No projects configured.</p>
        ) : (
          <div className="space-y-2">
            {report.projectSummaries.map((proj) => (
              <div key={proj.projectPath} className="rounded border border-border p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium">{proj.projectName}</span>
                  {proj.hasClaudeMd
                    ? <FlagBadge level="success" text="CLAUDE.md" />
                    : <FlagBadge level="warning" text="No CLAUDE.md" />
                  }
                  {proj.hasProjectSettings && <FlagBadge level="success" text="Project Settings" />}
                </div>
                <p className="text-[10px] text-muted-foreground font-mono truncate" title={proj.projectPath}>
                  {proj.projectPath}
                </p>
                {proj.claudeMdSnippet && (
                  <pre className="mt-2 text-[10px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap text-muted-foreground max-h-24 overflow-y-auto">
                    {proj.claudeMdSnippet}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* CLAUDE.md Files */}
      <Section title={`CLAUDE.md Files (${report.claudeMdFiles.filter((f) => f.exists).length})`} icon={<ShieldCheck className="h-4 w-4 text-teal-500" />} defaultOpen={false}>
        {report.claudeMdFiles.length === 0 ? (
          <p className="text-xs text-muted-foreground">No CLAUDE.md files found.</p>
        ) : (
          <div className="space-y-2">
            {report.claudeMdFiles.map((f) => (
              <div key={f.filePath} className="rounded border border-border p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono truncate" title={f.filePath}>{f.filePath}</span>
                  {f.exists
                    ? <FlagBadge level="success" text={`${(f.sizeBytes / 1024).toFixed(1)} KB`} />
                    : <FlagBadge level="warning" text="Not Found" />
                  }
                </div>
                {f.exists && f.snippet && (
                  <pre className="mt-1 text-[10px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap text-muted-foreground max-h-24 overflow-y-auto">
                    {f.snippet}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
