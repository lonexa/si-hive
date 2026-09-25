import { useState, useEffect, useCallback } from 'react';
import { Button } from '@hive/shared/components/ui/button';
import { Plus, Trash2, Loader2, TestTube, Mail, MessageSquare, Globe, Webhook } from 'lucide-react';
import { API_BASE } from '@/lib/api-config';
import { useWorkflowStore, type Connector, type ConnectorType } from '@/stores/workflow-store';

const CONNECTOR_TYPES: { type: ConnectorType; label: string; icon: React.ReactNode; configFields: { key: string; label: string; placeholder: string; type?: string }[] }[] = [
  {
    type: 'email',
    label: 'Email (Gmail)',
    icon: <Mail className="h-4 w-4" />,
    configFields: [], // No config needed — uses connected Gmail
  },
  {
    type: 'slack',
    label: 'Slack',
    icon: <MessageSquare className="h-4 w-4" />,
    configFields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...' },
    ],
  },
  {
    type: 'google-chat',
    label: 'Google Chat',
    icon: <MessageSquare className="h-4 w-4" />,
    configFields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://chat.googleapis.com/v1/spaces/...' },
    ],
  },
  {
    type: 'webhook',
    label: 'Webhook',
    icon: <Webhook className="h-4 w-4" />,
    configFields: [
      { key: 'url', label: 'URL', placeholder: 'https://example.com/webhook' },
      { key: 'method', label: 'Method', placeholder: 'POST' },
    ],
  },
];

function ConnectorIcon({ type }: { type: ConnectorType }) {
  switch (type) {
    case 'email': return <Mail className="h-4 w-4 text-blue-400" />;
    case 'slack': return <MessageSquare className="h-4 w-4 text-purple-400" />;
    case 'google-chat': return <MessageSquare className="h-4 w-4 text-green-400" />;
    case 'webhook': return <Globe className="h-4 w-4 text-orange-400" />;
    default: return <Webhook className="h-4 w-4" />;
  }
}

export function ConnectorManager() {
  const { connectors, setConnectors } = useWorkflowStore();
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<ConnectorType | ''>('');
  const [addName, setAddName] = useState('');
  const [addConfig, setAddConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchConnectors = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/connectors`);
      if (res.ok) {
        const data = await res.json();
        setConnectors(data.connectors || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [setConnectors]);

  useEffect(() => { fetchConnectors(); }, [fetchConnectors]);

  async function handleAdd() {
    if (!addType || !addName.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const config = addType === 'email' ? { useGmail: true } : addConfig;
      const res = await fetch(`${API_BASE}/api/connectors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: addType, name: addName, config }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setShowAdd(false);
      setAddType('');
      setAddName('');
      setAddConfig({});
      fetchConnectors();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this connector?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/connectors/${id}`, { method: 'DELETE' });
      if (res.ok) fetchConnectors();
    } catch { /* ignore */ }
  }

  async function handleTest(id: number) {
    setTesting(id);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/connectors/${id}/test`, { method: 'POST' });
      const data = await res.json();
      setTestResult({ id, ok: res.ok, message: data.message || data.error || 'Sent' });
    } catch (err) {
      setTestResult({ id, ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(null);
    }
  }

  const selectedType = CONNECTOR_TYPES.find(t => t.type === addType);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Connectors</h3>
        <Button variant="outline" size="sm" onClick={() => setShowAdd(!showAdd)} className="gap-1">
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading connectors...
        </div>
      )}

      {!loading && connectors.length === 0 && !showAdd && (
        <p className="text-sm text-muted-foreground py-2">
          No connectors configured. Add one to enable workflow notifications.
        </p>
      )}

      {/* Existing connectors */}
      {connectors.map((c: Connector) => (
        <div key={c.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
          <ConnectorIcon type={c.type} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{c.name}</p>
            <p className="text-xs text-muted-foreground">{c.type}{c.isSystem ? ' (system)' : ''}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => handleTest(c.id)}
            disabled={testing === c.id}
            title="Test"
          >
            {testing === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube className="h-3.5 w-3.5" />}
          </Button>
          {!c.isSystem && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() => handleDelete(c.id)}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {testResult?.id === c.id && (
            <span className={`text-xs ${testResult.ok ? 'text-green-500' : 'text-red-500'}`}>
              {testResult.message}
            </span>
          )}
        </div>
      ))}

      {/* Add connector form */}
      {showAdd && (
        <div className="rounded-md border p-4 space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block">Type</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={addType}
              onChange={(e) => { setAddType(e.target.value as ConnectorType); setAddConfig({}); }}
            >
              <option value="">Select type...</option>
              {CONNECTOR_TYPES.map(t => (
                <option key={t.type} value={t.type}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block">Name</label>
            <input
              type="text"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="e.g., My Slack Channel"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
            />
          </div>

          {selectedType?.configFields.map(field => (
            <div key={field.key}>
              <label className="text-xs font-medium mb-1 block">{field.label}</label>
              <input
                type={field.type || 'text'}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder={field.placeholder}
                value={addConfig[field.key] || ''}
                onChange={(e) => setAddConfig({ ...addConfig, [field.key]: e.target.value })}
              />
            </div>
          ))}

          {addType === 'email' && (
            <p className="text-xs text-muted-foreground">
              Uses your connected Gmail account. Make sure Gmail is connected in Settings.
            </p>
          )}

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowAdd(false); setError(null); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleAdd} disabled={!addType || !addName.trim() || saving} className="gap-1">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add Connector
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
