import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, EyeOff, FileText, FolderOpen, GitBranch, Monitor, Plus, Search, Trash2 } from 'lucide-react';
import { cn, timeAgo } from '@/lib/utils';
import { useIncognito } from '@/hooks/useIncognito';
import NewProjectDialog from '@/components/projects/NewProjectDialog';
import RemoveProjectDialog from '@/components/projects/RemoveProjectDialog';
import { Compat, EmptyState, Segmented } from './components';
import { byRecent, useProjects, type ProjectInfo } from './use-projects';

const GitChangesTab = lazy(() => import('@/components/projects/GitChangesTab'));
const DependenciesTab = lazy(() => import('@/components/projects/DependenciesTab'));

const TABS = [
  { value: 'browse', label: 'Projects' },
  { value: 'git-changes', label: 'Git changes' },
  { value: 'dependencies', label: 'Dependencies' },
] as const;

type Sort = 'recent' | 'name' | 'active';

function ProjectRow({ project, open, onToggle, onRemoved }: {
  project: ProjectInfo;
  open: boolean;
  onToggle: () => void;
  onRemoved: () => void;
}) {
  const [removeOpen, setRemoveOpen] = useState(false);
  const { canToggle, busy, isProjectIncognito, toggleProject } = useIncognito();
  const incognito = isProjectIncognito(project.path);
  const encoded = encodeURIComponent(project.path);

  return (
    <div>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 px-3 py-2.5 text-left active:bg-accent">
        <FolderOpen className="mt-0.5 h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{project.name}</span>
            {project.lastActivity && <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(project.lastActivity)}</span>}
          </div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {project.hasGit && (
              <span className="flex min-w-0 items-center gap-1 truncate">
                <GitBranch className="h-3 w-3 shrink-0" />
                <span className="truncate">{project.gitBranch || 'git'}</span>
              </span>
            )}
            {project.sessionCount > 0 && (
              <span className="flex shrink-0 items-center gap-1 text-status-green">
                <Monitor className="h-3 w-3" /> {project.sessionCount} live
              </span>
            )}
            {project.totalSessions > 0 && <span className="shrink-0">{project.totalSessions} total</span>}
            {incognito && <EyeOff className="h-3 w-3 shrink-0 text-violet-400" />}
          </div>
        </div>
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3 pl-[2.6rem]">
          <p className="break-all font-mono text-[11px] text-muted-foreground">{project.path}</p>
          <div className="grid grid-cols-3 gap-1.5">
            <Link
              to={`/new?cwd=${encoded}`}
              className="flex h-10 items-center justify-center gap-1 rounded-lg bg-primary text-xs font-medium text-primary-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> Session
            </Link>
            <Link
              to={`/sessions?project=${encoded}`}
              className="flex h-10 items-center justify-center gap-1 rounded-lg border border-border text-xs text-foreground"
            >
              <Monitor className="h-3.5 w-3.5" /> History
            </Link>
            <Link
              to={`/projects/${encoded}/claude-md`}
              className="flex h-10 items-center justify-center gap-1 rounded-lg border border-border text-xs text-foreground"
            >
              <FileText className="h-3.5 w-3.5" /> Instructions
            </Link>
          </div>
          {canToggle && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggleProject(project.path, !incognito)}
              className={cn('flex items-center gap-1.5 text-xs', incognito ? 'text-violet-300' : 'text-muted-foreground')}
            >
              <EyeOff className="h-3.5 w-3.5" />
              {incognito ? 'Incognito project — turn off' : 'Mark project incognito'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setRemoveOpen(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground active:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove project
          </button>
        </div>
      )}
      <RemoveProjectDialog project={project} open={removeOpen} onOpenChange={setRemoveOpen} onRemoved={onRemoved} />
    </div>
  );
}

function ProjectList() {
  const { projects, loading, refresh } = useProjects();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showNew, setShowNew] = useState(searchParams.get('new') === 'true');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.gitBranch?.toLowerCase().includes(q))
      : projects;
    return [...filtered].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'active' ? b.sessionCount - a.sessionCount || byRecent(a, b)
          : byRecent(a, b),
    );
  }, [projects, query, sort]);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${projects.length} projects`}
            className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-3 text-base text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="h-10 shrink-0 rounded-full border border-border bg-card px-3 text-sm text-foreground"
          aria-label="Sort"
        >
          <option value="recent">Recent</option>
          <option value="name">Name</option>
          <option value="active">Live</option>
        </select>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          aria-label="New project"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      {loading ? null : list.length === 0 ? (
        <EmptyState icon={FolderOpen} title={query ? `No projects match "${query}"` : 'No projects yet'} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
          {list.map((p) => (
            <ProjectRow
              key={p.path}
              project={p}
              open={openPath === p.path}
              onToggle={() => setOpenPath(openPath === p.path ? null : p.path)}
              onRemoved={refresh}
            />
          ))}
        </div>
      )}

      <NewProjectDialog
        open={showNew}
        onOpenChange={(open) => {
          setShowNew(open);
          if (!open && searchParams.has('new')) setSearchParams({}, { replace: true });
        }}
        onCreated={() => {
          setShowNew(false);
          refresh();
        }}
      />
    </div>
  );
}

export default function MobileProjectsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'browse';

  return (
    <div className="space-y-3">
      <Segmented options={TABS} value={tab} onChange={(v) => setSearchParams(v === 'browse' ? {} : { tab: v }, { replace: true })} />
      <Suspense fallback={null}>
        {tab === 'browse' ? <ProjectList /> : <Compat>{tab === 'dependencies' ? <DependenciesTab /> : <GitChangesTab />}</Compat>}
      </Suspense>
    </div>
  );
}
