import { useState, useEffect, useCallback } from 'react';
import { Trash2, GraduationCap, FolderGit2, Tag } from 'lucide-react';
import { API_BASE } from '@/lib/api-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

// ── Types ─────────────────────────────────────────────────────────────

type ContextType = 'repo' | 'topic';

interface SkillRequirement {
  id: number;
  contextType: ContextType;
  contextKey: string;        // repo: normalized origin URL; topic: slug
  contextLabel: string | null;
  keywords: string | null;
  skillName: string;
  required: boolean;
  createdBy: string | null;
  createdAt: string;
}

interface ProjectInfo {
  name: string;
  path: string;
}

interface SharedSkill {
  id: number;
  name: string;
  description: string;
}

const inputClass =
  'h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground';

export default function SkillRequirementsPage() {
  const [requirements, setRequirements] = useState<SkillRequirement[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [skills, setSkills] = useState<SharedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Add-form state
  const [contextType, setContextType] = useState<ContextType>('repo');
  const [projectPath, setProjectPath] = useState('');
  const [remotePreview, setRemotePreview] = useState<string | null | undefined>(undefined); // undefined=unknown, null=none
  const [topicLabel, setTopicLabel] = useState('');
  const [keywords, setKeywords] = useState('');
  const [skillName, setSkillName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchRequirements = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/skill-requirements`, { credentials: 'include' });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        throw new Error(`Unexpected response (HTTP ${res.status}). Try a hard refresh (Ctrl+Shift+R).`);
      }
      const data = (await res.json()) as { requirements?: SkillRequirement[]; warning?: string; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRequirements(data.requirements || []);
      setWarning(data.warning ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load requirements');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRequirements();
    fetch(`${API_BASE}/api/projects`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data: ProjectInfo[]) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setProjects([]));
    fetch(`${API_BASE}/api/sharing/items?type=skill`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data: SharedSkill[]) => setSkills(Array.isArray(data) ? data : []))
      .catch(() => setSkills([]));
  }, [fetchRequirements]);

  // Preview the resolved git origin when a project is chosen.
  useEffect(() => {
    if (contextType !== 'repo' || !projectPath) {
      setRemotePreview(undefined);
      return;
    }
    let cancelled = false;
    setRemotePreview(undefined);
    fetch(`${API_BASE}/api/admin/skill-requirements/repo-remote?path=${encodeURIComponent(projectPath)}`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d: { normalized?: string | null }) => {
        if (!cancelled) setRemotePreview(d.normalized ?? null);
      })
      .catch(() => {
        if (!cancelled) setRemotePreview(null);
      });
    return () => { cancelled = true; };
  }, [contextType, projectPath]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!skillName) {
      setError('Pick a skill.');
      return;
    }
    const body =
      contextType === 'repo'
        ? { contextType, projectPath, repoLabel: projects.find((p) => p.path === projectPath)?.name, skillName }
        : { contextType, label: topicLabel, keywords, skillName };

    if (contextType === 'repo' && !projectPath) { setError('Pick a project.'); return; }
    if (contextType === 'topic' && (!topicLabel.trim() || !keywords.trim())) {
      setError('Topic needs a label and at least one keyword.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/skill-requirements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSkillName('');
      setTopicLabel('');
      setKeywords('');
      await fetchRequirements();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add requirement');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await fetch(`${API_BASE}/api/admin/skill-requirements/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setRequirements((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  // Group requirements by context for display.
  const groups = new Map<string, { type: ContextType; key: string; label: string; keywords: string | null; rows: SkillRequirement[] }>();
  for (const r of requirements) {
    const gkey = `${r.contextType}:${r.contextKey}`;
    if (!groups.has(gkey)) {
      groups.set(gkey, {
        type: r.contextType,
        key: r.contextKey,
        label: r.contextLabel || r.contextKey,
        keywords: r.keywords,
        rows: [],
      });
    }
    groups.get(gkey)!.rows.push(r);
  }
  const groupList = [...groups.values()].sort((a, b) =>
    a.type === b.type ? a.label.localeCompare(b.label) : a.type.localeCompare(b.type)
  );

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <GraduationCap className="h-5 w-5" />
          Skill Requirements
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Require a team-approved skill for a repo (matched by its git remote) or a topic
          (matched by keywords in a user's prompts). When a user works a session that matches,
          SI Hive auto-installs the required skill and shows a banner.
        </p>
      </div>

      {warning && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          {warning}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Add form */}
      <form onSubmit={handleAdd} className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="text-sm font-medium text-foreground">Add a requirement</div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={contextType}
            onChange={(e) => setContextType(e.target.value as ContextType)}
            className={inputClass}
          >
            <option value="repo">Repo (by remote)</option>
            <option value="topic">Topic (by keywords)</option>
          </select>

          {contextType === 'repo' ? (
            <select value={projectPath} onChange={(e) => setProjectPath(e.target.value)} className={inputClass}>
              <option value="">Select a project…</option>
              {projects.map((p) => (
                <option key={p.path} value={p.path}>{p.name}</option>
              ))}
            </select>
          ) : (
            <>
              <Input
                value={topicLabel}
                onChange={(e) => setTopicLabel(e.target.value)}
                placeholder="Topic name (e.g. Billing DB)"
                className="h-9 w-48"
              />
              <Input
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="keywords, comma-separated"
                className="h-9 w-64"
              />
            </>
          )}

          <select value={skillName} onChange={(e) => setSkillName(e.target.value)} className={inputClass}>
            <option value="">Select the approved skill…</option>
            {skills.map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add'}
          </Button>
        </div>

        {contextType === 'repo' && projectPath && (
          <p className="text-xs text-muted-foreground">
            {remotePreview === undefined
              ? 'Resolving git remote…'
              : remotePreview === null
                ? '⚠ No git origin found for this project — pick a project with a remote.'
                : <>Will match remote: <span className="font-mono text-foreground">{remotePreview}</span></>}
          </p>
        )}
        {contextType === 'topic' && (
          <p className="text-xs text-muted-foreground">
            Keywords are matched case-insensitively against the user's prompts (e.g. “billing database”, “invoices table”).
          </p>
        )}
        {skills.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No team skills found. Publish the approved skills via the Sharing/Knowledge page first.
          </p>
        )}
      </form>

      {/* Existing requirements grouped by context */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : groupList.length === 0 ? (
        <div className="text-sm text-muted-foreground">No requirements configured yet.</div>
      ) : (
        <div className="space-y-4">
          {groupList.map((g) => (
            <div key={`${g.type}:${g.key}`} className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                {g.type === 'repo' ? (
                  <FolderGit2 className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Tag className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium text-foreground">{g.label}</span>
                <Badge variant="secondary" className="text-[10px]">{g.type}</Badge>
              </div>
              {g.type === 'repo' ? (
                <div className="mb-2 font-mono text-xs text-muted-foreground">{g.key}</div>
              ) : (
                <div className="mb-2 flex flex-wrap gap-1">
                  {(g.keywords || '').split(',').filter(Boolean).map((kw) => (
                    <span key={kw} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {kw}
                    </span>
                  ))}
                </div>
              )}
              <ul className="space-y-1">
                {g.rows.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-accent/50"
                  >
                    <span className="font-mono text-foreground">{r.skillName}</span>
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Remove requirement"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
