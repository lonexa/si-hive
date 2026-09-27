import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderOpen, Plus, Loader2, Search, ArrowUpDown, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ProjectCard from './ProjectCard';
import NewProjectDialog from './NewProjectDialog';
import { getPrimaryProviderId, getProviderStatus, PROVIDER_SHORT_NAMES, type ProviderId, type ProviderStatus } from '@/lib/launch-flags';

import { API_BASE } from '@/lib/api-config';

export interface ProjectInfo {
  name: string;
  path: string;
  encodedDir?: string;
  hasCLAUDEmd: boolean;
  hasGit: boolean;
  gitBranch?: string;
  sessionCount: number;
  totalSessions: number;
  lastActivity?: string;
  instructionFiles?: { claude: boolean; gemini: boolean; codex: boolean };
}

type SortField = 'recent' | 'name' | 'sessions' | 'active';
type SortDir = 'asc' | 'desc';

const SORT_OPTIONS: { value: SortField; label: string; defaultDir: SortDir }[] = [
  { value: 'recent', label: 'Recent', defaultDir: 'desc' },
  { value: 'name', label: 'Name', defaultDir: 'asc' },
  { value: 'sessions', label: 'Total Sessions', defaultDir: 'desc' },
  { value: 'active', label: 'Active Sessions', defaultDir: 'desc' },
];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('recent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('claude');
  const [enabledProviders, setEnabledProviders] = useState<ProviderStatus[]>([]);

  async function handleSyncInstructions() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/instructions/sync-all`, { method: 'POST' });
      const data = await res.json();
      if (data.filesCreated > 0) {
        setSyncResult(`Created ${data.filesCreated} instruction files across ${data.details.length} projects`);
        fetchProjects(); // refresh project list to update badges
      } else {
        setSyncResult('All projects already have instruction files for all providers');
      }
      setTimeout(() => setSyncResult(null), 6000);
    } catch {
      setSyncResult('Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setShowNew(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  function fetchProjects() {
    fetch(`${API_BASE}/api/projects`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: ProjectInfo[]) => setProjects(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchProjects();
    Promise.all([getPrimaryProviderId(), getProviderStatus()]).then(([primaryId, statuses]) => {
      setSelectedProvider(primaryId);
      setEnabledProviders(statuses.filter(s => s.enabled && s.installed));
    });
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let result = projects;

    if (q) {
      result = projects.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.path.toLowerCase().includes(q) ||
          (p.gitBranch && p.gitBranch.toLowerCase().includes(q))
      );
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    result = [...result].sort((a, b) => {
      switch (sortField) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'sessions':
          return dir * (a.totalSessions - b.totalSessions);
        case 'active':
          return dir * (a.sessionCount - b.sessionCount);
        case 'recent':
        default: {
          if (a.lastActivity && b.lastActivity)
            return dir * a.lastActivity.localeCompare(b.lastActivity);
          if (a.lastActivity) return -1;
          if (b.lastActivity) return 1;
          return a.name.localeCompare(b.name);
        }
      }
    });

    return result;
  }, [projects, search, sortField, sortDir]);

  function handleSortClick(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(SORT_OPTIONS.find((o) => o.value === field)!.defaultDir);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Projects</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {filtered.length === projects.length
                ? `${projects.length} project${projects.length !== 1 ? 's' : ''}`
                : `${filtered.length} of ${projects.length} projects`}
            </p>
          </div>
          {enabledProviders.length > 1 && (
            <div className="flex items-center gap-1 ml-2">
              {enabledProviders.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProvider(p.id)}
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
            onClick={() => void handleSyncInstructions()}
            disabled={syncing}
            className="gap-1.5"
            title="Copy instruction files (CLAUDE.md → GEMINI.md + AGENTS.md) to all projects that are missing them"
            data-track="projects.sync_instructions"
            data-track-category="action"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Instructions'}
          </Button>
          {syncResult && <span className="text-xs text-green-500">{syncResult}</span>}
          <Button
            size="sm"
            onClick={() => setShowNew(true)}
            className="gap-1.5"
            data-track="projects.new_project"
            data-track-category="modal"
          >
            <Plus className="h-3.5 w-3.5" />
            New Project
          </Button>
        </div>
      </div>

      {projects.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-1">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground mr-1" />
            {SORT_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant={sortField === opt.value ? 'secondary' : 'ghost'}
                className="text-xs h-7 px-2 gap-1"
                onClick={() => handleSortClick(opt.value)}
              >
                {opt.label}
                {sortField === opt.value &&
                  (sortDir === 'asc' ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  ))}
              </Button>
            ))}
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No projects found</p>
          <p className="text-xs mt-1">No AI projects found in ~/.claude/projects</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4 gap-1.5"
            onClick={() => setShowNew(true)}
            data-track="projects.create_project_empty"
            data-track-category="modal"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Project
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Search className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No projects match "{search}"</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <ProjectCard key={p.path} project={p} selectedProvider={selectedProvider} onRemoved={fetchProjects} />
          ))}
        </div>
      )}

      <NewProjectDialog
        open={showNew}
        onOpenChange={setShowNew}
        onCreated={() => {
          setShowNew(false);
          fetchProjects();
        }}
      />
    </div>
  );
}
