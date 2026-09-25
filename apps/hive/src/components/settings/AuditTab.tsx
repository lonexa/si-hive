import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, AlertTriangle, Download, Shield, Clock, User, Filter } from 'lucide-react';
import AISessionButton from '@/components/shared/AISessionButton';
import { resolveDefaultProjectDir } from '@/lib/project-mappings';

import { API_BASE } from '@/lib/api-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditLogEntry {
  Id: number;
  Action: string;
  EntityType: string | null;
  EntityId: string | null;
  Details: string | null;
  Username: string;
  MachineName: string | null;
  Timestamp: string;
}

interface AuditLogResult {
  entries: AuditLogEntry[];
  warning: string | null;
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

function exportCsv(entries: AuditLogEntry[]): void {
  const headers = ['Id', 'Action', 'EntityType', 'EntityId', 'Details', 'Username', 'MachineName', 'Timestamp'];
  const rows = entries.map((e) =>
    headers.map((h) => {
      const val = e[h as keyof AuditLogEntry];
      const str = val == null ? '' : String(val);
      // Escape for CSV
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AuditTab() {
  const [data, setData] = useState<AuditLogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [search, setSearch] = useState('');
  const [defaultCwd, setDefaultCwd] = useState('');

  useEffect(() => {
    resolveDefaultProjectDir().then(setDefaultCwd);
  }, []);

  // Filter options loaded from API
  const [actionOptions, setActionOptions] = useState<string[]>([]);
  const [userOptions, setUserOptions] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (actionFilter) params.set('action', actionFilter);
      if (userFilter) params.set('user', userFilter);
      const resp = await fetch(`${API_BASE}/api/security/audit-log?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result: AuditLogResult = await resp.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [days, actionFilter, userFilter]);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const [actionsResp, usersResp] = await Promise.all([
        fetch(`${API_BASE}/api/security/audit-log/actions`),
        fetch(`${API_BASE}/api/security/audit-log/users`),
      ]);
      if (actionsResp.ok) {
        const d = await actionsResp.json();
        setActionOptions(d.actions ?? []);
      }
      if (usersResp.ok) {
        const d = await usersResp.json();
        setUserOptions(d.users ?? []);
      }
    } catch {
      // Filter options are optional — don't block the page
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchFilterOptions();
  }, [fetchData, fetchFilterOptions]);

  // Client-side text search across all fields
  const filteredEntries = useMemo(() => {
    if (!data?.entries) return [];
    if (!search) return data.entries;
    const q = search.toLowerCase();
    return data.entries.filter((e) =>
      (e.Action?.toLowerCase().includes(q)) ||
      (e.EntityType?.toLowerCase().includes(q)) ||
      (e.EntityId?.toLowerCase().includes(q)) ||
      (e.Details?.toLowerCase().includes(q)) ||
      (e.Username?.toLowerCase().includes(q)) ||
      (e.MachineName?.toLowerCase().includes(q))
    );
  }, [data, search]);

  // Summary counts
  const summaryByAction = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of (data?.entries ?? [])) {
      counts[e.Action] = (counts[e.Action] || 0) + 1;
    }
    return counts;
  }, [data]);

  const uniqueUsers = useMemo(() => {
    const users = new Set<string>();
    for (const e of (data?.entries ?? [])) users.add(e.Username);
    return users.size;
  }, [data]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-blue-500" />
          <h2 className="text-lg font-semibold">Audit Trail</h2>
          {data && !data.warning && (
            <span className="text-xs text-muted-foreground">
              {data.totalCount} event{data.totalCount !== 1 ? 's' : ''} in last {days} days
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => filteredEntries.length > 0 && exportCsv(filteredEntries)}
            disabled={!filteredEntries.length}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent disabled:opacity-40"
          >
            <Download className="h-3 w-3" /> Export CSV
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Warning (table not yet created) */}
      {data?.warning && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-600">Table Not Available</p>
            <p className="text-xs text-muted-foreground mt-1">{data.warning}</p>
            <pre className="mt-3 text-xs bg-muted/50 rounded p-3 overflow-x-auto whitespace-pre text-muted-foreground">
{`CREATE TABLE [Hive].[audit_log] (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Action NVARCHAR(100) NOT NULL,
    EntityType NVARCHAR(100),
    EntityId NVARCHAR(200),
    Details NVARCHAR(MAX),
    Username NVARCHAR(100) NOT NULL,
    MachineName NVARCHAR(100),
    Timestamp DATETIME2 DEFAULT GETDATE()
);`}
            </pre>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
          {error}
        </div>
      )}

      {/* Filters */}
      {!data?.warning && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="text-xs rounded-md border border-border bg-background px-2 py-1.5"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="text-xs rounded-md border border-border bg-background px-2 py-1.5"
          >
            <option value="">All Actions</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="text-xs rounded-md border border-border bg-background px-2 py-1.5"
          >
            <option value="">All Users</option>
            {userOptions.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Search entries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-xs rounded-md border border-border bg-background px-2 py-1.5 w-48"
          />
        </div>
      )}

      {/* Summary cards */}
      {!data?.warning && data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Shield className="h-3.5 w-3.5" />
              <span className="text-xs">Total Events</span>
            </div>
            <p className="text-xl font-bold">{data.totalCount}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <User className="h-3.5 w-3.5" />
              <span className="text-xs">Unique Users</span>
            </div>
            <p className="text-xl font-bold">{uniqueUsers}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-3.5 w-3.5" />
              <span className="text-xs">Action Types</span>
            </div>
            <p className="text-xl font-bold">{Object.keys(summaryByAction).length}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Filter className="h-3.5 w-3.5" />
              <span className="text-xs">Filtered</span>
            </div>
            <p className="text-xl font-bold">{filteredEntries.length}</p>
          </div>
        </div>
      )}

      {/* Table */}
      {!data?.warning && filteredEntries.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Timestamp</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">User</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Action</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Entity Type</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Entity ID</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Machine</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Details</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredEntries.map((entry) => (
                  <tr key={entry.Id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {formatTimestamp(entry.Timestamp)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{entry.Username}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-500">
                        {entry.Action}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{entry.EntityType ?? '-'}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground" title={entry.EntityId ?? ''}>
                      {entry.EntityId ?? '-'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{entry.MachineName ?? '-'}</td>
                    <td className="px-3 py-2 max-w-[300px] truncate text-muted-foreground" title={entry.Details ?? ''}>
                      {entry.Details ?? '-'}
                    </td>
                    <td className="px-3 py-2">
                      <AISessionButton
                        cwd={defaultCwd}
                        prompt={`Investigate this audit event:\n\nAction: ${entry.Action}\nUser: ${entry.Username}\nEntity: ${entry.EntityType ?? 'N/A'} / ${entry.EntityId ?? 'N/A'}\nTimestamp: ${entry.Timestamp}\nDetails: ${entry.Details ?? 'None'}\n\nDetermine if this is expected behavior or requires attention.`}
                        variant="icon-only"
                        size="icon"
                        tooltip="Investigate"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!data?.warning && !loading && data && filteredEntries.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
          <Shield className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-sm">No audit log entries found for the selected filters.</p>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Loading audit log...</span>
        </div>
      )}
    </div>
  );
}
