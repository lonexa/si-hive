import { useState, useEffect, useCallback } from 'react';
import { Button } from '@hive/shared/components/ui/button';
import {
  ArrowLeft, Play, ToggleLeft, ToggleRight, Trash2, Loader2,
  Clock, Calendar, Settings2, BarChart3, History, Bell, BellOff, BookOpen, Mail, Users, Monitor, User,
} from 'lucide-react';
import { API_BASE } from '@/lib/api-config';
import { useAuth } from '@/auth/AuthProvider';
import { useWorkflowStore, type Workflow, type WorkflowRun } from '@/stores/workflow-store';
import { WorkflowRunHistory } from './WorkflowRunHistory';
import { WorkflowChart } from './WorkflowChart';
import { ExternalSubscribersPanel } from './ExternalSubscribersPanel';
import { RunTargetsPanel } from './RunTargetsPanel';

interface Props {
  workflowId: number;
  onBack: () => void;
  onDeleted: () => void;
  onRecipePublished?: () => void;
}

type Tab = 'overview' | 'runs' | 'chart' | 'settings';

function cronToHuman(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;
  if (cron.startsWith('*/5')) return 'Every 5 minutes';
  if (cron.startsWith('0 *')) return 'Every hour';
  const h = parseInt(hour);
  const m = parseInt(min);
  const timeStr = `${h > 12 ? h - 12 : h}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  if (dow === '1') return `${timeStr} Mondays`;
  if (dow === '1-5') return `${timeStr} weekdays`;
  if (dow === '*') return `${timeStr} daily`;
  return `${timeStr} (${dow})`;
}

export function WorkflowDetailPanel({ workflowId, onBack, onDeleted, onRecipePublished }: Props) {
  const { user } = useAuth();
  const { updateWorkflow } = useWorkflowStore();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [togglingDistribution, setTogglingDistribution] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [publishDesc, setPublishDesc] = useState('');
  const [publishTags, setPublishTags] = useState('');
  const [publishAuthor, setPublishAuthor] = useState('');
  const [publishRequiresCred, setPublishRequiresCred] = useState(false);
  const [publishCredHint, setPublishCredHint] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/workflows/${workflowId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWorkflow(data);
      setRuns(data.recentRuns || []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  const fetchSubscriptionInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/distributions/${workflowId}/subscribers`);
      if (res.ok) {
        const data = await res.json();
        setSubscriberCount(data.count ?? 0);
      }
    } catch { /* ignore */ }
  }, [workflowId]);

  useEffect(() => {
    fetchDetail();
    fetchSubscriptionInfo();
  }, [fetchDetail, fetchSubscriptionInfo]);

  // Update subscribed state when workflow loads
  useEffect(() => {
    if (workflow?.isSubscribed !== undefined) {
      setSubscribed(workflow.isSubscribed);
    }
  }, [workflow?.isSubscribed]);

  async function handleSubscribe() {
    const action = subscribed ? 'unsubscribe' : 'subscribe';
    try {
      const res = await fetch(`${API_BASE}/api/distributions/${workflowId}/${action}`, { method: 'POST' });
      if (res.ok) {
        setSubscribed(!subscribed);
        setSubscriberCount(prev => subscribed ? Math.max(0, prev - 1) : prev + 1);
      }
    } catch { /* ignore */ }
  }

  async function handleToggleDistribution() {
    if (!workflow) return;
    setTogglingDistribution(true);
    try {
      const newIsDistribution = !workflow.isDistribution;
      const body: Record<string, unknown> = { isDistribution: newIsDistribution };
      if (newIsDistribution) body.scope = 'team';

      const res = await fetch(`${API_BASE}/api/workflows/${workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json();
        setWorkflow(updated);
        updateWorkflow(workflowId, { isDistribution: updated.isDistribution, scope: updated.scope });
        // Auto-subscribe creator when enabling distribution
        if (newIsDistribution) {
          await fetch(`${API_BASE}/api/distributions/${workflowId}/subscribe`, { method: 'POST' });
          setSubscribed(true);
          setSubscriberCount(prev => prev + 1);
        }
        fetchSubscriptionInfo();
      }
    } catch { /* ignore */ }
    finally { setTogglingDistribution(false); }
  }

  async function handleToggle() {
    if (!workflow) return;
    try {
      const res = await fetch(`${API_BASE}/api/workflows/${workflowId}/toggle`, { method: 'POST' });
      if (res.ok) {
        const updated = await res.json();
        setWorkflow(updated);
        updateWorkflow(workflowId, { enabled: updated.enabled });
      }
    } catch { /* ignore */ }
  }

  async function handleRun() {
    setRunning(true);
    try {
      await fetch(`${API_BASE}/api/workflows/${workflowId}/run`, { method: 'POST' });
      // Wait a moment then refresh to show running/completed status
      setTimeout(() => fetchDetail(), 2000);
    } catch { /* ignore */ }
    finally { setRunning(false); }
  }

  async function handleDelete() {
    if (!confirm('Delete this workflow and all its run history?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/workflows/${workflowId}`, { method: 'DELETE' });
      if (res.ok) onDeleted();
    } catch { /* ignore */ }
  }

  async function fetchRuns() {
    try {
      const res = await fetch(`${API_BASE}/api/workflows/${workflowId}/runs`);
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
      }
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p>Workflow not found</p>
        <Button variant="ghost" size="sm" onClick={onBack} className="mt-2">Go Back</Button>
      </div>
    );
  }

  const definition = (() => {
    try { return JSON.parse(workflow.definition); } catch { return null; }
  })();

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <Calendar className="h-3.5 w-3.5" /> },
    { key: 'runs', label: 'Runs', icon: <History className="h-3.5 w-3.5" /> },
    { key: 'chart', label: 'Chart', icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { key: 'settings', label: 'Settings', icon: <Settings2 className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold truncate">{workflow.name}</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {workflow.type}
            </span>
            <span>{cronToHuman(workflow.cronExpression)}</span>
            {workflow.isDistribution && (
              <span className="inline-flex items-center rounded-full bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-400">
                <Mail className="h-3 w-3 mr-0.5" /> Distribution
              </span>
            )}
            {workflow.scope === 'team' && !workflow.isDistribution && (
              <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">
                <Users className="h-3 w-3 mr-0.5" /> Team
              </span>
            )}
            <span className={workflow.enabled ? 'text-green-500' : 'text-muted-foreground'}>
              {workflow.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleToggle} className="gap-1.5">
          {workflow.enabled ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4" />}
          {workflow.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button size="sm" onClick={handleRun} disabled={running} className="gap-1.5">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run Now
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => {
              setTab(t.key);
              if (t.key === 'runs') fetchRuns();
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && (
        <div className="space-y-3">
          {/* Team workflow info */}
          {workflow.scope === 'team' && (
            <div className="rounded-md border border-purple-500/20 bg-purple-500/5 p-4 space-y-2">
              <div className="flex items-center gap-3 text-sm">
                <Users className="h-4 w-4 text-purple-400 shrink-0" />
                <span className="font-medium">Team Workflow</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {workflow.ownerName && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" /> Created by {workflow.ownerName}
                  </span>
                )}
                {workflow.lastClaimedBy && (
                  <span className="flex items-center gap-1">
                    <Monitor className="h-3 w-3" /> Last run by {workflow.lastClaimedBy}
                  </span>
                )}
              </div>
              {/* Distribution subscription */}
              {workflow.isDistribution && (
                <div className="flex items-center justify-between pt-2 border-t border-purple-500/10">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-purple-400" />
                    <div>
                      <p className="text-sm font-medium">Email Distribution</p>
                      <p className="text-xs text-muted-foreground">
                        {subscriberCount} subscriber{subscriberCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={subscribed ? 'default' : 'outline'}
                    onClick={handleSubscribe}
                    className="gap-1.5"
                  >
                    {subscribed ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                    {subscribed ? 'Subscribed' : 'Subscribe'}
                  </Button>
                </div>
              )}
            </div>
          )}

          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Description</span>
            <p className="text-sm mt-0.5">{workflow.description}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Last Run</span>
              <p className="text-sm mt-0.5 flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {workflow.lastRunAt ? new Date(workflow.lastRunAt).toLocaleString() : 'Never'}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Next Run</span>
              <p className="text-sm mt-0.5 flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                {workflow.nextRunAt ? new Date(workflow.nextRunAt).toLocaleString() : '-'}
              </p>
            </div>
          </div>
          {definition?.notify?.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Notifications</span>
              <div className="space-y-1">
                {definition.notify.map((n: { connector: string; template: string; lookbackRuns?: number; recipients?: string[] }, i: number) => (
                  <div key={i} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Bell className="h-3.5 w-3.5 text-blue-400" />
                      <span className="font-medium">{n.connector}</span>
                      <span className="text-muted-foreground">
                        {n.template === 'summary_table' ? 'HTML table' : n.template === 'summary_text' ? 'Text' : 'Raw'}
                        {n.lookbackRuns && n.lookbackRuns > 1 ? ` (last ${n.lookbackRuns} runs)` : ''}
                      </span>
                    </div>
                    {n.recipients?.length ? (
                      <div className="ml-[1.375rem] text-xs text-muted-foreground truncate" title={n.recipients.join(', ')}>
                        to {n.recipients.join(', ')}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
          {runs.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Recent Runs</span>
              <WorkflowRunHistory runs={runs.slice(0, 5)} />
            </div>
          )}
        </div>
      )}

      {tab === 'runs' && <WorkflowRunHistory runs={runs} />}

      {tab === 'chart' && (
        <WorkflowChart
          workflowId={workflowId}
          chartConfig={definition?.output?.chartConfig}
        />
      )}

      {tab === 'settings' && (
        <div className="space-y-4">
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Schedule (Cron)</span>
            <p className="text-sm font-mono mt-0.5">{workflow.cronExpression}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Max Runs Kept</span>
            <p className="text-sm mt-0.5">{workflow.maxRunsKept}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Definition (JSON)</span>
            <pre className="text-xs text-muted-foreground bg-muted rounded px-3 py-2 overflow-x-auto max-h-64 mt-1">
              {JSON.stringify(definition, null, 2)}
            </pre>
          </div>
          {/* Email Distribution toggle (team workflows, owner only) */}
          {workflow.scope === 'team' && user && workflow.userId === user.oid && (
            <div className="rounded-md border p-4 space-y-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!workflow.isDistribution}
                  onChange={handleToggleDistribution}
                  disabled={togglingDistribution}
                  className="mt-0.5 rounded border-input"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-purple-400" />
                    <span className="text-sm font-medium">Email Distribution</span>
                    {togglingDistribution && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When enabled, subscribers receive workflow output via email after each run.
                  </p>
                </div>
              </label>
              {workflow.isDistribution && (
                <div className="ml-6 text-xs text-muted-foreground flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {subscriberCount} subscriber{subscriberCount !== 1 ? 's' : ''} currently subscribed
                </div>
              )}
            </div>
          )}

          {/* External email subscribers — owner-only panel for adding emails of people without Hive accounts */}
          {workflow.isDistribution && user && workflow.userId === user.oid && (
            <ExternalSubscribersPanel
              workflowId={workflowId}
              onChange={fetchSubscriptionInfo}
            />
          )}

          {/* Run targets — owner-only: restrict which members' machines run this team workflow */}
          {workflow.scope === 'team' && user && workflow.userId === user.oid && (
            <RunTargetsPanel workflowId={workflowId} />
          )}

          <div className="pt-2 border-t space-y-3">
            <div>
              <Button variant="outline" size="sm" onClick={() => { setShowPublish(!showPublish); setPublishName(workflow.name); setPublishDesc(workflow.description); }} className="gap-1.5">
                <BookOpen className="h-3.5 w-3.5" /> Publish as Team Recipe
              </Button>
            </div>

            {showPublish && (
              <div className="rounded-md border p-4 space-y-3">
                <p className="text-xs text-muted-foreground">Share this working workflow as a recipe so others can use it without AI generation.</p>
                <div>
                  <label className="text-xs font-medium mb-1 block">Recipe Name</label>
                  <input type="text" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={publishName} onChange={(e) => setPublishName(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Description</label>
                  <textarea className="w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none" value={publishDesc} onChange={(e) => setPublishDesc(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Tags (comma-separated)</label>
                  <input type="text" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="reports, admin, monitoring" value={publishTags} onChange={(e) => setPublishTags(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Author</label>
                  <input type="text" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Your name" value={publishAuthor} onChange={(e) => setPublishAuthor(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="pub-cred" checked={publishRequiresCred} onChange={(e) => setPublishRequiresCred(e.target.checked)} />
                  <label htmlFor="pub-cred" className="text-xs font-medium">Requires login credentials</label>
                </div>
                {publishRequiresCred && (
                  <div>
                    <label className="text-xs font-medium mb-1 block">Credential Hint</label>
                    <input type="text" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="e.g., Requires a login for admin.example.com" value={publishCredHint} onChange={(e) => setPublishCredHint(e.target.value)} />
                  </div>
                )}
                {publishResult && <p className="text-xs text-green-500">{publishResult}</p>}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowPublish(false)}>Cancel</Button>
                  <Button size="sm" disabled={!publishName.trim() || !publishDesc.trim() || publishing} className="gap-1" onClick={async () => {
                    setPublishing(true);
                    try {
                      const res = await fetch(`${API_BASE}/api/workflows/${workflowId}/publish-recipe`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          name: publishName, description: publishDesc, tags: publishTags,
                          author: publishAuthor, requiresCredential: publishRequiresCred,
                          credentialHint: publishCredHint,
                        }),
                      });
                      if (res.ok) {
                        setPublishResult('Published!');
                        setShowPublish(false);
                        onRecipePublished?.();
                      }
                    } catch { /* ignore */ }
                    finally { setPublishing(false); }
                  }}>
                    {publishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookOpen className="h-3 w-3" />}
                    Publish
                  </Button>
                </div>
              </div>
            )}

            {(!workflow.scope || workflow.scope === 'personal' || (user && workflow.userId === user.oid)) && (
              <Button variant="destructive" size="sm" onClick={handleDelete} className="gap-1.5">
                <Trash2 className="h-3.5 w-3.5" /> Delete Workflow
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
