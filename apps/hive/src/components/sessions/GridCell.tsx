import { useState, useMemo, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn, sessionStatusLabel, timeAgo, getSessionDisplayName, shortProject } from '@/lib/utils';
import { getLaunchFlags, getPrimaryProviderId, getProviderStatus, PROVIDER_SHORT_NAMES, buildResumeArgs, buildProviderFlags, formatModelDisplay, type ProviderId, type ProviderStatus } from '@/lib/launch-flags';
import { Terminal, X, Replace, Search, GitBranch, Maximize2, Minimize2, FolderOpen, Monitor, Plus, Star, StarOff, FileText, MoreVertical, ArrowRightLeft, Eye } from 'lucide-react';
import TerminalView from './TerminalView';
import TranscriptViewer from './TranscriptViewer';
import PersonaSelector from './PersonaSelector';
import ProviderPicker from '@hive/shared/components/ProviderPicker';
import PathInsertMenu from '@/components/shared/PathInsertMenu';
import { getTabId } from '@/lib/tab-id';
import type { Session } from '@/stores/types';
import type { GridCell as GridCellData } from '@/stores/dashboard-store';

import { API_BASE } from '@/lib/api-config';

interface ProjectInfo {
  name: string;
  path: string;
  hasGit: boolean;
  gitBranch?: string;
  sessionCount: number;
  totalSessions: number;
  lastActivity?: string;
}

interface GridCellProps {
  cellId: string;
  sessionId: string | null;
  cell: GridCellData;
  sessions: Session[];
  availableSessions: Session[];
  maximized: boolean;
  canClose: boolean;
  onSelectSession: (sessionId: string) => void;
  onSelectProject: (projectPath: string) => void;
  onNewSession: (providerId?: ProviderId) => void;
  onReviewWithAI?: (cwd: string, providerId: ProviderId) => void;
  onMaximize: () => void;
  onRestore: () => void;
  onRemove: () => void;
}

function statusDotColor(status: Session['status']): string {
  switch (status) {
    case 'working': return 'bg-status-green';
    case 'done': return 'bg-status-done';
    case 'waiting-input':
    case 'waiting-approval': return 'bg-status-yellow';
    case 'error': return 'bg-status-red';
    default: return 'bg-status-gray';
  }
}

function shortModel(model?: string, provider?: ProviderId): string | null {
  if (!model) return null;
  return formatModelDisplay(provider, model);
}

// ─── Combined Picker: Sessions + Projects tabs ───

type PickerTab = 'sessions' | 'projects';

function CombinedPicker({ sessions, onSelectSession, onSelectProject, onNewSession, label }: {
  sessions: Session[];
  onSelectSession: (id: string) => void;
  onSelectProject: (path: string) => void;
  onNewSession?: (providerId?: ProviderId) => void;
  label: string;
}) {
  const [tab, setTab] = useState<PickerTab>('sessions');
  const [search, setSearch] = useState('');
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('claude');
  const [enabledProviders, setEnabledProviders] = useState<ProviderStatus[]>([]);

  useEffect(() => {
    getProviderStatus().then((statuses) => {
      setEnabledProviders(statuses);
      getPrimaryProviderId().then((primary) => setSelectedProvider(primary));
    });
  }, []);

  useEffect(() => {
    if (tab === 'projects' && projects.length === 0) {
      setLoadingProjects(true);
      fetch(`${API_BASE}/api/projects`)
        .then(r => r.json())
        .then((data: ProjectInfo[]) => setProjects(data))
        .catch(() => {})
        .finally(() => setLoadingProjects(false));
    }
  }, [tab]);

  const filteredSessions = useMemo(() => {
    const list = search
      ? sessions.filter(s => {
          const q = search.toLowerCase();
          return (s.initialPrompt?.toLowerCase().includes(q))
            || s.project.toLowerCase().includes(q)
            || s.id.toLowerCase().includes(q)
            || (s.gitBranch?.toLowerCase().includes(q));
        })
      : sessions;
    return [...list].sort((a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );
  }, [sessions, search]);

  const filteredProjects = useMemo(() => {
    if (!search) return projects;
    const q = search.toLowerCase();
    return projects.filter(p =>
      p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
    );
  }, [projects, search]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2 border-b border-zinc-800">
        <p className="text-xs text-zinc-400 mb-2">{label}</p>
        {/* New AI Session button with provider picker */}
        {onNewSession && (
          <div className="flex items-center gap-1.5 mb-2">
            <button
              onClick={() => onNewSession(selectedProvider)}
              className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md bg-blue-600/20 border border-blue-600/40 hover:bg-blue-600/30 transition-colors text-blue-400 text-xs font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              New Session
            </button>
            {enabledProviders.length > 1 && (
              <ProviderPicker
                value={selectedProvider}
                onChange={setSelectedProvider}
                enabledProviders={enabledProviders}
                size="sm"
              />
            )}
          </div>
        )}
        {/* Tab switcher */}
        <div className="flex gap-1 mb-2">
          <button
            onClick={() => setTab('sessions')}
            className={cn(
              'flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors',
              tab === 'sessions' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            <Monitor className="h-3 w-3" />
            Sessions
          </button>
          <button
            onClick={() => setTab('projects')}
            className={cn(
              'flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors',
              tab === 'projects' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            <FolderOpen className="h-3 w-3" />
            Projects
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
          <input
            type="text"
            placeholder={tab === 'sessions' ? 'Search sessions...' : 'Search projects...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-800 text-zinc-300 text-xs rounded px-2 py-1.5 pl-7 border border-zinc-700 outline-none focus:border-zinc-500 placeholder:text-zinc-600"
            autoFocus
          />
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {tab === 'sessions' ? (
            filteredSessions.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-4">
                {search ? 'No matching sessions' : 'No sessions available'}
              </p>
            ) : filteredSessions.map(s => (
              <button
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-zinc-800 transition-colors group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={cn(
                    'h-2 w-2 rounded-full shrink-0',
                    statusDotColor(s.status),
                    s.status === 'working' && 'animate-pulse'
                  )} />
                  <span className="text-xs font-medium text-zinc-200 truncate flex-1">
                    {getSessionDisplayName(s)}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <span className="text-[10px] text-zinc-500 truncate">
                    {shortProject(s.project)}
                  </span>
                  {s.provider && s.provider !== 'claude' && (
                    <span className={cn(
                      'text-[8px] font-mono font-bold px-0.5 rounded shrink-0',
                      s.provider === 'gemini' && 'bg-blue-500/20 text-blue-400',
                      s.provider === 'codex' && 'bg-green-500/20 text-green-400',
                    )}>
                      {s.provider === 'gemini' ? 'G' : 'CX'}
                    </span>
                  )}
                  {s.gitBranch && (
                    <span className="flex items-center gap-0.5 text-[10px] text-zinc-600 shrink-0">
                      <GitBranch className="h-2.5 w-2.5" />
                      {s.gitBranch}
                    </span>
                  )}
                  {shortModel(s.model, s.provider) && (
                    <Badge className="text-[8px] px-1 py-0 h-3.5 shrink-0 bg-zinc-800 text-zinc-500 border-zinc-700">
                      {shortModel(s.model, s.provider)}
                    </Badge>
                  )}
                  <span className={cn(
                    'text-[10px] shrink-0',
                    s.status === 'working' ? 'text-green-500' :
                    s.status === 'error' ? 'text-red-500' :
                    (s.status === 'waiting-input' || s.status === 'waiting-approval') ? 'text-yellow-500' :
                    'text-zinc-600'
                  )}>
                    {sessionStatusLabel(s.status)}
                  </span>
                  <span className="text-[10px] text-zinc-600 shrink-0 ml-auto">
                    {timeAgo(s.lastActivity)}
                  </span>
                </div>
              </button>
            ))
          ) : (
            loadingProjects ? (
              <p className="text-xs text-zinc-600 text-center py-4">Loading projects...</p>
            ) : filteredProjects.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-4">
                {search ? 'No matching projects' : 'No projects found'}
              </p>
            ) : filteredProjects.map(p => (
              <button
                key={p.path}
                onClick={() => onSelectProject(p.path)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-zinc-800 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <FolderOpen className="h-3 w-3 text-zinc-500 shrink-0" />
                  <span className="text-xs font-medium text-zinc-200 truncate flex-1">
                    {p.name}
                  </span>
                  {p.sessionCount > 0 && (
                    <Badge className="text-[8px] px-1 py-0 h-3.5 shrink-0 bg-zinc-800 text-zinc-500 border-zinc-700">
                      {p.sessionCount} active
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-5">
                  <span className="text-[10px] text-zinc-500 truncate font-mono">
                    {p.path}
                  </span>
                  {p.hasGit && p.gitBranch && (
                    <span className="flex items-center gap-0.5 text-[10px] text-zinc-600 shrink-0">
                      <GitBranch className="h-2.5 w-2.5" />
                      {p.gitBranch}
                    </span>
                  )}
                  {p.lastActivity && (
                    <span className="text-[10px] text-zinc-600 shrink-0 ml-auto">
                      {timeAgo(p.lastActivity)}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── GridCell ───

export default function GridCell({
  cellId, sessionId, cell, sessions, availableSessions, maximized, canClose,
  onSelectSession, onSelectProject, onNewSession, onMaximize, onRestore, onRemove,
}: GridCellProps) {
  const [swapping, setSwapping] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showPersona, setShowPersona] = useState(false);
  const [showHandoffPicker, setShowHandoffPicker] = useState(false);
  const [showConsultPicker, setShowConsultPicker] = useState(false);
  const [reviewProviders, setReviewProviders] = useState<ProviderStatus[]>([]);
  const session = sessionId ? sessions.find(s => s.id === sessionId) : null;

  // Stable terminal ID — never changes for a given cell, so PTY survives state transitions
  const termId = `${getTabId()}-grid-${cellId}`;

  // Resolve launch flags for resumed sessions (cells picked from session list, no spawn config)
  const [resumeFlags, setResumeFlags] = useState<string[] | null>(null);
  useEffect(() => {
    if (!sessionId || cell.cwd) return; // Don't need resume flags for spawned terminals
    getLaunchFlags().then(flags => {
      const providerId = session?.provider ?? 'claude';
      setResumeFlags(buildProviderFlags(providerId, flags));
    });
  }, [sessionId, session?.provider, cell.cwd]);

  async function toggleBookmark() {
    if (!sessionId) return;
    try {
      if (bookmarked) {
        await fetch(`${API_BASE}/api/bookmarks?sessionId=${sessionId}`, { method: 'DELETE' });
      } else {
        await fetch(`${API_BASE}/api/bookmarks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, label: session?.project ?? sessionId.slice(0, 8) }),
        });
      }
      setBookmarked(!bookmarked);
    } catch { /* ignore */ }
  }

  const cellProvider = cell.provider ?? session?.provider ?? 'claude';

  // ── Spawned terminal (DevOps launch, new session, project pick) ──
  // Has cwd/command — the PTY was started with these params.
  // May also have sessionId once auto-linked.
  if (cell.cwd) {
    const displayLabel = cell.label ?? cell.cwd.split(/[/\\]/).pop() ?? 'Terminal';

    return (
      <div className="flex flex-col h-full border border-zinc-800 rounded-lg overflow-hidden bg-[#0a0a0a] relative">
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[#111] border-b border-zinc-800">
          {session ? (
            <div className={cn(
              'h-2 w-2 rounded-full shrink-0',
              statusDotColor(session.status),
              session.status === 'working' && 'animate-pulse'
            )} />
          ) : (
            <Terminal className="h-3.5 w-3.5 text-green-400" />
          )}
          <span className="text-xs font-medium truncate flex-1 text-zinc-300">
            {session ? getSessionDisplayName(session) : displayLabel}
          </span>

          <span className="text-[10px] font-mono rounded bg-muted px-1 py-0.5 text-muted-foreground shrink-0">
            {PROVIDER_SHORT_NAMES[cellProvider]}
          </span>

          {session && (
            <Badge variant="outline" className={cn(
              'text-[9px] shrink-0',
              session.status === 'working' && 'text-green-400 border-green-800',
              session.status === 'done' && 'text-zinc-400 border-zinc-700',
              (session.status === 'waiting-input' || session.status === 'waiting-approval') && 'text-yellow-400 border-yellow-800',
              session.status === 'error' && 'text-red-400 border-red-800',
            )}>
              {sessionStatusLabel(session.status)}
            </Badge>
          )}

          <PathInsertMenu sessionId={sessionId ?? undefined} compact />

          {/* Bookmark */}
          {sessionId && (
            <button
              onClick={() => void toggleBookmark()}
              className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
              title={bookmarked ? 'Remove bookmark' : 'Bookmark session'}
            >
              {bookmarked ? <StarOff className="h-3 w-3 text-yellow-400" /> : <Star className="h-3 w-3" />}
            </button>
          )}

          {/* Transcript */}
          {sessionId && (
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className={cn(
                'shrink-0 transition-colors',
                showTranscript ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
              )}
              title="Toggle transcript"
            >
              <FileText className="h-3 w-3" />
            </button>
          )}

          {/* Continue with another AI */}
          <button
            onClick={() => {
              getProviderStatus().then((statuses) => {
                const enabled = statuses.filter(p => p.enabled && p.installed && p.id !== cellProvider);
                if (enabled.length === 0) return;
                setReviewProviders(enabled);
                setShowHandoffPicker(true);
              });
            }}
            className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Continue with another AI provider"
          >
            <ArrowRightLeft className="h-3 w-3" />
          </button>

          {/* Second Opinion */}
          <button
            onClick={() => {
              getProviderStatus().then((statuses) => {
                const enabled = statuses.filter(p => p.enabled && p.installed && p.id !== cellProvider);
                if (enabled.length === 0) return;
                setReviewProviders(enabled);
                setShowConsultPicker(true);
              });
            }}
            className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Get a second opinion from another AI"
          >
            <Eye className="h-3 w-3" />
          </button>

          <button
            onClick={() => setSwapping(!swapping)}
            className={cn(
              'shrink-0 transition-colors',
              swapping ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
            )}
            title="Swap session"
          >
            <Replace className="h-3 w-3" />
          </button>
          <button
            onClick={() => maximized ? onRestore() : onMaximize()}
            className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
            title={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
          {canClose && (
            <button onClick={onRemove} className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors" title="Remove terminal">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {swapping && (
          <div className="absolute inset-0 top-[33px] z-10 bg-zinc-900/95 backdrop-blur-sm">
            <CombinedPicker
              sessions={availableSessions}
              onSelectSession={(id) => { onSelectSession(id); setSwapping(false); }}
              onSelectProject={(path) => { onSelectProject(path); setSwapping(false); }}
              onNewSession={(pid) => { onNewSession(pid); setSwapping(false); }}
              label="Swap to a different session or project"
            />
          </div>
        )}

        {/* Handoff picker */}
        {showHandoffPicker && (
          <div className="absolute inset-0 top-[33px] z-10 bg-zinc-900/95 backdrop-blur-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-zinc-400">Continue this session with a different AI</p>
              <button onClick={() => setShowHandoffPicker(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1.5">
              {reviewProviders.map((provider) => (
                <button
                  key={provider.id}
                  onClick={async () => {
                    setShowHandoffPicker(false);
                    if (!sessionId) return;
                    try {
                      const fileRes = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript-file`, { method: 'POST' });
                      if (!fileRes.ok) return;
                      const { filePath: transcriptPath } = await fileRes.json();
                      const contextPrompt = `Read the file at ${transcriptPath} for full context on the previous session with a different AI provider. Review the context and continue where it left off.`;
                      const cwd = session?.cwd ?? session?.projectDir ?? cell.cwd ?? '';
                      const flags = await getLaunchFlags();
                      const statuses = await getProviderStatus();
                      const status = statuses.find(p => p.id === provider.id);
                      const command = status?.resolvedPath || provider.id;
                      const args = buildProviderFlags(provider.id, flags);
                      sessionStorage.setItem('hive-terminal-spawn', JSON.stringify({
                        cwd, command, args, initialPrompt: contextPrompt, provider: provider.id,
                      }));
                      window.location.href = '/sessions';
                    } catch { /* ignore */ }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-zinc-800 transition-colors text-left"
                >
                  <span className="font-mono text-[10px] leading-none rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-300">
                    {PROVIDER_SHORT_NAMES[provider.id]}
                  </span>
                  <span className="text-xs text-zinc-200 flex-1">{provider.displayName}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Consult picker */}
        {showConsultPicker && (
          <div className="absolute inset-0 top-[33px] z-10 bg-zinc-900/95 backdrop-blur-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-zinc-400">Get a second opinion from another AI</p>
              <button onClick={() => setShowConsultPicker(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-1.5">
              {reviewProviders.map((provider) => (
                <button
                  key={provider.id}
                  onClick={async () => {
                    setShowConsultPicker(false);
                    if (!sessionId) return;
                    try {
                      const fileRes = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript-file`, { method: 'POST' });
                      if (!fileRes.ok) return;
                      const { filePath: transcriptPath } = await fileRes.json();
                      const consultPrompt = `Read the file at ${transcriptPath} for full context on a coding session with another AI provider. Review the approach taken and provide your perspective:\n\n1. Are there any bugs, logic errors, or security concerns?\n2. Are there better approaches or patterns that could be used?\n3. Any suggestions for improvement?\n\nDo NOT make changes to any files — analysis and recommendations only.`;
                      const cwd = session?.cwd ?? session?.projectDir ?? cell.cwd ?? '';
                      const flags = await getLaunchFlags();
                      const statuses = await getProviderStatus();
                      const status = statuses.find(p => p.id === provider.id);
                      const command = status?.resolvedPath || provider.id;
                      const args = buildProviderFlags(provider.id, flags);
                      sessionStorage.setItem('hive-terminal-spawn', JSON.stringify({
                        cwd, command, args, initialPrompt: consultPrompt, provider: provider.id,
                      }));
                      window.location.href = '/sessions';
                    } catch { /* ignore */ }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-zinc-800 transition-colors text-left"
                >
                  <span className="font-mono text-[10px] leading-none rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-300">
                    {PROVIDER_SHORT_NAMES[provider.id]}
                  </span>
                  <span className="text-xs text-zinc-200 flex-1">{provider.displayName}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Terminal or Transcript */}
        <div className="flex-1 min-h-0">
          {showTranscript && sessionId ? (
            <div className="h-full overflow-auto p-2">
              <TranscriptViewer sessionId={sessionId} />
            </div>
          ) : (
            <TerminalView
              terminalId={termId}
              cwd={cell.cwd}
              command={cell.command}
              args={cell.args}
              initialPrompt={cell.initialPrompt}
              provider={cellProvider}
            />
          )}
        </div>
      </div>
    );
  }

  // ── Empty cell — show picker ──
  if (!session) {
    return (
      <div className="flex flex-col h-full border border-dashed border-zinc-700 rounded-lg bg-zinc-900/50 overflow-hidden">
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800">
          <Terminal className="h-3.5 w-3.5 text-zinc-600" />
          <span className="text-xs text-zinc-500 flex-1">Terminal</span>
          {canClose && (
            <button
              onClick={onRemove}
              className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Remove terminal"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <CombinedPicker
          sessions={availableSessions}
          onSelectSession={onSelectSession}
          onSelectProject={onSelectProject}
          onNewSession={onNewSession}
          label="Select a session or project to connect"
        />
      </div>
    );
  }

  // ── Resumed session (picked from session list, no spawn config) ──
  const modelLabel = shortModel(session.model, session.provider);
  const sessionProvider = session.provider ?? 'claude';

  return (
    <div className="flex flex-col h-full border border-zinc-800 rounded-lg overflow-hidden bg-[#0a0a0a] relative">
      {/* Compact header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[#111] border-b border-zinc-800">
        <div className={cn(
          'h-2 w-2 rounded-full shrink-0',
          statusDotColor(session.status),
          session.status === 'working' && 'animate-pulse'
        )} />

        <span className="text-xs font-medium truncate flex-1 text-zinc-300">
          {getSessionDisplayName(session)}
        </span>

        <span className="text-[10px] font-mono rounded bg-muted px-1 py-0.5 text-muted-foreground shrink-0">
          {PROVIDER_SHORT_NAMES[sessionProvider]}
        </span>

        {modelLabel && (
          <Badge className="text-[9px] shrink-0 bg-zinc-800 text-zinc-400 border-zinc-700">
            {modelLabel}
          </Badge>
        )}

        <Badge variant="outline" className={cn(
          'text-[9px] shrink-0',
          session.status === 'working' && 'text-green-400 border-green-800',
          session.status === 'done' && 'text-zinc-400 border-zinc-700',
          (session.status === 'waiting-input' || session.status === 'waiting-approval') && 'text-yellow-400 border-yellow-800',
          session.status === 'error' && 'text-red-400 border-red-800',
        )}>
          {sessionStatusLabel(session.status)}
        </Badge>

        <PathInsertMenu sessionId={sessionId ?? undefined} compact />

        {/* Bookmark toggle */}
        <button
          onClick={() => void toggleBookmark()}
          className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
          title={bookmarked ? 'Remove bookmark' : 'Bookmark session'}
        >
          {bookmarked ? <StarOff className="h-3 w-3 text-yellow-400" /> : <Star className="h-3 w-3" />}
        </button>

        {/* Transcript toggle */}
        <button
          onClick={() => setShowTranscript(!showTranscript)}
          className={cn(
            'shrink-0 transition-colors',
            showTranscript ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
          )}
          title="Toggle transcript"
        >
          <FileText className="h-3 w-3" />
        </button>

        {/* Continue with another AI */}
        <button
          onClick={() => {
            if (!session) return;
            getProviderStatus().then((statuses) => {
              const enabled = statuses.filter(p => p.enabled && p.installed && p.id !== sessionProvider);
              if (enabled.length === 0) return;
              setReviewProviders(enabled);
              setShowHandoffPicker(true);
            });
          }}
          className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Continue with another AI provider"
        >
          <ArrowRightLeft className="h-3 w-3" />
        </button>

        {/* Second Opinion */}
        <button
          onClick={() => {
            if (!session) return;
            getProviderStatus().then((statuses) => {
              const enabled = statuses.filter(p => p.enabled && p.installed && p.id !== sessionProvider);
              if (enabled.length === 0) return;
              setReviewProviders(enabled);
              setShowConsultPicker(true);
            });
          }}
          className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Get a second opinion from another AI"
        >
          <Eye className="h-3 w-3" />
        </button>

        {/* 3-dot menu */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className={cn(
              'transition-colors',
              showMenu ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
            )}
            title="More actions"
          >
            <MoreVertical className="h-3 w-3" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg py-1 min-w-[160px]">
              <button
                onClick={() => { setShowPersona(true); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Persona
              </button>
              <button
                onClick={() => {
                  if (session?.cwd || session?.projectDir) {
                    window.open(`/sessions/${sessionId}`, '_blank');
                  }
                  setShowMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Open full view
              </button>
            </div>
          )}
        </div>

        {/* Swap session */}
        <button
          onClick={() => setSwapping(!swapping)}
          className={cn(
            'shrink-0 transition-colors',
            swapping ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
          )}
          title="Swap session"
        >
          <Replace className="h-3 w-3" />
        </button>

        {/* Maximize / Restore */}
        <button
          onClick={() => maximized ? onRestore() : onMaximize()}
          className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        </button>

        {/* Remove cell */}
        {canClose && (
          <button
            onClick={onRemove}
            className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Remove terminal"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Expanded header when maximized */}
      {maximized && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1 bg-[#111] border-b border-zinc-800 text-[10px] text-zinc-500">
          <span className="truncate">{shortProject(session.project)}</span>
          {session.gitBranch && (
            <span className="flex items-center gap-0.5 shrink-0">
              <GitBranch className="h-2.5 w-2.5" />
              {session.gitBranch}
            </span>
          )}
          {session.cwd && <span className="truncate">{session.cwd}</span>}
        </div>
      )}

      {/* Swap picker overlay */}
      {swapping && (
        <div className="absolute inset-0 top-[33px] z-10 bg-zinc-900/95 backdrop-blur-sm">
          <CombinedPicker
            sessions={availableSessions}
            onSelectSession={(id) => { onSelectSession(id); setSwapping(false); }}
            onSelectProject={(path) => { onSelectProject(path); setSwapping(false); }}
            label="Swap to a different session or project"
          />
        </div>
      )}

      {/* Persona selector overlay */}
      {showPersona && sessionId && (
        <div className="absolute inset-0 top-[33px] z-10 bg-zinc-900/95 backdrop-blur-sm p-3 overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-300">Select Persona</span>
            <button onClick={() => setShowPersona(false)} className="text-zinc-500 hover:text-zinc-300">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <PersonaSelector projectDir={session?.projectDir ?? session?.cwd ?? ''} />
        </div>
      )}

      {/* Handoff picker */}
      {showHandoffPicker && (
        <div className="absolute inset-0 top-[33px] z-10 bg-zinc-900/95 backdrop-blur-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-zinc-400">Continue this session with a different AI</p>
            <button onClick={() => setShowHandoffPicker(false)} className="text-zinc-500 hover:text-zinc-300">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-1.5">
            {reviewProviders.map((provider) => (
              <button
                key={provider.id}
                onClick={async () => {
                  setShowHandoffPicker(false);
                  if (!sessionId) return;
                  try {
                    const fileRes = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript-file`, { method: 'POST' });
                    if (!fileRes.ok) return;
                    const { filePath: transcriptPath } = await fileRes.json();
                    const contextPrompt = `Read the file at ${transcriptPath} for full context on the previous session with a different AI provider. Review the context and continue where it left off.`;
                    const cwd = session?.cwd ?? session?.projectDir ?? '';
                    const flags = await getLaunchFlags();
                    const statuses = await getProviderStatus();
                    const status = statuses.find(p => p.id === provider.id);
                    const command = status?.resolvedPath || provider.id;
                    const args = buildProviderFlags(provider.id, flags);
                    sessionStorage.setItem('hive-terminal-spawn', JSON.stringify({
                      cwd, command, args, initialPrompt: contextPrompt, provider: provider.id,
                    }));
                    window.location.href = '/sessions';
                  } catch { /* ignore */ }
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-zinc-800 transition-colors text-left"
              >
                <span className="font-mono text-[10px] leading-none rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-300">
                  {PROVIDER_SHORT_NAMES[provider.id]}
                </span>
                <span className="text-xs text-zinc-200 flex-1">{provider.displayName}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Second Opinion picker */}
      {showConsultPicker && (
        <div className="absolute inset-0 top-[33px] z-10 bg-zinc-900/95 backdrop-blur-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-zinc-400">Get a second opinion from another AI</p>
            <button onClick={() => setShowConsultPicker(false)} className="text-zinc-500 hover:text-zinc-300">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-1.5">
            {reviewProviders.map((provider) => (
              <button
                key={provider.id}
                onClick={async () => {
                  setShowConsultPicker(false);
                  if (!sessionId) return;
                  try {
                    const fileRes = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript-file`, { method: 'POST' });
                    if (!fileRes.ok) return;
                    const { filePath: transcriptPath } = await fileRes.json();
                    const consultPrompt = `Read the file at ${transcriptPath} for full context on a coding session with another AI provider. Review the approach taken and provide your perspective:\n\n1. Are there any bugs, logic errors, or security concerns?\n2. Are there better approaches or patterns that could be used?\n3. Any suggestions for improvement?\n\nDo NOT make changes to any files — analysis and recommendations only.`;
                    const cwd = session?.cwd ?? session?.projectDir ?? '';
                    const flags = await getLaunchFlags();
                    const statuses = await getProviderStatus();
                    const status = statuses.find(p => p.id === provider.id);
                    const command = status?.resolvedPath || provider.id;
                    const args = buildProviderFlags(provider.id, flags);
                    sessionStorage.setItem('hive-terminal-spawn', JSON.stringify({
                      cwd, command, args, initialPrompt: consultPrompt, provider: provider.id,
                    }));
                    window.location.href = '/sessions';
                  } catch { /* ignore */ }
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-zinc-800 transition-colors text-left"
              >
                <span className="font-mono text-[10px] leading-none rounded bg-zinc-700 px-1.5 py-0.5 text-zinc-300">
                  {PROVIDER_SHORT_NAMES[provider.id]}
                </span>
                <span className="text-xs text-zinc-200 flex-1">{provider.displayName}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Terminal or Transcript */}
      <div className="flex-1 min-h-0">
        {showTranscript && sessionId ? (
          <div className="h-full overflow-auto p-2">
            <TranscriptViewer sessionId={sessionId} />
          </div>
        ) : resumeFlags !== null ? (
          <TerminalView
            terminalId={termId}
            cwd={session.cwd ?? session.projectDir}
            projectDir={session.projectDir}
            command={sessionProvider}
            args={[...buildResumeArgs(sessionProvider, session.id), ...resumeFlags]}
            provider={sessionProvider}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-zinc-500">Loading…</div>
        )}
      </div>
    </div>
  );
}
