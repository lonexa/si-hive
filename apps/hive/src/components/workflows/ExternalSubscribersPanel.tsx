import { useState, useEffect, useCallback } from 'react';
import { Mail, Plus, X, Loader2, Users } from 'lucide-react';
import { Button } from '@hive/shared/components/ui/button';
import { API_BASE } from '@/lib/api-config';

interface ExternalSubscriber {
  email: string;
  addedByOid: string | null;
  addedAt: string;
}

interface Props {
  workflowId: number;
  /** Refresh callback so the parent's count chip updates after add/remove. */
  onChange?: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Owner-only panel for managing email addresses of people who should receive
 * the distribution but don't have a Hive account. Renders nothing on a 403,
 * so it's safe to mount unconditionally — non-owners just see an empty box.
 */
export function ExternalSubscribersPanel({ workflowId, onChange }: Props) {
  const [externals, setExternals] = useState<ExternalSubscriber[]>([]);
  const [internalEmails, setInternalEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscribers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/distributions/${workflowId}/subscribers`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        externals?: ExternalSubscriber[];
        emails?: string[];
      };
      // The server only returns `externals` to the workflow owner; absence here
      // means we're not the owner, so we hide the panel.
      if (!Array.isArray(data.externals)) {
        setForbidden(true);
        return;
      }
      setForbidden(false);
      setExternals(data.externals);
      setInternalEmails(data.emails ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => { fetchSubscribers(); }, [fetchSubscribers]);

  async function handleAdd() {
    const trimmed = newEmail.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    setError(null);
    setAdding(true);
    try {
      const res = await fetch(`${API_BASE}/api/distributions/${workflowId}/external-subscribers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setNewEmail('');
      await fetchSubscribers();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(email: string) {
    setRemoving(email);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/distributions/${workflowId}/external-subscribers?email=${encodeURIComponent(email)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await fetchSubscribers();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(null);
    }
  }

  if (forbidden) return null;

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-purple-400" />
        <span className="text-sm font-medium">Email Subscribers</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading subscribers…
        </div>
      ) : (
        <>
          {internalEmails.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" /> SI Hive users ({internalEmails.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {internalEmails.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs"
                    title="Subscribed via SI Hive account"
                  >
                    {email}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Mail className="h-3 w-3" /> External emails ({externals.length})
            </div>
            {externals.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No external subscribers yet.</p>
            ) : (
              <div className="space-y-1">
                {externals.map((sub) => (
                  <div
                    key={sub.email}
                    className="flex items-center justify-between rounded-md border bg-background px-3 py-1.5 text-xs"
                  >
                    <span>{sub.email}</span>
                    <button
                      onClick={() => handleRemove(sub.email)}
                      disabled={removing === sub.email}
                      className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      title="Remove"
                    >
                      {removing === sub.email
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <X className="h-3 w-3" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <input
              type="email"
              placeholder="name@example.com"
              value={newEmail}
              onChange={(e) => { setNewEmail(e.target.value); if (error) setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !adding) void handleAdd(); }}
              disabled={adding}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={adding || !newEmail.trim()}
              className="gap-1"
            >
              {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">
            External recipients receive the distribution email but don't need an SI Hive account.
            Owner only — added emails are visible to you in this panel.
          </p>
        </>
      )}
    </div>
  );
}
