import { useState, useEffect, useCallback } from 'react';
import { Monitor, Loader2, Circle, Check } from 'lucide-react';
import { Button } from '@hive/shared/components/ui/button';
import { API_BASE } from '@/lib/api-config';

interface Member {
  oid: string;
  displayName: string | null;
  email: string | null;
  lastVersion: string | null;
  lastCommit: string | null;
  lastHeartbeatAt: string | null;
  isOnline: boolean;
}

interface Props {
  workflowId: number;
}

/**
 * Owner-only panel that controls which team members' machines may run a team
 * workflow. With nothing selected, every member is eligible (the default). Check
 * specific members to restrict execution to their machines — useful when the
 * workflow keeps failing on someone's box (stale build, missing CLI, offline).
 *
 * Renders nothing on a 403, so it's safe to mount for non-owners.
 */
export function RunTargetsPanel({ workflowId }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const fetchTargets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/workflows/${workflowId}/run-targets`);
      if (res.status === 403 || res.status === 400) { setForbidden(true); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { members: Member[]; selected: string[] };
      setForbidden(false);
      setMembers(data.members ?? []);
      setSelected(new Set(data.selected ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => { fetchTargets(); }, [fetchTargets]);

  function toggle(oid: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(oid)) next.delete(oid); else next.add(oid);
      return next;
    });
    setSavedAt(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/workflows/${workflowId}/run-targets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userOids: [...selected] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (forbidden) return null;

  const restricted = selected.size > 0;

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Monitor className="h-4 w-4 text-blue-400" />
        <span className="text-sm font-medium">Run On</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Choose which team members' machines may run this workflow. With none selected,
        any member's machine can pick it up (default). Select specific members to
        restrict it — handy if it keeps failing on someone's machine.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading members…
        </div>
      ) : (
        <>
          <div className="space-y-1">
            {members.map((m) => {
              const checked = selected.has(m.oid);
              return (
                <label
                  key={m.oid}
                  className="flex items-center gap-2.5 rounded-md border bg-background px-3 py-2 text-sm cursor-pointer hover:bg-accent/40"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(m.oid)}
                    className="rounded border-input"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium truncate">{m.displayName || m.email || m.oid}</span>
                      <Circle
                        className={`h-2 w-2 shrink-0 ${m.isOnline ? 'fill-green-500 text-green-500' : 'fill-muted-foreground/40 text-muted-foreground/40'}`}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {m.email}
                      {m.lastVersion ? ` · v${m.lastVersion}` : ''}
                    </div>
                  </div>
                </label>
              );
            })}
            {members.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No members found.</p>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">
              {restricted
                ? `Restricted to ${selected.size} member${selected.size !== 1 ? 's' : ''}`
                : 'All members eligible'}
            </span>
            <div className="flex items-center gap-2">
              {savedAt && (
                <span className="text-xs text-green-500 flex items-center gap-1">
                  <Check className="h-3 w-3" /> Saved
                </span>
              )}
              <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
