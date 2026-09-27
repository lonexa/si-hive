import { useEffect, useState } from 'react';
import { GitBranch, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_BASE } from '@/lib/api-config';

interface Source { connectionId?: string; repo?: string; branch?: string }
interface Connection { id: string; label: string; providerName: string; kinds: string[] }

/** Matches PUBLIC_GITHUB in server/updater.ts: a public GitHub repo, no sign-in. */
const PUBLIC_GITHUB = 'github-public';

/**
 * Where "Refresh from Repo" pulls new versions from: a public GitHub
 * repository, or a repository on one of the connected git hosts (your fork,
 * or the upstream project).
 */
export default function UpdateSourceCard({ onSaved }: { onSaved?: () => void }) {
  const [source, setSource] = useState<Source>({});
  const [connections, setConnections] = useState<Connection[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const [s, c] = await Promise.all([
        fetch(`${API_BASE}/api/updates/source`).then((r) => r.json() as Promise<Source>),
        fetch(`${API_BASE}/api/integrations`).then((r) => r.json() as Promise<Connection[]>),
      ]);
      const git = c.filter((x) => x.kinds.includes('git'));
      setConnections(git);
      setSource({ ...s, connectionId: s.connectionId ?? (s.repo ? git[0]?.id : undefined) ?? PUBLIC_GITHUB });
    })().catch(() => {});
  }, []);

  async function save() {
    setError('');
    const res = await fetch(`${API_BASE}/api/updates/source`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(source),
    });
    if (res.ok) {
      setSource({ ...source, ...((await res.json()) as Source) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved?.();
    } else {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not save');
    }
  }

  const isPublic = source.connectionId === PUBLIC_GITHUB;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><GitBranch className="h-4 w-4" />Update source</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-foreground">Git host</span>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={source.connectionId ?? PUBLIC_GITHUB}
            onChange={(e) => setSource({ ...source, connectionId: e.target.value })}
          >
            <option value={PUBLIC_GITHUB}>Public GitHub repository (no sign-in)</option>
            {connections.map((c) => <option key={c.id} value={c.id}>{c.label} ({c.providerName})</option>)}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-2 block space-y-1">
            <span className="text-sm font-medium text-foreground">Repository</span>
            <Input
              value={source.repo ?? ''}
              placeholder={isPublic ? 'owner/hive or https://github.com/owner/hive' : 'owner/hive'}
              onChange={(e) => setSource({ ...source, repo: e.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">Branch</span>
            <Input value={source.branch ?? ''} placeholder="main" onChange={(e) => setSource({ ...source, branch: e.target.value })} />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void save()}>Save</Button>
          {saved && <span className="flex items-center gap-1 text-xs text-green-500"><CheckCircle2 className="h-3.5 w-3.5" />Saved</span>}
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          {isPublic
            ? 'Public repos are read anonymously. For a private repo, connect its git host in '
            : 'Connect more git hosts in '}
          <a href="/settings?tab=integrations" className="text-primary hover:underline">Settings → Integrations</a>.
          {' '}Leave the repository empty to turn in-app updates off.
        </p>
      </CardContent>
    </Card>
  );
}
