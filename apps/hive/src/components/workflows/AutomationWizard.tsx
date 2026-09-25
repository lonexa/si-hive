import { useState, useEffect, useCallback } from 'react';
import { Button } from '@hive/shared/components/ui/button';
import { Loader2, ArrowLeft, Check, Bell, Plus, X, Mail, MessageSquare, Globe, Webhook, Users, Zap } from 'lucide-react';
import { API_BASE } from '@/lib/api-config';
import { type Automation, type NotifyDirective, type Connector, type ConnectorType } from '@/stores/workflow-store';

// Automations are Team Workflows — the trigger time sets when within the
// period (week or day) they fire. Weekly runs anchor to the Monday of the
// current week; daily runs anchor to today.
const WEEKLY_SCHEDULE_OPTIONS = [
  { label: 'Monday 7:00 AM', value: '0 7 * * 1' },
  { label: 'Monday 8:00 AM', value: '0 8 * * 1' },
  { label: 'Monday 9:00 AM', value: '0 9 * * 1' },
  { label: 'Monday noon', value: '0 12 * * 1' },
];
const DAILY_SCHEDULE_OPTIONS = [
  { label: 'Every day 7:00 AM', value: '0 7 * * *' },
  { label: 'Every day 8:00 AM', value: '0 8 * * *' },
  { label: 'Every day 9:00 AM', value: '0 9 * * *' },
  { label: 'Every weekday 8:00 AM', value: '0 8 * * 1-5' },
];

const DEFAULT_TEMPLATE_FOR_TYPE: Record<ConnectorType, NotifyDirective['template']> = {
  email: 'summary_text',
  slack: 'summary_text',
  'google-chat': 'summary_text',
  webhook: 'raw_data',
};

function ConnectorIcon({ type }: { type: ConnectorType }) {
  switch (type) {
    case 'email': return <Mail className="h-3.5 w-3.5 text-blue-400" />;
    case 'slack': return <MessageSquare className="h-3.5 w-3.5 text-purple-400" />;
    case 'google-chat': return <MessageSquare className="h-3.5 w-3.5 text-green-400" />;
    case 'webhook': return <Globe className="h-3.5 w-3.5 text-orange-400" />;
    default: return <Webhook className="h-3.5 w-3.5" />;
  }
}

interface Props {
  automation: Automation;
  onBack: () => void;
  onCreated: () => void;
}

export function AutomationWizard({ automation, onBack, onCreated }: Props) {
  const [name, setName] = useState(automation.label);
  const [cronExpression, setCronExpression] = useState(automation.defaultCron);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [notifyList, setNotifyList] = useState<NotifyDirective[]>([]);

  const fetchConnectors = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/connectors`);
      if (res.ok) {
        const data = await res.json();
        setConnectors(data.connectors || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchConnectors(); }, [fetchConnectors]);

  // Pick schedule presets matching the automation's claim granularity.
  const baseOptions = automation.anchor === 'daily' ? DAILY_SCHEDULE_OPTIONS : WEEKLY_SCHEDULE_OPTIONS;
  // Ensure the automation's default schedule is always selectable.
  const scheduleOptions = baseOptions.some((o) => o.value === automation.defaultCron)
    ? baseOptions
    : [{ label: automation.defaultCron, value: automation.defaultCron }, ...baseOptions];

  const availableConnectors = connectors.filter(
    (c) => !notifyList.some((n) => n.connector === c.name)
  );

  function addNotifyDirective(connector: Connector) {
    // Actions that already produce a finished HTML document (e.g. claude-daily)
    // declare defaultEmailTemplate: 'raw_html' so the email body is the report
    // itself rather than a summary table built from dataJson fields.
    const template = connector.type === 'email' && automation.defaultEmailTemplate
      ? automation.defaultEmailTemplate
      : (DEFAULT_TEMPLATE_FOR_TYPE[connector.type] || 'summary_text');
    setNotifyList((prev) => [
      ...prev,
      {
        connector: connector.name,
        template,
        lookbackRuns: 1,
      },
    ]);
  }

  function removeNotifyDirective(index: number) {
    setNotifyList((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const definition: Record<string, unknown> = {
        version: 1,
        type: 'action',
        action: { kind: automation.kind },
        output: { format: 'text' },
      };
      if (notifyList.length > 0) definition.notify = notifyList;

      const res = await fetch(`${API_BASE}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || automation.label,
          description: automation.description,
          type: 'action',
          definition,
          cronExpression,
          scope: 'team',
          // Action workflows are team-wide by design, and the subscriber-email
          // path (Azure Function SMTP fan-out) is gated by this flag.
          isDistribution: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </Button>

      <div>
        <h2 className="text-base font-semibold mb-1 flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" /> {automation.label}
        </h2>
        <p className="text-sm text-muted-foreground">{automation.description}</p>
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Name</label>
        <input
          type="text"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Schedule</label>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={cronExpression}
          onChange={(e) => setCronExpression(e.target.value)}
        >
          {scheduleOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          {automation.anchor === 'daily'
            ? 'Runs once per day. If no SI Hive instance is online at the trigger time, the first one online later that day catches up — never more than once.'
            : 'Runs once per week. If no SI Hive instance is online at the trigger time, the first one online later that week catches up — never more than once.'}
        </p>
      </div>

      {/* Send results to... */}
      <div className="rounded-md border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium">Notify after each run (optional)</span>
        </div>

        {notifyList.length === 0 && availableConnectors.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No connectors configured. Add connectors from the Workflow Studio page to enable notifications.
          </p>
        )}

        {notifyList.map((n, i) => {
          const connector = connectors.find((c) => c.name === n.connector);
          return (
            <div key={i} className="flex items-center gap-2 rounded-md border bg-blue-500/5 border-blue-500/20 px-3 py-2">
              {connector && <ConnectorIcon type={connector.type} />}
              <span className="text-sm font-medium min-w-0 truncate">{n.connector}</span>
              <button
                className="ml-auto text-muted-foreground hover:text-destructive transition-colors"
                onClick={() => removeNotifyDirective(i)}
                title="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}

        {availableConnectors.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {availableConnectors.map((c) => (
              <button
                key={c.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-muted-foreground/30 px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
                onClick={() => addNotifyDirective(c)}
              >
                <Plus className="h-3 w-3" />
                <ConnectorIcon type={c.type} />
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Scope — forced team, shown for clarity */}
      <div className="rounded-md border border-purple-500/20 bg-purple-500/5 px-4 py-3 flex items-start gap-2">
        <Users className="h-4 w-4 text-purple-400 mt-0.5 shrink-0" />
        <div className="text-sm">
          <span className="font-medium text-purple-300">Team Workflow</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            Runs across all SI Hive instances. One machine claims and executes per week — it never runs twice.
          </p>
        </div>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>
          ) : (
            <><Check className="h-4 w-4" /> Create Automation</>
          )}
        </Button>
      </div>
    </div>
  );
}
