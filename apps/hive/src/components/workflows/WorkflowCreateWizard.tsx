import { useState, useEffect, useCallback } from 'react';
import { Button } from '@hive/shared/components/ui/button';
import { Loader2, Sparkles, ArrowLeft, Check, Bell, Plus, X, Mail, MessageSquare, Globe, Webhook, Key, Users, BookOpen } from 'lucide-react';
import { API_BASE } from '@/lib/api-config';
import { useWorkflowStore, type WorkflowTemplate, type WorkflowRecipe, type NotifyDirective, type Connector, type ConnectorType } from '@/stores/workflow-store';

const SCHEDULE_OPTIONS = [
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: '7:00 AM daily', value: '0 7 * * *' },
  { label: '9:30 AM weekdays', value: '30 9 * * 1-5' },
  { label: '8:00 AM weekdays', value: '0 8 * * 1-5' },
  { label: 'Monday 8:00 AM', value: '0 8 * * 1' },
  { label: 'Noon daily', value: '0 12 * * *' },
  { label: '5:00 PM weekdays', value: '0 17 * * 1-5' },
];

const DEFAULT_TEMPLATE_FOR_TYPE: Record<ConnectorType, NotifyDirective['template']> = {
  email: 'summary_table',
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
  template?: WorkflowTemplate | null;
  recipe?: WorkflowRecipe | null;
  onBack: () => void;
  onCreated: () => void;
}

export function WorkflowCreateWizard({ template, recipe, onBack, onCreated }: Props) {
  const { generating, setGenerating } = useWorkflowStore();
  const [description, setDescription] = useState(template?.promptHint || '');
  // If a recipe is provided, skip directly to review
  const [step, setStep] = useState<'describe' | 'review'>(recipe ? 'review' : 'describe');
  const [generated, setGenerated] = useState<{
    name: string;
    type: string;
    summary: string;
    definition: unknown;
    notify?: NotifyDirective[];
  } | null>(recipe ? {
    name: recipe.name,
    type: recipe.type,
    summary: recipe.description,
    definition: typeof recipe.definition === 'string' ? (() => { try { return JSON.parse(recipe.definition); } catch { return recipe.definition; } })() : recipe.definition,
  } : null);
  const [cronExpression, setCronExpression] = useState(template?.defaultCron || '30 9 * * 1-5');
  const [shareMode, setShareMode] = useState<'personal' | 'team' | 'recipe'>('personal');
  const [isDistribution, setIsDistribution] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Connectors + editable notify list
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

  async function handleGenerate() {
    if (!description.trim()) return;
    setGenerating(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/workflows/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setGenerated(data);

      // Seed notify list from AI response
      const aiNotify: NotifyDirective[] = [];
      if (data.notify?.length) {
        aiNotify.push(...data.notify);
      } else if (data.definition?.notify?.length) {
        aiNotify.push(...data.definition.notify);
      }
      setNotifyList(aiNotify);

      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!generated) return;
    setSaving(true);
    setError(null);

    try {
      const defObj = typeof generated.definition === 'string'
        ? JSON.parse(generated.definition)
        : { ...generated.definition as object };

      // Attach the user-edited notify list
      if (notifyList.length > 0) {
        defObj.notify = notifyList;
      } else {
        delete defObj.notify;
      }

      const res = await fetch(`${API_BASE}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: generated.name,
          description: description || generated.summary,
          type: generated.type,
          templateId: template?.id || null,
          definition: defObj,
          cronExpression,
          scope: shareMode === 'team' ? 'team' : 'personal',
          isDistribution: shareMode === 'team' ? isDistribution : false,
          publishAsRecipe: shareMode === 'recipe',
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

  function addNotifyDirective(connector: Connector) {
    setNotifyList(prev => [
      ...prev,
      {
        connector: connector.name,
        template: DEFAULT_TEMPLATE_FOR_TYPE[connector.type] || 'summary_text',
        lookbackRuns: 1,
      },
    ]);
  }

  function removeNotifyDirective(index: number) {
    setNotifyList(prev => prev.filter((_, i) => i !== index));
  }

  function updateNotifyDirective(index: number, updates: Partial<NotifyDirective>) {
    setNotifyList(prev => prev.map((n, i) => i === index ? { ...n, ...updates } : n));
  }

  // Connectors not yet added to the notify list
  const availableConnectors = connectors.filter(
    c => !notifyList.some(n => n.connector === c.name)
  );

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </Button>

      {step === 'describe' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold mb-1">Describe Your Workflow</h2>
            <p className="text-sm text-muted-foreground">
              Describe what you want to automate in plain English. AI will generate the workflow for you.
            </p>
          </div>

          <textarea
            className="w-full h-32 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="e.g., Track NVDA stock price every weekday and email me the last 5 days of prices..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <Button
            onClick={handleGenerate}
            disabled={!description.trim() || generating}
            className="gap-2"
          >
            {generating ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
            ) : (
              <><Sparkles className="h-4 w-4" /> Generate Workflow</>
            )}
          </Button>
        </div>
      )}

      {step === 'review' && generated && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold mb-1">Review Workflow</h2>
            <p className="text-sm text-muted-foreground">
              Review and adjust before saving.
            </p>
          </div>

          <div className="rounded-md border p-4 space-y-3">
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Name</span>
              <p className="text-sm font-medium">{generated.name}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Type</span>
              <p className="text-sm">
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {generated.type}
                </span>
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Summary</span>
              <p className="text-sm text-muted-foreground">{generated.summary}</p>
            </div>
          </div>

          {/* Credential hint from recipe */}
          {recipe?.requiresCredential && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-2">
              <Key className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-amber-400">Login required</span>
                {recipe.credentialHint && (
                  <p className="text-muted-foreground mt-0.5">{recipe.credentialHint}</p>
                )}
                <p className="text-muted-foreground mt-0.5">Make sure you have credentials saved in the Credentials manager.</p>
              </div>
            </div>
          )}

          {/* Send results to... */}
          <div className="rounded-md border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-blue-400" />
                <span className="text-sm font-medium">Send results to...</span>
              </div>
            </div>

            {notifyList.length === 0 && availableConnectors.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No connectors configured. Add connectors from the Workflow Studio page to enable notifications.
              </p>
            )}

            {notifyList.length === 0 && availableConnectors.length > 0 && (
              <p className="text-xs text-muted-foreground">
                No notifications configured. Add a connector below to send results after each run.
              </p>
            )}

            {/* Active notify directives */}
            {notifyList.map((n, i) => {
              const connector = connectors.find(c => c.name === n.connector);
              return (
                <div key={i} className="rounded-md border bg-blue-500/5 border-blue-500/20 px-3 py-2">
                <div className="flex items-center gap-2">
                  {connector && <ConnectorIcon type={connector.type} />}
                  <span className="text-sm font-medium min-w-0 truncate">{n.connector}</span>

                  <select
                    className="rounded border border-input bg-background px-2 py-1 text-xs"
                    value={n.template}
                    onChange={(e) => updateNotifyDirective(i, { template: e.target.value as NotifyDirective['template'] })}
                  >
                    <option value="summary_table">HTML table</option>
                    <option value="summary_text">Text summary</option>
                    <option value="raw_data">Raw data</option>
                  </select>

                  <div className="flex items-center gap-1">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">Last</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      className="w-14 rounded border border-input bg-background px-2 py-1 text-xs text-center"
                      value={n.lookbackRuns ?? 1}
                      onChange={(e) => updateNotifyDirective(i, { lookbackRuns: Math.max(1, parseInt(e.target.value) || 1) })}
                    />
                    <label className="text-xs text-muted-foreground whitespace-nowrap">runs</label>
                  </div>

                  <button
                    className="ml-auto text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => removeNotifyDirective(i)}
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Email recipients — explicit addresses go out via the central
                    relay, so a team workflow delivers the same regardless of
                    which teammate's machine runs it. */}
                {connector?.type === 'email' && (
                  <div className="mt-2 pt-2 border-t border-blue-500/20">
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Send to <span className="opacity-70">(comma-separated; blank = workflow owner)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="someone@example.com, someone-else@example.com"
                      className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
                      value={(n.recipients ?? []).join(', ')}
                      onChange={(e) => updateNotifyDirective(i, {
                        recipients: e.target.value
                          .split(',')
                          .map(s => s.trim())
                          .filter(Boolean),
                      })}
                    />
                  </div>
                )}
                </div>
              );
            })}

            {/* Add connector buttons */}
            {availableConnectors.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {availableConnectors.map(c => (
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

          <div>
            <label className="text-sm font-medium mb-1.5 block">Schedule</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
            >
              {SCHEDULE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Workflow Scope Selection */}
          <div className="rounded-md border p-4 space-y-3">
            <span className="text-sm font-medium">Sharing</span>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="shareMode"
                checked={shareMode === 'personal'}
                onChange={() => { setShareMode('personal'); setIsDistribution(false); }}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">Personal</span>
                <p className="text-xs text-muted-foreground">Runs on your machine only. Only you can see it.</p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="shareMode"
                checked={shareMode === 'team'}
                onChange={() => setShareMode('team')}
                className="mt-0.5"
              />
              <div>
                <div className="flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-purple-400" />
                  <span className="text-sm font-medium">Team Workflow</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Runs across all SI Hive instances. One machine claims and executes per scheduled period.
                </p>
              </div>
            </label>

            {shareMode === 'team' && (
              <label className="flex items-start gap-3 cursor-pointer ml-6">
                <input
                  type="checkbox"
                  checked={isDistribution}
                  onChange={(e) => setIsDistribution(e.target.checked)}
                  className="mt-0.5 rounded border-input"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-purple-400" />
                    <span className="text-sm font-medium">Email subscribers after each run</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Subscribers receive the workflow output via email.
                  </p>
                </div>
              </label>
            )}

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="shareMode"
                checked={shareMode === 'recipe'}
                onChange={() => { setShareMode('recipe'); setIsDistribution(false); }}
                className="mt-0.5"
              />
              <div>
                <div className="flex items-center gap-1.5">
                  <BookOpen className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-medium">Team Recipe</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Publishes as a downloadable template for the team. Also creates your personal copy.
                </p>
              </div>
            </label>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep('describe')}>
              Back to Edit
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
              ) : (
                <><Check className="h-4 w-4" /> Create Workflow</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
