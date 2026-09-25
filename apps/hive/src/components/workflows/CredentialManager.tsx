import { useState, useEffect } from 'react';
import { Button } from '@hive/shared/components/ui/button';
import { Plus, Trash2, KeyRound, Loader2 } from 'lucide-react';
import { API_BASE } from '@/lib/api-config';
import { useWorkflowStore } from '@/stores/workflow-store';

export function CredentialManager() {
  const { credentials, setCredentials } = useWorkflowStore();
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ label: '', siteUrl: '', username: '', password: '' });

  useEffect(() => {
    fetchCredentials();
  }, []);

  async function fetchCredentials() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/workflow-credentials`);
      if (res.ok) {
        const data = await res.json();
        setCredentials(data.credentials || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function handleSave() {
    if (!form.label || !form.username || !form.password) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/workflow-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setForm({ label: '', siteUrl: '', username: '', password: '' });
        setShowForm(false);
        fetchCredentials();
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this credential?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/workflow-credentials/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setCredentials(credentials.filter(c => c.id !== id));
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Saved Credentials</h3>
        <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)} className="gap-1">
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>

      {showForm && (
        <div className="rounded-md border p-3 space-y-2">
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            placeholder="Label (e.g., Expense Portal)"
            value={form.label}
            onChange={(e) => setForm(f => ({ ...f, label: e.target.value }))}
          />
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            placeholder="Site URL (optional)"
            value={form.siteUrl}
            onChange={(e) => setForm(f => ({ ...f, siteUrl: e.target.value }))}
          />
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))}
          />
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            placeholder="Password"
            type="password"
            value={form.password}
            onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading...</div>
      ) : credentials.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">
          No saved credentials. Add credentials for workflows that require login.
        </div>
      ) : (
        <div className="space-y-1">
          {credentials.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{c.label}</p>
                <p className="text-xs text-muted-foreground truncate">{c.username}{c.siteUrl ? ` @ ${c.siteUrl}` : ''}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(c.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
