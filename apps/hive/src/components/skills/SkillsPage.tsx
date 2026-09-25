import { useEffect, useState } from 'react';
import { Wand2, Plus, Loader2, Pencil, Trash2, Globe, ArrowLeft, Save, CheckCircle2, Share2, CheckSquare, Square, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import CommunityBrowser from '@/components/shared/CommunityBrowser';
import TeamItemsSection from '@/components/shared/TeamItemsSection';
import AISessionButton from '@/components/shared/AISessionButton';
import { skillEdit } from '@/lib/prompt-templates';
import { resolveDefaultProjectDir } from '@/lib/project-mappings';
import { getPrimaryProviderId, getProviderStatus, PROVIDER_SHORT_NAMES, type ProviderId, type ProviderStatus } from '@/lib/launch-flags';

import { API_BASE } from '@/lib/api-config';

interface SkillInfo {
  name: string;
  description: string;
  triggers: string[];
  lastModified: string;
  content: string;
}

/* ---------- Skill Editor (inline) ---------- */

function SkillEditor({
  skill,
  onClose,
  onSaved,
}: {
  skill?: SkillInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !skill;
  const [dirName, setDirName] = useState(skill?.name ?? '');
  const [content, setContent] = useState(
    skill?.content ?? '# Skill Name\n\nDescribe what this skill does and when it should be triggered.\n',
  );
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');

  async function handleSave() {
    setError('');
    if (!dirName.trim()) {
      setError('Skill name is required');
      return;
    }

    setSaveStatus('saving');
    try {
      const res = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(dirName.trim())}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setSaveStatus('saved');
        setTimeout(() => onSaved(), 500);
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Failed to save');
        setSaveStatus('idle');
      }
    } catch {
      setError('Network error');
      setSaveStatus('idle');
    }
  }

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="h-4 w-px bg-border" />
          <span className="text-sm font-medium text-foreground">
            {isNew ? 'New Skill' : skill.name}
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={saveStatus === 'saving'}
          className="gap-1.5"
        >
          {saveStatus === 'saving' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : saveStatus === 'saved' ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save
        </Button>
      </div>

      {isNew && (
        <div>
          <label className="text-sm font-medium text-foreground">Directory Name</label>
          <input
            type="text"
            value={dirName}
            onChange={(e) => setDirName(e.target.value)}
            placeholder="my-skill"
            className="mt-1 w-full max-w-xs rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Creates <code className="bg-secondary px-1 rounded">~/.claude/skills/{dirName || '<name>'}/skill.md</code>
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="flex-1 min-h-[300px] rounded-md border border-border bg-background px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
      />
    </div>
  );
}

/* ---------- Skills Page ---------- */

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SkillInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [projectDir, setProjectDir] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; removed: number; providers: string[] } | null>(null);
  const [syncingToTeam, setSyncingToTeam] = useState(false);
  const [syncToTeamResult, setSyncToTeamResult] = useState<{ total: number; succeeded: number } | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('claude');
  const [enabledProviders, setEnabledProviders] = useState<ProviderStatus[]>([]);

  async function handleSyncToTeam() {
    setSyncingToTeam(true);
    setSyncToTeamResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/sharing/sync-to-team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'skill' }),
      });
      if (res.ok) {
        const data = await res.json() as { results: Array<{ ok: boolean }>; total: number };
        const succeeded = data.results.filter(r => r.ok).length;
        setSyncToTeamResult({ total: data.total, succeeded });
        setTimeout(() => setSyncToTeamResult(null), 5000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSyncingToTeam(false);
    }
  }

  async function handleSyncAll() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/skills/sync-all`, { method: 'POST' });
      const data = await res.json();
      setSyncResult(data);
      setTimeout(() => setSyncResult(null), 5000);
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    resolveDefaultProjectDir().then(setProjectDir);
    Promise.all([getPrimaryProviderId(), getProviderStatus()]).then(([primaryId, statuses]) => {
      setSelectedProvider(primaryId);
      setEnabledProviders(statuses.filter(s => s.enabled && s.installed));
    });
  }, []);

  function fetchSkills(provider?: ProviderId) {
    const pid = provider ?? selectedProvider;
    fetch(`${API_BASE}/api/skills?provider=${pid}`)
      .then((r) => r.json())
      .then((data: SkillInfo[]) => setSkills(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchSkills(selectedProvider);
  }, [selectedProvider]);

  async function handleDelete(name: string) {
    if (!confirm(`Delete skill "${name}"?`)) return;
    try {
      await fetch(`${API_BASE}/api/skills/${encodeURIComponent(name)}?provider=${selectedProvider}`, { method: 'DELETE' });
      fetchSkills();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleShare(name: string) {
    try {
      const res = await fetch(`${API_BASE}/api/sharing/publish-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'skill', name }),
      });
      if (res.ok) {
        alert(`Skill "${name}" shared with team!`);
      } else {
        const data = await res.json() as { error?: string };
        alert(data.error ?? 'Failed to share');
      }
    } catch {
      alert('Network error');
    }
  }

  function toggleSelect(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === skills.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(skills.map((s) => s.name)));
    }
  }

  async function handleShareSelected() {
    if (selected.size === 0) return;
    setSharing(true);
    try {
      const items = Array.from(selected).map((name) => ({
        type: 'skill' as const,
        name,
      }));
      const res = await fetch(`${API_BASE}/api/sharing/publish-local-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        const data = await res.json() as { results: Array<{ name: string; ok: boolean; error?: string }> };
        const succeeded = data.results.filter((r) => r.ok).length;
        const failed = data.results.filter((r) => !r.ok);
        let msg = `${succeeded} skill(s) shared with team!`;
        if (failed.length > 0) {
          msg += `\n${failed.length} failed: ${failed.map((f) => `${f.name}: ${f.error}`).join(', ')}`;
        }
        alert(msg);
        setSelected(new Set());
      } else {
        const data = await res.json() as { error?: string };
        alert(data.error ?? 'Failed to share');
      }
    } catch {
      alert('Network error');
    } finally {
      setSharing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (editing || creating) {
    return (
      <SkillEditor
        skill={editing ?? undefined}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSaved={() => {
          setEditing(null);
          setCreating(false);
          fetchSkills();
        }}
      />
    );
  }

  const allSelected = skills.length > 0 && selected.size === skills.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Skills</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage {selectedProvider === 'gemini' ? 'custom commands' : 'custom skills'} for {enabledProviders.find(p => p.id === selectedProvider)?.displayName ?? selectedProvider}
            </p>
          </div>
          {enabledProviders.length > 1 && (
            <div className="flex items-center gap-1 ml-2">
              {enabledProviders.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setSelectedProvider(p.id); setSelected(new Set()); }}
                  className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                    selectedProvider === p.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                  title={p.displayName}
                >
                  {PROVIDER_SHORT_NAMES[p.id]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleSyncToTeam()}
            disabled={syncingToTeam}
            className="gap-1.5"
            title="Push local changes for your shared skills to the team database"
          >
            <Upload className={`h-3.5 w-3.5 ${syncingToTeam ? 'animate-pulse' : ''}`} />
            {syncingToTeam ? 'Syncing...' : 'Sync to Team'}
          </Button>
          {syncToTeamResult && (
            <span className="text-xs text-green-500">
              {syncToTeamResult.succeeded}/{syncToTeamResult.total} synced
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleSyncAll}
            disabled={syncing}
            className="gap-1.5"
            title="Sync all skills to enabled AI providers (Gemini, Codex)"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync to Providers'}
          </Button>
          {syncResult && syncResult.providers.length > 0 && (
            <span className="text-xs text-green-500">
              {syncResult.synced} synced to {syncResult.providers.join(', ')}
              {syncResult.removed > 0 && `, ${syncResult.removed} orphans removed`}
            </span>
          )}
          {syncResult && syncResult.providers.length === 0 && (
            <span className="text-xs text-muted-foreground">No other providers enabled</span>
          )}
          <Button size="sm" variant="outline" onClick={() => setBrowsing(true)} className="gap-1.5">
            <Globe className="h-3.5 w-3.5" />
            Browse Community
          </Button>
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Skill
          </Button>
        </div>
      </div>

      {skills.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Wand2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No skills found</p>
          <p className="text-xs mt-1">
            Create skill directories in{' '}
            No {selectedProvider === 'gemini' ? 'commands' : 'skills'} found for {enabledProviders.find(p => p.id === selectedProvider)?.displayName ?? selectedProvider}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4 gap-1.5"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Create Skill
          </Button>
        </div>
      ) : (
        <>
          {/* Selection toolbar */}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-7"
              onClick={toggleSelectAll}
            >
              {allSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {allSelected ? 'Deselect All' : 'Select All'}
            </Button>
            {selected.size > 0 && (
              <Button
                size="sm"
                className="gap-1.5 text-xs h-7"
                onClick={() => void handleShareSelected()}
                disabled={sharing}
              >
                {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                Share {selected.size} Selected
              </Button>
            )}
            {selected.size > 0 && (
              <span className="text-xs text-muted-foreground">{selected.size} of {skills.length} selected</span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {skills.map((skill) => {
              const isSelected = selected.has(skill.name);
              return (
                <Card
                  key={skill.name}
                  className={`hover:border-primary/30 transition-colors cursor-pointer ${isSelected ? 'border-primary/50 bg-primary/5' : ''}`}
                  onClick={() => toggleSelect(skill.name)}
                >
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="shrink-0" onClick={(e) => { e.stopPropagation(); toggleSelect(skill.name); }}>
                          {isSelected
                            ? <CheckSquare className="h-4 w-4 text-primary" />
                            : <Square className="h-4 w-4 text-muted-foreground" />
                          }
                        </div>
                        <Wand2 className="h-4 w-4 text-primary shrink-0" />
                        <h3 className="text-sm font-medium text-foreground truncate">{skill.name}</h3>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0 ml-2">
                        skill.md
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {skill.description || 'No description'}
                    </p>

                    {skill.triggers.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {skill.triggers.map((trigger) => (
                          <Badge key={trigger} variant="secondary" className="text-[10px]">
                            {trigger}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                      <AISessionButton
                        cwd={projectDir}
                        prompt={skillEdit(skill.name, skill.content)}
                        variant="icon-only"
                        size="icon"
                        tooltip="Edit Skill in AI"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 gap-1"
                        onClick={() => setEditing(skill)}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 gap-1 text-red-400 hover:text-red-300"
                        onClick={() => void handleDelete(skill.name)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 gap-1"
                        onClick={() => void handleShare(skill.name)}
                      >
                        <Share2 className="h-3 w-3" />
                        Share
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <CommunityBrowser
        type="skills"
        open={browsing}
        onClose={() => setBrowsing(false)}
        onInstall={() => fetchSkills()}
      />

      {/* Team Skills */}
      <div className="border-t border-border pt-6">
        <TeamItemsSection itemType="skill" onInstall={fetchSkills} />
      </div>
    </div>
  );
}
