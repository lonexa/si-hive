import { useState, useEffect, useCallback } from 'react';
import { Button } from '@hive/shared/components/ui/button';
import { Zap, Plus, Loader2, Clock, CheckCircle2, XCircle, ToggleLeft, ToggleRight, BookOpen, Key, Tag, User, Trash2, Mail, Users, Bell, BellOff, Monitor } from 'lucide-react';
import { API_BASE } from '@/lib/api-config';
import { useWorkflowStore, type Workflow, type WorkflowTemplate, type WorkflowRecipe, type Automation } from '@/stores/workflow-store';
import { WorkflowTemplateGallery } from './WorkflowTemplateGallery';
import { WorkflowCreateWizard } from './WorkflowCreateWizard';
import { AutomationWizard } from './AutomationWizard';
import { WorkflowDetailPanel } from './WorkflowDetailPanel';
import { CredentialManager } from './CredentialManager';
import { ConnectorManager } from './ConnectorManager';

type View = 'list' | 'create' | 'detail' | 'automation';

function cronToHuman(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;
  if (cron.startsWith('*/5')) return 'Every 5 min';
  if (cron.startsWith('0 *')) return 'Hourly';
  const h = parseInt(hour);
  const m = parseInt(min);
  const timeStr = `${h > 12 ? h - 12 : h}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  if (dow === '1') return `${timeStr} Mon`;
  if (dow === '1-5') return `${timeStr} wkdays`;
  if (dow === '*') return `${timeStr} daily`;
  return `${timeStr}`;
}

export default function WorkflowStudioPage() {
  const { workflows, setWorkflows, teamWorkflows, setTeamWorkflows, templates, setTemplates, recipes, setRecipes, updateWorkflow } = useWorkflowStore();
  const [view, setView] = useState<View>('list');
  const [loading, setLoading] = useState(true);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<WorkflowRecipe | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [selectedAutomation, setSelectedAutomation] = useState<Automation | null>(null);
  const [showCredentials, setShowCredentials] = useState(false);
  const [showConnectors, setShowConnectors] = useState(false);

  const fetchWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/workflows`);
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows || []);
        setTeamWorkflows(data.teamWorkflows || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [setWorkflows, setTeamWorkflows]);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/workflows/templates`);
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch { /* ignore */ }
  }, [setTemplates]);

  const fetchRecipes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/workflow-recipes`);
      if (res.ok) {
        const data = await res.json();
        setRecipes(data.recipes || []);
      }
    } catch { /* ignore */ }
  }, [setRecipes]);

  const fetchAutomations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/workflows/automations`);
      if (res.ok) {
        const data = await res.json();
        setAutomations(data.automations || []);
      }
    } catch { /* ignore */ }
  }, []);

  async function handleDeleteRecipe(recipe: WorkflowRecipe) {
    if (!confirm(`Delete shared recipe "${recipe.name}"?`)) return;
    try {
      await fetch(`${API_BASE}/api/workflow-recipes/${recipe.id}`, { method: 'DELETE' });
      fetchRecipes();
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchWorkflows();
    fetchTemplates();
    fetchRecipes();
    fetchAutomations();
  }, [fetchWorkflows, fetchTemplates, fetchRecipes, fetchAutomations]);

  async function handleToggle(e: React.MouseEvent, wf: Workflow) {
    e.stopPropagation();
    try {
      const res = await fetch(`${API_BASE}/api/workflows/${wf.id}/toggle`, { method: 'POST' });
      if (res.ok) {
        const updated = await res.json();
        updateWorkflow(wf.id, { enabled: updated.enabled });
      }
    } catch { /* ignore */ }
  }

  async function handleSubscribe(e: React.MouseEvent, wf: Workflow) {
    e.stopPropagation();
    const action = wf.isSubscribed ? 'unsubscribe' : 'subscribe';
    try {
      const res = await fetch(`${API_BASE}/api/distributions/${wf.id}/${action}`, { method: 'POST' });
      if (res.ok) fetchWorkflows();
    } catch { /* ignore */ }
  }

  if (view === 'create') {
    return (
      <div className="space-y-4">
        <WorkflowCreateWizard
          template={selectedTemplate}
          recipe={selectedRecipe}
          onBack={() => { setView('list'); setSelectedTemplate(null); setSelectedRecipe(null); }}
          onCreated={() => { setView('list'); setSelectedTemplate(null); setSelectedRecipe(null); fetchWorkflows(); fetchRecipes(); }}
        />
      </div>
    );
  }

  if (view === 'automation' && selectedAutomation) {
    return (
      <div className="space-y-4">
        <AutomationWizard
          automation={selectedAutomation}
          onBack={() => { setView('list'); setSelectedAutomation(null); }}
          onCreated={() => { setView('list'); setSelectedAutomation(null); fetchWorkflows(); }}
        />
      </div>
    );
  }

  if (view === 'detail' && selectedWorkflowId !== null) {
    return (
      <WorkflowDetailPanel
        workflowId={selectedWorkflowId}
        onBack={() => { setView('list'); setSelectedWorkflowId(null); }}
        onDeleted={() => { setView('list'); setSelectedWorkflowId(null); fetchWorkflows(); }}
        onRecipePublished={fetchRecipes}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Workflow Studio</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setShowConnectors(!showConnectors); if (!showConnectors) setShowCredentials(false); }} data-track="workflows.toggle_connectors" data-track-category="nav">
            Connectors
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setShowCredentials(!showCredentials); if (!showCredentials) setShowConnectors(false); }} data-track="workflows.toggle_credentials" data-track-category="nav">
            Credentials
          </Button>
          <Button size="sm" onClick={() => { setSelectedTemplate(null); setSelectedRecipe(null); setView('create'); }} data-track="workflows.new_workflow" data-track-category="action">
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Workflow
          </Button>
        </div>
      </div>

      {showConnectors && (
        <div className="rounded-lg border p-4">
          <ConnectorManager />
        </div>
      )}

      {showCredentials && (
        <div className="rounded-lg border p-4">
          <CredentialManager />
        </div>
      )}

      {automations.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-amber-400" /> Automations
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {automations.map((a) => (
              <button
                key={a.kind}
                className="text-left rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 hover:border-amber-500/50 transition-colors space-y-2"
                onClick={() => { setSelectedAutomation(a); setView('automation'); }}
              >
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-400 shrink-0" />
                  <span className="font-medium text-sm">{a.label}</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-3">{a.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading workflows...
        </div>
      )}

      {!loading && workflows.length === 0 && teamWorkflows.length === 0 && (
        <div className="space-y-6">
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Zap className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-base font-medium">No workflows yet</p>
            <p className="text-sm mt-1 text-center max-w-md">
              Describe what you want to automate in plain English, pick a team recipe, or use a template.
            </p>
            <Button size="sm" className="mt-4" onClick={() => { setSelectedTemplate(null); setSelectedRecipe(null); setView('create'); }} data-track="workflows.describe_your_own" data-track-category="action">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Describe Your Own
            </Button>
          </div>

          {recipes.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <BookOpen className="h-4 w-4" /> Team Recipes
              </h2>
              <RecipeGallery recipes={recipes} onSelect={(r) => { setSelectedRecipe(r); setSelectedTemplate(null); setView('create'); }} onDelete={handleDeleteRecipe} />
            </div>
          )}

          {templates.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-3">Quick Start Templates</h2>
              <WorkflowTemplateGallery
                templates={templates}
                onSelect={(t) => { setSelectedTemplate(t); setSelectedRecipe(null); setView('create'); }}
              />
            </div>
          )}
        </div>
      )}

      {!loading && (workflows.length > 0 || teamWorkflows.length > 0) && (
        <>
          {/* Section 1: My Workflows (personal) */}
          {workflows.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-3">My Workflows</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {workflows.map((wf) => (
                  <button
                    key={wf.id}
                    className="text-left rounded-lg border p-4 hover:border-primary transition-colors space-y-2"
                    onClick={() => { setSelectedWorkflowId(wf.id); setView('detail'); }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm truncate">{wf.name}</span>
                      <span
                        className="shrink-0 cursor-pointer"
                        onClick={(e) => handleToggle(e, wf)}
                      >
                        {wf.enabled
                          ? <ToggleRight className="h-5 w-5 text-green-500" />
                          : <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                        }
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                        {wf.type}
                      </span>
                      <Clock className="h-3 w-3" />
                      <span>{cronToHuman(wf.cronExpression)}</span>
                    </div>
                    {wf.lastRunAt && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {wf.recentRuns?.[0]?.status === 'completed'
                          ? <CheckCircle2 className="h-3 w-3 text-green-500" />
                          : wf.recentRuns?.[0]?.status === 'failed'
                            ? <XCircle className="h-3 w-3 text-red-500" />
                            : <Clock className="h-3 w-3" />
                        }
                        Last: {new Date(wf.lastRunAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Section 2: Team Workflows (shared execution) */}
          {teamWorkflows.length > 0 && (
            <div className={workflows.length > 0 ? 'pt-4 border-t' : ''}>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <Users className="h-4 w-4 text-purple-400" /> Team Workflows
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {teamWorkflows.map((wf) => (
                  <div
                    key={wf.id}
                    className="text-left rounded-lg border border-purple-500/20 bg-purple-500/5 p-4 hover:border-purple-500/50 transition-colors space-y-2 cursor-pointer"
                    onClick={() => { setSelectedWorkflowId(wf.id); setView('detail'); }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm truncate">{wf.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {wf.isDistribution && (
                          <button
                            className="p-1 rounded hover:bg-purple-500/20 transition-colors"
                            title={wf.isSubscribed ? 'Unsubscribe' : 'Subscribe'}
                            onClick={(e) => handleSubscribe(e, wf)}
                          >
                            {wf.isSubscribed
                              ? <Bell className="h-4 w-4 text-purple-400" />
                              : <BellOff className="h-4 w-4 text-muted-foreground" />
                            }
                          </button>
                        )}
                        <span
                          className="cursor-pointer"
                          onClick={(e) => handleToggle(e, wf)}
                        >
                          {wf.enabled
                            ? <ToggleRight className="h-5 w-5 text-green-500" />
                            : <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                          }
                        </span>
                      </div>
                    </div>
                    {wf.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{wf.description}</p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                        {wf.type}
                      </span>
                      {wf.isDistribution && (
                        <span className="inline-flex items-center rounded-full bg-purple-500/10 px-1.5 py-0.5 text-xs font-medium text-purple-400">
                          <Mail className="h-3 w-3 mr-0.5" /> Distribution
                        </span>
                      )}
                      <Clock className="h-3 w-3" />
                      <span>{cronToHuman(wf.cronExpression)}</span>
                      {wf.isDistribution && (
                        <>
                          <Users className="h-3 w-3 ml-1" />
                          <span>{wf.subscriberCount ?? 0} subscribed</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {wf.ownerName && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" /> {wf.ownerName}
                        </span>
                      )}
                      {wf.lastClaimedBy && (
                        <span className="flex items-center gap-1">
                          <Monitor className="h-3 w-3" /> {wf.lastClaimedBy}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 3: Team Recipes */}
          {recipes.length > 0 && (
            <div className="pt-4 border-t">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <BookOpen className="h-4 w-4" /> Team Recipes
              </h2>
              <RecipeGallery recipes={recipes} onSelect={(r) => { setSelectedRecipe(r); setSelectedTemplate(null); setView('create'); }} onDelete={handleDeleteRecipe} />
            </div>
          )}

          {templates.length > 0 && (
            <div className="pt-4 border-t">
              <h2 className="text-sm font-semibold mb-3">Templates</h2>
              <WorkflowTemplateGallery
                templates={templates}
                onSelect={(t) => { setSelectedTemplate(t); setSelectedRecipe(null); setView('create'); }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecipeGallery({ recipes, onSelect, onDelete }: { recipes: WorkflowRecipe[]; onSelect: (r: WorkflowRecipe) => void; onDelete: (r: WorkflowRecipe) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {recipes.map((r) => (
        <div
          key={r.id}
          className="text-left rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 hover:border-blue-500/50 transition-colors space-y-2 cursor-pointer"
          onClick={() => onSelect(r)}
        >
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-blue-400 shrink-0" />
            <span className="font-medium text-sm truncate flex-1">{r.name}</span>
            <button
              className="shrink-0 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
              title="Delete recipe"
              onClick={(e) => { e.stopPropagation(); onDelete(r); }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{r.description}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
              {r.type}
            </span>
            {r.requiresCredential && (
              <span className="inline-flex items-center gap-0.5 text-xs text-amber-400">
                <Key className="h-3 w-3" /> Login required
              </span>
            )}
            {r.author && (
              <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                <User className="h-3 w-3" /> {r.author}
              </span>
            )}
            {r.tags && (
              <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                <Tag className="h-3 w-3" /> {r.tags}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
