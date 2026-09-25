import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '@/lib/api-config';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FEATURE_ROLES, getGrantableFeatures, FEATURE_LABELS } from '@/auth/feature-roles';
import type { HiveRole } from '@/auth/types';

// ── Types ─────────────────────────────────────────────────────────────

interface CentralUser {
  oid: string;
  email: string;
  displayName: string;
  role: HiveRole;
  adminRoleOverride: HiveRole | null;
  firstLogin: string;
  lastLogin: string;
  loginCount: number;
  lastVersion: string | null;
  lastVersionAt: string | null;
  lastHeartbeatAt: string | null;
  lastCommit: string | null;
  forceUpdatePending: boolean;
  forceUpdateRequestedAt: string | null;
  forceUpdateRequestedBy: string | null;
  isOnline?: boolean;
}

interface LoginEntry {
  loginAt: string;
  machineName: string;
  version: string | null;
}

interface ActivitySummary {
  feature: string;
  visitCount: number;
  lastVisit: string;
}

interface FeatureOverride {
  feature: string;
  grantedBy: string;
  grantedAt: string;
}

interface UserEventRow {
  occurredAt: string;
  category: string;
  name: string;
  route: string | null;
  props: Record<string, unknown> | null;
  version: string | null;
  machineName: string | null;
}

interface UserEventSummary {
  name: string;
  category: string;
  count: number;
  lastAt: string;
}

interface UserDetail extends CentralUser {
  logins: LoginEntry[];
  activity: ActivitySummary[];
  overrides: FeatureOverride[];
  events: UserEventSummary[];
  recentEvents: UserEventRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  full: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  full: 'Full',
};

function formatDate(iso: string): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function timeAgo(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// A user is stale when their reported commit differs from the latest main commit.
// We compare commits (not the semver, which each machine bumps independently on
// every build). Guard against 'unknown'/'error' placeholders so we never flag a
// user stale when we simply couldn't determine the latest commit.
function isValidCommit(c: string | null | undefined): boolean {
  return !!c && c.length >= 7 && c !== 'unknown' && c !== 'error';
}

function isStale(lastCommit: string | null, latestCommit: string): boolean {
  if (!isValidCommit(latestCommit) || !isValidCommit(lastCommit)) return false;
  return lastCommit !== latestCommit;
}

// ── Main Component ────────────────────────────────────────────────────

export default function UserManagementPage() {
  const [users, setUsers] = useState<CentralUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [expandedOid, setExpandedOid] = useState<string | null>(null);
  const [serverVersion, setServerVersion] = useState<string>('');
  const [latestCommit, setLatestCommit] = useState<string>('');

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, { credentials: 'include' });
      const data = await res.json() as { users: CentralUser[]; warning?: string; latestCommit?: string };
      setUsers(data.users || []);
      setLatestCommit(data.latestCommit || '');
      setWarning(data.warning || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    // Poll for online/version changes every 30s so the admin view stays fresh
    // without manual refresh. The heartbeat is per-minute, so 30s is a
    // reasonable lower bound.
    const interval = window.setInterval(fetchUsers, 30_000);
    return () => window.clearInterval(interval);
  }, [fetchUsers]);

  useEffect(() => {
    fetch(`${API_BASE}/api/version`).then(r => r.json()).then((d: { version: string }) => {
      setServerVersion(d.version || '');
    }).catch(() => {});
  }, []);

  const filtered = users.filter(u => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    }
    return true;
  });

  const roleCounts = { admin: 0, full: 0 };
  for (const u of users) {
    if (u.role in roleCounts) roleCounts[u.role as keyof typeof roleCounts]++;
  }

  if (loading) {
    return <div className="text-muted-foreground text-sm p-4">Loading users...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">User Management</h1>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {serverVersion && <span>Server v{serverVersion}</span>}
          <span>{users.length} users</span>
          <span className="text-emerald-400">{users.filter(u => u.isOnline).length} online</span>
          {(() => {
            const staleCount = users.filter(u => isStale(u.lastCommit, latestCommit)).length;
            return staleCount > 0 ? <span className="text-amber-400">{staleCount} outdated</span> : null;
          })()}
          <Badge variant="outline" className={ROLE_COLORS.admin}>{roleCounts.admin} admin</Badge>
          <Badge variant="outline" className={ROLE_COLORS.full}>{roleCounts.full} full</Badge>
        </div>
      </div>

      {warning && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
          {warning}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-8 text-sm bg-muted border border-border rounded px-2 text-foreground"
        >
          <option value="all">All roles</option>
          <option value="admin">Admin</option>
          <option value="full">Full</option>
        </select>
      </div>

      {/* User list */}
      <div className="space-y-1">
        {filtered.length === 0 && !loading && (
          <div className="text-muted-foreground text-sm p-4 text-center">
            {users.length === 0 ? 'No users have logged in yet.' : 'No users match your filter.'}
          </div>
        )}
        {filtered.map(user => (
          <div key={user.oid}>
            <UserCard
              user={user}
              latestCommit={latestCommit}
              expanded={expandedOid === user.oid}
              onToggle={() => setExpandedOid(expandedOid === user.oid ? null : user.oid)}
            />
            {expandedOid === user.oid && (
              <UserDetailPanel
                oid={user.oid}
                onRoleChanged={fetchUsers}
                onUserDeleted={() => { setExpandedOid(null); fetchUsers(); }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── User Card ─────────────────────────────────────────────────────────

function UserCard({ user, latestCommit, expanded, onToggle }: {
  user: CentralUser;
  latestCommit: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const stale = isStale(user.lastCommit, latestCommit);
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors ${
        expanded ? 'bg-accent' : 'hover:bg-muted/50'
      }`}
    >
      {/* Avatar + online dot */}
      <div className="relative shrink-0">
        <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium">
          {initials(user.displayName)}
        </div>
        {user.isOnline && (
          <span
            title="Online"
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 border-2 border-background"
          />
        )}
      </div>

      {/* Name + Email */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{user.displayName}</div>
        <div className="text-xs text-muted-foreground truncate">{user.email}</div>
      </div>

      {/* Version badge */}
      <Badge
        variant="outline"
        className={`text-[10px] font-mono ${stale ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'text-muted-foreground'}`}
        title={user.lastVersionAt ? `Last reported ${timeAgo(user.lastVersionAt)}` : 'No version yet'}
      >
        {user.lastVersion ? `v${user.lastVersion}` : 'unknown'}
        {stale && ' · stale'}
      </Badge>

      {/* Role badge */}
      <Badge variant="outline" className={`text-[10px] ${ROLE_COLORS[user.role] || ''}`}>
        {ROLE_LABELS[user.role] || user.role}
        {user.adminRoleOverride && ' (admin set)'}
      </Badge>

      {/* Login info */}
      <div className="text-right shrink-0">
        <div className="text-xs text-muted-foreground">{timeAgo(user.lastLogin)}</div>
        <div className="text-[10px] text-muted-foreground">{user.loginCount} logins</div>
      </div>

      {/* Expand arrow */}
      <div className="text-muted-foreground text-xs shrink-0">{expanded ? '▼' : '▶'}</div>
    </button>
  );
}

// ── User Detail Panel ─────────────────────────────────────────────────

function UserDetailPanel({ oid, onRoleChanged, onUserDeleted }: { oid: string; onRoleChanged: () => void; onUserDeleted: () => void }) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [latestCommit, setLatestCommit] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(oid)}`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json() as { user: UserDetail; latestCommit?: string };
      setDetail(data.user);
      setLatestCommit(data.latestCommit || '');
    }
  }, [oid]);

  useEffect(() => {
    (async () => {
      try {
        await refresh();
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  if (loading) return <div className="text-muted-foreground text-xs p-4 pl-14">Loading details...</div>;
  if (!detail) return <div className="text-red-400 text-xs p-4 pl-14">Failed to load user details</div>;

  return (
    <div className="ml-11 mr-3 mb-3 border border-border rounded-md bg-card">
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="w-full justify-start border-b border-border rounded-none bg-transparent px-3 h-9">
          <TabsTrigger value="profile" className="text-xs" data-track="admin.users.tab.profile" data-track-category="nav">Profile</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs" data-track="admin.users.tab.activity" data-track-category="nav">Activity</TabsTrigger>
          <TabsTrigger value="events" className="text-xs" data-track="admin.users.tab.events" data-track-category="nav">Events</TabsTrigger>
          <TabsTrigger value="features" className="text-xs" data-track="admin.users.tab.features" data-track-category="nav">Feature Access</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="p-4 space-y-3">
          <ProfileTab detail={detail} latestCommit={latestCommit} onRoleChanged={onRoleChanged} onDetailChanged={setDetail} onUserDeleted={onUserDeleted} />
        </TabsContent>

        <TabsContent value="activity" className="p-4 space-y-3">
          <ActivityTab detail={detail} />
        </TabsContent>

        <TabsContent value="events" className="p-4 space-y-3">
          <EventsTab detail={detail} />
        </TabsContent>

        <TabsContent value="features" className="p-4 space-y-3">
          <FeatureAccessTab detail={detail} onOverrideChanged={refresh} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────

function ProfileTab({ detail, latestCommit, onRoleChanged, onDetailChanged, onUserDeleted }: {
  detail: UserDetail;
  latestCommit: string;
  onRoleChanged: () => void;
  onDetailChanged: (d: UserDetail) => void;
  onUserDeleted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [forceStatus, setForceStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const stale = isStale(detail.lastCommit, latestCommit);

  async function handleRoleChange(role: HiveRole) {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(detail.oid)}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role }),
      });
      onDetailChanged({ ...detail, role, adminRoleOverride: role });
      onRoleChanged();
    } finally {
      setSaving(false);
    }
  }

  async function handleClearOverride() {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(detail.oid)}/role-override`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ adRole: 'full' }),
      });
      onDetailChanged({ ...detail, adminRoleOverride: null, role: 'full' });
      onRoleChanged();
    } finally {
      setSaving(false);
    }
  }

  async function handleForceUpdate() {
    const when = detail.isOnline
      ? 'They will update and reload within a minute.'
      : 'The update is queued and will run automatically the next time they open SI Hive.';
    if (!confirm(`Queue an update for ${detail.displayName}? ${when}`)) return;
    setForcing(true);
    setForceStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(detail.oid)}/force-update`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setForceStatus(detail.isOnline
          ? 'Update queued — the user will update within a minute.'
          : 'Update queued — it will run when the user next opens SI Hive.');
        onDetailChanged({ ...detail, forceUpdatePending: true });
        onRoleChanged();
      } else {
        setForceStatus(data.error || 'Force update failed');
      }
    } catch (err) {
      setForceStatus(err instanceof Error ? err.message : 'Network error');
    } finally {
      setForcing(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Permanently delete ${detail.displayName} (${detail.email})?\n\nThis removes their directory record, login history, activity, events, and feature overrides. It does not uninstall SI Hive from their machine — if they log in again they will be re-added.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(detail.oid)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        onUserDeleted();
      } else {
        alert(data.error || 'Delete failed');
        setDeleting(false);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Network error');
      setDeleting(false);
    }
  }

  // Collect unique machine names from login history
  const machines = [...new Set(detail.logins.map(l => l.machineName).filter(Boolean))];

  return (
    <>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div>
          <span className="text-muted-foreground">Name</span>
          <div className="flex items-center gap-2">
            <span>{detail.displayName}</span>
            {detail.isOnline && (
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                Online
              </Badge>
            )}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Email</span>
          <div>{detail.email}</div>
        </div>
        <div>
          <span className="text-muted-foreground">First login</span>
          <div>{formatDate(detail.firstLogin)}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Last login</span>
          <div>{formatDate(detail.lastLogin)} ({timeAgo(detail.lastLogin)})</div>
        </div>
        <div>
          <span className="text-muted-foreground">Total logins</span>
          <div>{detail.loginCount}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Machines</span>
          <div>{machines.length > 0 ? machines.join(', ') : '—'}</div>
        </div>
        <div>
          <span className="text-muted-foreground">SI Hive version</span>
          <div className="flex items-center gap-2">
            <span className="font-mono">{detail.lastVersion ? `v${detail.lastVersion}` : 'unknown'}</span>
            {detail.lastCommit && (
              <span className="text-[10px] font-mono text-muted-foreground" title="Reported commit">
                {detail.lastCommit.slice(0, 8)}
              </span>
            )}
            {stale && (
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                Outdated
              </Badge>
            )}
            {detail.lastVersionAt && (
              <span className="text-[10px] text-muted-foreground">reported {timeAgo(detail.lastVersionAt)}</span>
            )}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Last heartbeat</span>
          <div>{detail.lastHeartbeatAt ? `${timeAgo(detail.lastHeartbeatAt)}` : '—'}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Azure AD OID</span>
          <div className="text-xs font-mono text-muted-foreground">{detail.oid}</div>
        </div>
      </div>

      {/* Role management */}
      <div className="border-t border-border pt-3 mt-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">Role:</span>
          <select
            value={detail.role}
            onChange={(e) => handleRoleChange(e.target.value as HiveRole)}
            disabled={saving}
            data-track="admin.users.change_role"
            data-track-category="action"
            className="h-7 text-sm bg-muted border border-border rounded px-2 text-foreground"
          >
            <option value="admin">Admin</option>
            <option value="full">Full</option>
          </select>
          {detail.adminRoleOverride && (
            <>
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">
                Admin override
              </Badge>
              <button
                onClick={handleClearOverride}
                disabled={saving}
                data-track="admin.users.clear_role_override"
                data-track-category="action"
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Reset to AD role
              </button>
            </>
          )}

          {detail.forceUpdatePending && (
            <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/30" title={detail.forceUpdateRequestedAt ? `Requested ${timeAgo(detail.forceUpdateRequestedAt)}` : undefined}>
              Update pending
            </Badge>
          )}

          {/* Delete user */}
          <button
            onClick={handleDelete}
            disabled={deleting}
            data-track="admin.users.delete"
            data-track-category="action"
            data-track-props={JSON.stringify({ targetOid: detail.oid })}
            title="Permanently delete this user and their records"
            className="ml-auto h-7 text-xs px-2.5 rounded border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>

          {/* Force Update — queued via DB flag, so it works even if offline. */}
          <button
            onClick={handleForceUpdate}
            disabled={forcing}
            data-track="admin.users.force_update"
            data-track-category="action"
            data-track-props={JSON.stringify({ targetOid: detail.oid, stale, online: detail.isOnline })}
            title={detail.isOnline ? 'Update this user now' : 'Queue an update — runs when the user next opens SI Hive'}
            className="h-7 text-xs px-2.5 rounded border border-border bg-muted hover:bg-accent disabled:opacity-50"
          >
            {forcing ? 'Sending…' : detail.isOnline ? 'Force Update' : 'Queue Update'}
          </button>
        </div>
        {detail.adminRoleOverride && (
          <p className="text-[11px] text-muted-foreground mt-1">
            This role was set by an admin and will persist across logins, overriding Azure AD group membership.
          </p>
        )}
        {forceStatus && (
          <p className="text-[11px] text-muted-foreground mt-2">{forceStatus}</p>
        )}
      </div>
    </>
  );
}

// ── Activity Tab ──────────────────────────────────────────────────────

function ActivityTab({ detail }: { detail: UserDetail }) {
  return (
    <>
      {/* Login history */}
      <div>
        <h3 className="text-sm font-medium mb-2">Recent Logins</h3>
        {detail.logins.length === 0 ? (
          <div className="text-xs text-muted-foreground">No login history available.</div>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {detail.logins.slice(0, 20).map((login, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span>{formatDateTime(login.loginAt)}</span>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>{login.machineName || '—'}</span>
                  <span className="font-mono w-20 text-right">{login.version ? `v${login.version}` : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Feature usage */}
      <div>
        <h3 className="text-sm font-medium mb-2 mt-4">Feature Usage (90 days)</h3>
        {detail.activity.length === 0 ? (
          <div className="text-xs text-muted-foreground">No feature usage tracked yet.</div>
        ) : (
          <div className="space-y-1">
            {detail.activity.map(a => (
              <div key={a.feature} className="flex items-center justify-between text-xs">
                <span>{FEATURE_LABELS[a.feature] || a.feature}</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">{a.visitCount} visits</span>
                  <span className="text-muted-foreground w-20 text-right">{timeAgo(a.lastVisit)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Events Tab ────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  nav: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  click: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
  action: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  modal: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  feature: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  error: 'bg-red-500/10 text-red-300 border-red-500/30',
};

function EventsTab({ detail }: { detail: UserDetail }) {
  const events = detail.recentEvents || [];
  const summary = detail.events || [];

  return (
    <>
      {/* Top events (7 days) */}
      <div>
        <h3 className="text-sm font-medium mb-2">Top Buttons / Actions (7 days)</h3>
        {summary.length === 0 ? (
          <div className="text-xs text-muted-foreground">No events tracked yet.</div>
        ) : (
          <div className="space-y-1">
            {summary.slice(0, 10).map(s => (
              <div key={`${s.name}:${s.category}`} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`text-[9px] ${CATEGORY_COLORS[s.category] || ''}`}>{s.category}</Badge>
                  <span className="font-mono">{s.name}</span>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>{s.count}×</span>
                  <span className="w-20 text-right">{timeAgo(s.lastAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent events stream */}
      <div className="mt-4">
        <h3 className="text-sm font-medium mb-2">Recent Activity Stream</h3>
        {events.length === 0 ? (
          <div className="text-xs text-muted-foreground">No recent events.</div>
        ) : (
          <div className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
            {events.slice(0, 200).map((ev, i) => (
              <div key={i} className="grid grid-cols-[100px_60px_1fr_120px] gap-2 items-center text-[11px] py-0.5">
                <span className="text-muted-foreground truncate" title={ev.occurredAt}>{formatDateTime(ev.occurredAt)}</span>
                <Badge variant="outline" className={`text-[9px] justify-self-start ${CATEGORY_COLORS[ev.category] || ''}`}>{ev.category}</Badge>
                <span className="font-mono truncate" title={ev.name}>{ev.name}</span>
                <span className="text-muted-foreground truncate text-right" title={ev.route ?? ''}>{ev.route ?? ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Feature Access Tab ────────────────────────────────────────────────

function FeatureAccessTab({ detail, onOverrideChanged }: {
  detail: UserDetail;
  onOverrideChanged: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);

  const overriddenFeatures = new Set(detail.overrides.map(o => o.feature));
  const grantable = getGrantableFeatures(detail.role);

  // Features the role already grants
  const roleFeatures = Object.entries(FEATURE_ROLES)
    .filter(([, roles]) => roles.includes(detail.role))
    .map(([feature]) => feature);

  async function toggleOverride(feature: string, grant: boolean) {
    setSaving(feature);
    try {
      if (grant) {
        await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(detail.oid)}/overrides`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ feature }),
        });
      } else {
        await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(detail.oid)}/overrides/${feature}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      }
      onOverrideChanged();
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      {/* Role-granted features */}
      <div>
        <h3 className="text-sm font-medium mb-2">
          Included in {ROLE_LABELS[detail.role] || detail.role} role
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {roleFeatures.map(f => (
            <Badge key={f} variant="outline" className="text-[10px] text-muted-foreground">
              {FEATURE_LABELS[f] || f}
            </Badge>
          ))}
        </div>
      </div>

      {/* Grantable features */}
      {grantable.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium mb-2">Additional Feature Grants</h3>
          <p className="text-[11px] text-muted-foreground mb-3">
            Toggle features to grant access beyond what the {ROLE_LABELS[detail.role] || detail.role} role provides.
          </p>
          <div className="space-y-2">
            {grantable.map(feature => {
              const isGranted = overriddenFeatures.has(feature);
              return (
                <div key={feature} className="flex items-center justify-between">
                  <span className="text-sm">{FEATURE_LABELS[feature] || feature}</span>
                  <div className="flex items-center gap-2">
                    {isGranted && (
                      <span className="text-[10px] text-emerald-400">Granted</span>
                    )}
                    <Switch
                      checked={isGranted}
                      disabled={saving === feature}
                      data-track={`admin.users.toggle_override.${feature}`}
                      data-track-category="action"
                      onCheckedChange={(checked) => toggleOverride(feature, checked)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Active overrides summary */}
      {detail.overrides.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-xs font-medium text-muted-foreground mb-2">Active Overrides</h3>
          <div className="space-y-1">
            {detail.overrides.map(o => (
              <div key={o.feature} className="flex items-center justify-between text-xs">
                <span>{FEATURE_LABELS[o.feature] || o.feature}</span>
                <span className="text-muted-foreground">Granted {formatDate(o.grantedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
