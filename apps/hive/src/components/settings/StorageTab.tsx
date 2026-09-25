import { useEffect, useState } from 'react';
import { Database, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { API_BASE } from '@/lib/api-config';

type StorageType = 'sqlite' | 'postgres' | 'mssql';

interface SharedStorageConfig {
  type: StorageType;
  file?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  ssl?: boolean;
  trustServerCertificate?: boolean;
}

interface StorageStatus {
  shared: SharedStorageConfig;
  password: string;
  migrations: { applied: string[]; error?: string; at?: string; dialect?: string };
}

const TYPE_LABELS: Record<StorageType, string> = {
  sqlite: 'SQLite (this machine)',
  postgres: 'PostgreSQL',
  mssql: 'SQL Server',
};

const DEFAULT_PORTS: Record<StorageType, number | undefined> = { sqlite: undefined, postgres: 5432, mssql: 1433 };

const selectClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/**
 * Settings → Storage. Picks where the *shared* database lives: local SQLite
 * (default, single user) or a Postgres / SQL Server that several Hive
 * instances point at for team features.
 */
export default function StorageTab() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [form, setForm] = useState<SharedStorageConfig>({ type: 'sqlite' });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function load() {
    const res = await fetch(`${API_BASE}/api/storage`);
    if (!res.ok) return;
    const data = (await res.json()) as StorageStatus;
    setStatus(data);
    setForm(data.shared);
  }

  useEffect(() => { void load(); }, []);

  const set = (patch: Partial<SharedStorageConfig>) => setForm((f) => ({ ...f, ...patch }));
  const remote = form.type !== 'sqlite';

  async function submit(kind: 'test' | 'save') {
    setBusy(kind);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/storage${kind === 'test' ? '/test' : ''}`, {
        method: kind === 'test' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared: form, password: password || undefined }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; migrations?: { applied: string[]; error?: string } };
      if (kind === 'test') {
        setResult(data.ok ? { ok: true, message: 'Connection succeeded.' } : { ok: false, message: data.error ?? 'Connection failed.' });
      } else if (res.ok) {
        setResult({ ok: true, message: `Saved. ${data.migrations?.applied.length ?? 0} migration(s) applied.` });
        setPassword('');
        await load();
      } else {
        setResult({ ok: false, message: data.error ?? data.migrations?.error ?? 'Save failed.' });
      }
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Storage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Where SI Hive keeps shared data — knowledge base, personas, todos, workflows, and team features.
          Local session data always stays in SQLite on this machine.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Shared database
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">Database type</span>
            <select
              className={selectClass}
              value={form.type}
              onChange={(e) => {
                const type = e.target.value as StorageType;
                set({ type, port: DEFAULT_PORTS[type] });
              }}
            >
              {(Object.keys(TYPE_LABELS) as StorageType[]).map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {remote
                ? 'Point several SI Hive installs at the same database to share data between people.'
                : 'Single-user default. Nothing to configure.'}
            </p>
          </label>

          {!remote && (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">Database file (optional)</span>
              <Input value={form.file ?? ''} placeholder="Default: shared.db in the SI Hive data folder" onChange={(e) => set({ file: e.target.value })} />
            </label>
          )}

          {remote && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <label className="col-span-2 block space-y-1">
                  <span className="text-sm font-medium text-foreground">Host</span>
                  <Input value={form.host ?? ''} placeholder="db.example.com" onChange={(e) => set({ host: e.target.value })} />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-foreground">Port</span>
                  <Input type="number" value={form.port ?? ''} onChange={(e) => set({ port: Number(e.target.value) || undefined })} />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-foreground">Database</span>
                <Input value={form.database ?? ''} placeholder="hive" onChange={(e) => set({ database: e.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-foreground">User</span>
                  <Input value={form.user ?? ''} autoComplete="off" onChange={(e) => set({ user: e.target.value })} />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-foreground">Password</span>
                  <Input
                    type="password"
                    value={password}
                    autoComplete="new-password"
                    placeholder={status?.password ? `Saved (${status.password})` : ''}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-foreground">Encrypt connection (TLS)</span>
                </div>
                <Switch checked={!!form.ssl} onCheckedChange={(v) => set({ ssl: v })} />
              </div>
              {form.type === 'mssql' && (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-foreground">Trust server certificate</span>
                    <p className="text-xs text-muted-foreground">Only for self-signed certificates you control.</p>
                  </div>
                  <Switch checked={!!form.trustServerCertificate} onCheckedChange={(v) => set({ trustServerCertificate: v })} />
                </div>
              )}
            </>
          )}

          <div className="flex items-center gap-2 pt-2">
            {remote && (
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void submit('test')} data-track="settings.storage.test">
                {busy === 'test' && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Test connection
              </Button>
            )}
            <Button size="sm" disabled={busy !== null} onClick={() => void submit('save')} data-track="settings.storage.save">
              {busy === 'save' && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save & migrate
            </Button>
          </div>

          {result && (
            <p className={`flex items-center gap-1.5 text-sm ${result.ok ? 'text-green-500' : 'text-destructive'}`}>
              {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {result.message}
            </p>
          )}
          {remote && (
            <p className="text-xs text-muted-foreground">
              Switching databases does not copy existing data; the new database starts empty.
            </p>
          )}
        </CardContent>
      </Card>

      {status && (
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="text-muted-foreground">
              Connected to <span className="text-foreground">{TYPE_LABELS[status.shared.type]}</span>
              {status.migrations.at ? ` · checked ${new Date(status.migrations.at).toLocaleString()}` : ''}
            </p>
            {status.migrations.error
              ? <p className="text-destructive">Migration error: {status.migrations.error}</p>
              : <p className="text-muted-foreground">Schema up to date.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
