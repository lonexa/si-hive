import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Columns2, LayoutGrid, ListTodo, MessageSquare, Terminal, FileText, Star, StarOff, Timer, Edit3, ArrowRightLeft, Eye, EyeOff, PanelRightOpen, PanelRightClose, Share2, Maximize2, Minimize2 } from 'lucide-react';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, type Layout, type GroupImperativeHandle } from 'react-resizable-panels';
import PathInsertMenu from '@/components/shared/PathInsertMenu';
import RequiredSkillsBanner from '@/components/skills/RequiredSkillsBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, shortProject } from '@/lib/utils';
import { useDashboardStore } from '@/stores/dashboard-store';
import TerminalView, { type TerminalViewHandle } from './TerminalView';
import TaskQueuePanel from './TaskQueuePanel';
import LiveLoopsPanel from './LiveLoopsPanel';
import TranscriptViewer from './TranscriptViewer';
import PersonaSelector from './PersonaSelector';
import ConsultPanel from './ConsultPanel';
import HandoffDialog from './HandoffDialog';
import { useIncognito } from '@/hooks/useIncognito';
import SessionSidebar, { readSidebarState, writeSidebarState } from './SessionSidebar';
import SessionModelMenu from './SessionModelMenu';
import SessionAccountMenu from './SessionAccountMenu';
import { getLaunchFlags, getPrimaryProviderId, getProviderStatus, PROVIDER_SHORT_NAMES, buildResumeArgs, buildProviderArgs, buildProviderFlags, formatModelDisplay, buildModelSwitchInput, getSelectableAccounts } from '@/lib/launch-flags';
import type { CodexReasoningEffort, ProviderId, ProviderStatus } from '@/lib/launch-flags';
import { saveSessionIntent, readSessionIntent, migrateSessionIntent } from '@/lib/session-intent';

import { API_BASE } from '@/lib/api-config';

export default function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [showQueue, setShowQueue] = useState(false);
  const [showLoops, setShowLoops] = useState(false);
  const [viewMode, setViewMode] = useState<'terminal' | 'transcript'>('terminal');
  const [bookmarked, setBookmarked] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [teamHandoffOpen, setTeamHandoffOpen] = useState(false);
  const [enabledProviders, setEnabledProviders] = useState<ProviderStatus[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [currentProvider, setCurrentProvider] = useState<ProviderId>('claude');
  const [activeModel, setActiveModel] = useState<string | undefined>(undefined);
  // Real Claude Code renderer state, read from ~/.claude/settings.json via the
  // server. `undefined` until loaded (button hidden until we know the mode).
  const [tuiFullscreen, setTuiFullscreen] = useState<boolean | undefined>(undefined);
  const handoffRef = useRef<HTMLDivElement>(null);
  // Consult / Second Opinion state
  const [consultOpen, setConsultOpen] = useState(false);
  const [consultData, setConsultData] = useState<{ command: string; args: string[]; provider: ProviderId; prompt: string } | null>(null);
  const [consultMenuOpen, setConsultMenuOpen] = useState(false);
  const [consultLoading, setConsultLoading] = useState(false);
  const consultRef = useRef<HTMLDivElement>(null);
  // Claude Design sidebar — toggleable right-side resizable panel
  const initialSidebar = useRef(readSidebarState());
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebar.current.open);
  const [sidebarSize, setSidebarSize] = useState(Math.max(35, initialSidebar.current.size));
  const terminalHandleRef = useRef<TerminalViewHandle | null>(null);
  const panelGroupRef = useRef<GroupImperativeHandle>(null);

  // When the sidebar transitions from closed → open, the Group has just mounted
  // the second Panel. defaultSize alone doesn't always claim enough space because
  // Group's flex layout already settled on the previous (single-Panel) state.
  // Imperatively set the layout to guarantee a sensible width on every open.
  useEffect(() => {
    if (!sidebarOpen) return;
    const desired = Math.max(35, sidebarSize);
    // Wait one frame so the second Panel is mounted before we set layout
    const id = requestAnimationFrame(() => {
      panelGroupRef.current?.setLayout({
        'session-main': 100 - desired,
        'session-sidebar': desired,
      });
    });
    return () => cancelAnimationFrame(id);
    // We only want to force layout on open transitions, not on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarOpen]);

  // Support launching a new session from Projects page or handoff
  const locState = location.state as {
    newSession?: boolean;
    cwd?: string;
    providerId?: ProviderId;
    accountId?: string;
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
    handoff?: { command: string; args: string[]; provider: ProviderId; initialPrompt: string };
    createdAt?: number;
  } | null;

  // Restore navigation intent from sessionStorage when router state was lost
  // (page reload, opening a `new-`/`handoff-` URL fresh in a new tab/session).
  // Reading lazily on each sessionId change so URL stabilization picks up the
  // migrated intent at the new key — but we don't react to storage edits.
  const intentForId = sessionId ? readSessionIntent(sessionId) : null;

  const effectiveState = locState ?? intentForId;
  const isNewSession = effectiveState?.newSession === true;
  const handoff = effectiveState?.handoff;
  // Which credential identity to run under. Only new/handoff launches carry one;
  // a plain resume falls back to the default account, since session transcripts
  // are account-agnostic and can be continued under either identity.
  const launchAccountId = effectiveState?.accountId;
  // Account currently in force. Seeded from the launch intent, then overridden
  // when the user switches accounts from the header (which relaunches the CLI).
  const [activeAccount, setActiveAccount] = useState<string | undefined>(launchAccountId);
  // Bumped to force TerminalView to remount after the PTY is killed, so the
  // CLI respawns with a different CLAUDE_CONFIG_DIR.
  const [terminalEpoch, setTerminalEpoch] = useState(0);
  // What the RUNNING process reports, as opposed to what the UI intended. The
  // account is fixed in the process environment at spawn time, so this is the
  // only trustworthy answer to "which account is this session billing?".
  const [resolvedAccount, setResolvedAccount] = useState<string | undefined>(undefined);
  useEffect(() => { setActiveAccount(launchAccountId); }, [launchAccountId, sessionId]);

  const sessions = useDashboardStore((s) => s.sessions);
  const queueData = useDashboardStore((s) => sessionId ? s.queues[sessionId] : undefined);
  const allLiveLoops = useDashboardStore((s) => s.liveLoops);
  const sessionLoops = allLiveLoops.filter((l) => l.sessionId === sessionId);
  const session = sessions.find((s) => s.id === sessionId);

  // Server-resolved cwd for sessions not in the in-memory dashboard store.
  // Without this, claude --resume runs from the wrong directory and Claude
  // can't find the JSONL — surfacing as "No conversation found with session ID".
  const [resolvedCwd, setResolvedCwd] = useState<string | undefined>(undefined);
  const [sessionLookupState, setSessionLookupState] = useState<'idle' | 'loading' | 'not-found'>('idle');

  // For resume flows, the JSONL-derived cwd (resolvedCwd) is authoritative —
  // session.cwd from the aggregator can drift to a subdirectory the user
  // `cd`'d into during the session, which makes `claude --resume` fail
  // because Claude looks for the JSONL under encode(cwd) which no longer
  // matches the original encoded directory the JSONL actually lives in.
  const cwd = isNewSession
    ? effectiveState?.cwd
    : (resolvedCwd ?? session?.cwd ?? session?.projectDir);

  // Incognito state for this session. `session.incognito` is the server's
  // answer (it also covers the project-level flag and sessions started outside
  // Hive); the id check catches a brand-new terminal that the aggregator hasn't
  // seen a transcript for yet.
  const {
    canToggle: canToggleIncognito,
    busy: incognitoBusy,
    isProjectIncognito,
    isSessionIncognito,
    toggleSession,
  } = useIncognito();
  const projectIncognito = isProjectIncognito(cwd);
  const incognito = session?.incognito === true
    || projectIncognito
    || isSessionIncognito(sessionId);

  // Always look up the JSONL-derived cwd from the server for resume flows.
  // Skips temp IDs (new-/handoff-) — those use the intent's cwd directly.
  useEffect(() => {
    if (!sessionId) return;
    if (isNewSession) return;
    if (resolvedCwd) return;
    if (sessionLookupState !== 'idle') return;

    setSessionLookupState('loading');
    fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/info`)
      .then(async (r) => {
        if (!r.ok) {
          // 404 only counts as "not found" when we have nothing else to fall
          // back to — if the dashboard store still has a usable cwd we can
          // try that rather than blocking on the empty state.
          if (session?.cwd || session?.projectDir) {
            setSessionLookupState('idle');
          } else {
            setSessionLookupState('not-found');
          }
          return;
        }
        const info = await r.json() as { exists: boolean; cwd?: string };
        if (info.exists && info.cwd) {
          setResolvedCwd(info.cwd);
          setSessionLookupState('idle');
        } else if (session?.cwd || session?.projectDir) {
          setSessionLookupState('idle');
        } else {
          setSessionLookupState('not-found');
        }
      })
      .catch(() => {
        if (session?.cwd || session?.projectDir) {
          setSessionLookupState('idle');
        } else {
          setSessionLookupState('not-found');
        }
      });
  }, [sessionId, isNewSession, resolvedCwd, sessionLookupState, session?.cwd, session?.projectDir]);

  // Reset lookup state when sessionId changes (URL stabilization, manual nav)
  useEffect(() => {
    setResolvedCwd(undefined);
    setSessionLookupState('idle');
  }, [sessionId]);

  const hasPendingTasks = queueData?.tasks?.some((t) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'sending');

  // Build CLI args with launch flags — must resolve before rendering TerminalView.
  // Gated on cwd availability: spawning `claude --resume <id>` from the wrong
  // directory makes Claude exit with "No conversation found with session ID".
  const [terminalArgs, setTerminalArgs] = useState<string[] | null>(null); // null = not yet resolved
  const [terminalCommand, setTerminalCommand] = useState<string>('claude');
  useEffect(() => {
    // For resume flows, wait until we have a cwd (from store or server lookup)
    // or have confirmed the session doesn't exist locally.
    if (!isNewSession) {
      if (!cwd && sessionLookupState !== 'not-found') {
        setTerminalArgs(null);
        return;
      }
    }
    Promise.all([getLaunchFlags(), getPrimaryProviderId(), getProviderStatus()]).then(async ([flags, primaryId, statuses]) => {
      const providerId = effectiveState?.providerId ?? session?.provider ?? primaryId;
      const status = statuses.find(p => p.id === providerId);
      setTerminalCommand(status?.resolvedPath || providerId);
      setCurrentProvider(providerId);
      setProviderStatuses(statuses);
      setEnabledProviders(statuses.filter(s => s.enabled && s.installed));

      const a = buildProviderFlags(providerId, flags);

      if (isNewSession) {
        const { command, args } = await buildProviderArgs(providerId, '', {
          model: effectiveState?.model,
          reasoningEffort: effectiveState?.reasoningEffort,
        });
        setTerminalCommand(command);
        setTerminalArgs(args);
      } else if (sessionId) {
        setTerminalArgs([...buildResumeArgs(providerId, sessionId), ...a]);
      }
    });
  }, [isNewSession, sessionId, cwd, sessionLookupState]);

  // URL stabilization: when the server discovers the real Claude session ID
  // for a `new-*`/`handoff-*` terminal, replace the URL so refreshes land on
  // a sticky URL that resumes correctly. The PTY is re-keyed server-side, so
  // the new TerminalView WS reattaches to the same running process.
  const handleSessionIdDiscovered = (realSessionId: string) => {
    if (!sessionId || sessionId === realSessionId) return;
    // MIGRATE the intent rather than dropping it. It carries the account this
    // session was launched under, and the replace-navigate below passes no
    // router state, so clearing it made the account disappear the moment the
    // real session id was discovered. The terminal then remounted with no
    // account and the server respawned it on the DEFAULT one - silently
    // billing the wrong subscription.
    migrateSessionIntent(sessionId, realSessionId);
    navigate(`/sessions/${realSessionId}`, {
      replace: true,
      state: activeAccount ? { accountId: activeAccount } : undefined,
    });
  };

  // Recovery path: if the URL is still a temp ID (`new-*` / `handoff-*`),
  // ask the server whether it has a persisted mapping or a recent JSONL in
  // the intent's cwd. Lets us recover a session even after the server was
  // restarted (e.g., during Refresh-from-Repo) before discovery could fire.
  useEffect(() => {
    if (!sessionId) return;
    if (!/^(new|handoff)-/.test(sessionId)) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (effectiveState?.cwd) params.set('cwd', effectiveState.cwd);
    // Scope the JSONL heuristic to files created after this temp ID was minted.
    // Without it, the server picks the most recently modified JSONL in cwd —
    // which hijacks fresh +AI clicks into resumes of unrelated existing sessions.
    if (effectiveState?.createdAt) params.set('since', String(effectiveState.createdAt));
    const qs = params.toString() ? `?${params}` : '';
    fetch(`${API_BASE}/api/sessions/temp/${encodeURIComponent(sessionId)}/resolve${qs}`)
      .then(async (r) => {
        if (!r.ok || cancelled) return;
        const data = await r.json() as { sessionId?: string };
        if (data.sessionId && data.sessionId !== sessionId) {
          handleSessionIdDiscovered(data.sessionId);
        }
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    setActiveModel(session?.model);
  }, [session?.model, sessionId]);

  // Close handoff dropdown on outside click
  useEffect(() => {
    if (!handoffOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (handoffRef.current && !handoffRef.current.contains(e.target as Node)) {
        setHandoffOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handoffOpen]);

  // Close consult menu on outside click
  useEffect(() => {
    if (!consultMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (consultRef.current && !consultRef.current.contains(e.target as Node)) {
        setConsultMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [consultMenuOpen]);

  async function handleConsult(targetProvider: ProviderId) {
    if (!sessionId || consultLoading) return;
    setConsultLoading(true);
    setConsultMenuOpen(false);
    try {
      const flags = await getLaunchFlags();
      const statuses = await getProviderStatus();
      const status = statuses.find(p => p.id === targetProvider);
      const command = status?.resolvedPath || targetProvider;
      const args = buildProviderFlags(targetProvider, flags);

      let prompt: string;

      // Try to save transcript to temp file
      const fileRes = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript-file`, { method: 'POST' });
      if (fileRes.ok) {
        const { filePath: transcriptPath } = await fileRes.json();
        prompt = `Read the file at ${transcriptPath} for full context on a coding session with another AI provider. Review the approach taken and provide your perspective:\n\n1. Are there any bugs, logic errors, or security concerns?\n2. Are there better approaches or patterns that could be used?\n3. Any suggestions for improvement?\n\nDo NOT make changes to any files — analysis and recommendations only.`;
      } else {
        // No transcript yet (new session) — open fresh with a general review prompt
        prompt = `Review the recent work in this project. Check the git log and recent changes for bugs, code quality issues, security concerns, and suggestions for improvement. Do NOT make changes to any files — analysis and recommendations only.`;
      }

      setConsultData({
        command,
        args,
        provider: targetProvider,
        prompt,
      });
      setConsultOpen(true);
    } catch (err) {
      console.error('Consult failed:', err);
    } finally {
      setConsultLoading(false);
    }
  }

  async function handleContinueWith(targetProvider: ProviderId) {
    if (!sessionId || handoffLoading) return;
    setHandoffLoading(true);
    setHandoffOpen(false);
    try {
      // Build args for the target provider
      const flags = await getLaunchFlags();
      const statuses = await getProviderStatus();
      const status = statuses.find(p => p.id === targetProvider);
      const command = status?.resolvedPath || targetProvider;

      const args = buildProviderFlags(targetProvider, flags);

      // Try to save transcript to temp file
      let contextPrompt: string;
      const fileRes = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/transcript-file`, { method: 'POST' });
      if (fileRes.ok) {
        const { filePath: transcriptPath } = await fileRes.json();
        contextPrompt = `Read the file at ${transcriptPath} for full context on the previous session with a different AI provider. Review the context and continue where it left off.`;
      } else {
        // No transcript yet — just start fresh in the same directory
        contextPrompt = '';
      }

      // Navigate to a new session with the transcript as initial prompt
      const newTermId = `handoff-${targetProvider}-${Date.now()}`;
      const handoffIntent = {
        command,
        args,
        provider: targetProvider,
        initialPrompt: contextPrompt || undefined,
      };
      saveSessionIntent(newTermId, {
        newSession: true,
        cwd: cwd,
        providerId: targetProvider,
        handoff: handoffIntent,
      });
      navigate(`/sessions/${newTermId}`, {
        state: {
          newSession: true,
          cwd: cwd,
          handoff: handoffIntent,
        },
      });
    } catch (err) {
      console.error('Handoff failed:', err);
    } finally {
      setHandoffLoading(false);
    }
  }

  function sendTerminalInputWhenReady(input: string, attempts = 20) {
    const sent = terminalHandleRef.current?.sendInput(input, true);
    if (sent || attempts <= 0) return;
    window.setTimeout(() => sendTerminalInputWhenReady(input, attempts - 1), 150);
  }

  function handleModelChange(model: string) {
    const providerId = handoff?.provider ?? session?.provider ?? currentProvider;
    setActiveModel(model);
    if (viewMode !== 'terminal') setViewMode('terminal');
    sendTerminalInputWhenReady(buildModelSwitchInput(providerId, model));
  }

  /**
   * Relaunch this session under a different account.
   *
   * The account is fixed at spawn time by CLAUDE_CONFIG_DIR, so there is no way
   * to switch in place — the PTY has to be killed and respawned. The resume is
   * lossless because `projects/` is shared across accounts and transcripts hold
   * no account identity, so `--resume <id>` finds the same conversation.
   */
  function handleAccountChange(nextAccountId: string) {
    if (nextAccountId === (activeAccount ?? 'default')) return;
    const accounts = getSelectableAccounts(
      handoff?.provider ?? session?.provider ?? currentProvider,
      providerStatuses,
    );
    const label = accounts.find((a) => a.id === nextAccountId)?.label ?? nextAccountId;
    const confirmed = window.confirm(
      `Relaunch this session as "${label}"?

` +
      'The running CLI is stopped and resumed under the other account. The ' +
      'conversation is preserved; anything still in progress is not.',
    );
    if (!confirmed) return;
    if (viewMode !== 'terminal') setViewMode('terminal');
    // Kill the PTY before remounting, otherwise the server reattaches to the
    // still-running process and the new account never takes effect.
    terminalHandleRef.current?.closePty();
    setActiveAccount(nextAccountId);
    setTerminalEpoch((n) => n + 1);
  }

  function refreshTuiMode() {
    fetch(`${API_BASE}/api/sessions/tui-mode`)
      .then((r) => r.json())
      .then((d: { mode?: string }) => setTuiFullscreen(d.mode === 'fullscreen'))
      .catch(() => {});
  }

  // Load the real renderer mode once on mount.
  useEffect(() => { refreshTuiMode(); }, []);

  function handleToggleFullscreen() {
    // /tui isn't a toggle — fullscreen and default are separate, idempotent
    // commands. Pick the opposite of the current real state.
    const goingFullscreen = !tuiFullscreen;
    setTuiFullscreen(goingFullscreen); // optimistic; reconciled below
    if (viewMode !== 'terminal') setViewMode('terminal');
    // Sent through the live terminal the same way model switching is.
    sendTerminalInputWhenReady(goingFullscreen ? '/tui fullscreen' : '/tui default');
    // Claude Code rewrites ~/.claude/settings.json (and relaunches) when the
    // renderer changes — re-read the persisted truth to correct the label.
    window.setTimeout(refreshTuiMode, 1500);
    window.setTimeout(refreshTuiMode, 4000);
  }

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

  return (
    <div className="flex flex-col h-full bg-background">
      <RequiredSkillsBanner sessionId={sessionId} cwd={cwd} />
      {/* Header */}
      <div className="shrink-0 border-b border-border px-4 py-2 flex items-center gap-3 bg-card">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/sessions')}
          className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          data-track="session_detail.back_to_grid"
          data-track-category="nav"
        >
          <LayoutGrid className="h-4 w-4" />
          Grid
        </Button>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {session && (
            <>
              <Badge variant="outline" className={cn(
                'text-[10px] border-border',
                session.status === 'working' && 'text-green-400 border-green-800',
                session.status === 'done' && 'text-muted-foreground',
                (session.status === 'waiting-input' || session.status === 'waiting-approval') && 'text-yellow-400 border-yellow-800',
                session.status === 'error' && 'text-red-400 border-red-800',
              )}>
                {session.status}
              </Badge>
              <span className="text-xs text-muted-foreground truncate font-mono">
                {shortProject(session.project)}
              </span>
              {session.model && (
                <Badge className="text-[10px] shrink-0 bg-accent text-muted-foreground border-border">
                  {formatModelDisplay(session.provider, session.model)}
                </Badge>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* View mode toggle */}
          <div className="flex border border-border rounded-md overflow-hidden mr-1">
            <button
              onClick={() => setViewMode('terminal')}
              className={cn(
                'px-2 py-1 text-xs flex items-center gap-1',
                viewMode === 'terminal' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              data-track="session_detail.view_terminal"
              data-track-category="nav"
            >
              <Terminal className="h-3 w-3" />
              Terminal
            </button>
            <button
              onClick={() => setViewMode('transcript')}
              className={cn(
                'px-2 py-1 text-xs border-l border-border flex items-center gap-1',
                viewMode === 'transcript' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              data-track="session_detail.view_transcript"
              data-track-category="nav"
            >
              <MessageSquare className="h-3 w-3" />
              Transcript
            </button>
          </div>

          <PathInsertMenu sessionId={sessionId} />

          <SessionModelMenu
            provider={handoff?.provider ?? session?.provider ?? currentProvider}
            providerStatuses={providerStatuses}
            currentModel={activeModel}
            onModelSelect={handleModelChange}
          />

          {/* Only for a real resumable session — a temp `new-*`/`handoff-*` id
              has no transcript to resume yet, so a relaunch would lose it. */}
          {sessionId && !/^(new|handoff)-/.test(sessionId) && (
            <SessionAccountMenu
              provider={handoff?.provider ?? session?.provider ?? currentProvider}
              providerStatuses={providerStatuses}
              currentAccount={resolvedAccount ?? activeAccount}
              onAccountSelect={handleAccountChange}
            />
          )}

          {(handoff?.provider ?? session?.provider ?? currentProvider) === 'claude' && tuiFullscreen !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleFullscreen}
              className="gap-1 text-muted-foreground hover:text-foreground hover:bg-accent"
              title={tuiFullscreen
                ? 'Exit Claude Code full-screen mode (sends /tui default). Use this to restore terminal scrollback.'
                : 'Enter Claude Code full-screen mode (sends /tui fullscreen).'}
              data-track="session_detail.toggle_tui_fullscreen"
              data-track-category="action"
            >
              {tuiFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => void toggleBookmark()}
            className="gap-1 text-muted-foreground hover:text-foreground hover:bg-accent"
            title={bookmarked ? 'Remove bookmark' : 'Bookmark session'}
            data-track="session_detail.toggle_bookmark"
            data-track-category="action"
          >
            {bookmarked ? <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" /> : <StarOff className="h-4 w-4" />}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const name = prompt('Rename session:');
              if (name && sessionId) {
                fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/rename`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name }),
                }).catch(() => {});
              }
            }}
            className="gap-1 text-muted-foreground hover:text-foreground hover:bg-accent"
            title="Rename session"
            data-track="session_detail.rename"
            data-track-category="action"
          >
            <Edit3 className="h-4 w-4" />
          </Button>

          {session?.projectDir && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/projects/${encodeURIComponent(session.projectDir)}/claude-md`)}
              className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
              title="Edit Instructions"
              data-track="session_detail.edit_instructions"
              data-track-category="nav"
            >
              <FileText className="h-4 w-4" />
            </Button>
          )}

          {session?.projectDir && (
            <PersonaSelector projectDir={session.projectDir} />
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowQueue(!showQueue)}
            className={cn(
              'gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent',
              showQueue && 'bg-accent text-foreground',
            )}
            title="Toggle task queue"
            data-track="session_detail.toggle_queue"
            data-track-category="feature"
          >
            <ListTodo className="h-4 w-4" />
            Queue
            {hasPendingTasks && (
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLoops(!showLoops)}
            className={cn(
              'gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent',
              showLoops && 'bg-accent text-foreground',
            )}
            title="Toggle live loops"
            data-track="session_detail.toggle_loops"
            data-track-category="feature"
          >
            <Timer className="h-4 w-4" />
            Loops
            {sessionLoops.filter((l) => l.status === 'active').length > 0 && (
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = !sidebarOpen;
              setSidebarOpen(next);
              writeSidebarState({ open: next });
            }}
            className={cn(
              'gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent',
              sidebarOpen && 'bg-accent text-foreground',
            )}
            title="Toggle Claude Design sidebar"
            data-track="session_detail.toggle_design_sidebar"
            data-track-category="feature"
          >
            {sidebarOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            Design
          </Button>
          {sessionId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/sessions', { state: { gridAdd: sessionId } })}
              className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
              title="Add this session to the terminal grid view"
              data-track="session_detail.add_to_grid"
              data-track-category="action"
            >
              <Columns2 className="h-4 w-4" />
              Grid
            </Button>
          )}

          {/* Continue with [provider] — handoff to another AI */}
          {sessionId && enabledProviders.length > 1 && (() => {
            return (
            <div ref={handoffRef} className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHandoffOpen(!handoffOpen)}
                disabled={handoffLoading}
                className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                title="Continue this session with a different AI provider"
                data-track="session_detail.continue_with_menu"
                data-track-category="modal"
              >
                <ArrowRightLeft className="h-4 w-4" />
                {handoffLoading ? 'Loading...' : 'Continue with...'}
              </Button>
              {handoffOpen && (
                <div className="absolute right-0 z-50 mt-1 min-w-[180px] rounded-md border border-border bg-popover py-1 shadow-lg">
                  {enabledProviders
                    .filter(p => p.id !== (session?.provider ?? currentProvider))
                    .map(provider => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => handleContinueWith(provider.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        data-track="session_detail.continue_with"
                        data-track-category="action"
                        data-track-props={JSON.stringify({ provider: provider.id })}
                      >
                        <span className="font-mono text-[10px] leading-none rounded bg-accent px-1 py-0.5">
                          {PROVIDER_SHORT_NAMES[provider.id]}
                        </span>
                        <span>{provider.displayName}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            );
          })()}

          {/* Get Second Opinion — consult alternate AI */}
          {sessionId && enabledProviders.length > 1 && (() => {
            return (
            <div ref={consultRef} className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConsultMenuOpen(!consultMenuOpen)}
                disabled={consultLoading}
                className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                title="Get a second opinion from another AI provider"
                data-track="session_detail.second_opinion_menu"
                data-track-category="modal"
              >
                <Eye className="h-4 w-4" />
                {consultLoading ? 'Loading...' : 'Second Opinion'}
              </Button>
              {consultMenuOpen && (
                <div className="absolute right-0 z-50 mt-1 min-w-[180px] rounded-md border border-border bg-popover py-1 shadow-lg">
                  {enabledProviders
                    .filter(p => p.id !== (session?.provider ?? currentProvider))
                    .map(provider => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => handleConsult(provider.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        data-track="session_detail.second_opinion"
                        data-track-category="action"
                        data-track-props={JSON.stringify({ provider: provider.id })}
                      >
                        <span className="font-mono text-[10px] leading-none rounded bg-accent px-1 py-0.5">
                          {PROVIDER_SHORT_NAMES[provider.id]}
                        </span>
                        <span>{provider.displayName}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            );
          })()}

          {/* Incognito: suppress every shared write for this one session.
              Admin-gated for now (the `incognito` feature key). A session
              inside an incognito project is already covered — show the badge
              but no toggle, since turning it off here would be misleading. */}
          {sessionId && incognito && (
            <span
              className="flex items-center gap-1.5 rounded-md border border-violet-500/40 px-2 py-1 text-xs text-violet-300"
              title={projectIncognito
                ? 'This project is incognito — nothing about this session is logged off this machine'
                : 'Incognito — nothing about this session is logged off this machine'}
            >
              <EyeOff className="h-3.5 w-3.5" />
              Incognito
            </span>
          )}
          {sessionId && canToggleIncognito && !projectIncognito && (
            <Button
              variant="ghost"
              size="sm"
              disabled={incognitoBusy}
              onClick={() => void toggleSession(sessionId, !incognito)}
              className={cn(
                'gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent',
                incognito && 'text-violet-300',
              )}
              title={incognito
                ? 'Resume normal logging for this session (already-logged rows are left alone)'
                : 'Go incognito — stop logging anything about this session off this machine'}
              data-track="session_detail.toggle_incognito"
              data-track-category="action"
            >
              {incognito ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {incognito ? 'Exit incognito' : 'Incognito'}
            </Button>
          )}

          {/* Hand off to a teammate (cross-user) — uploads the transcript to
              shared SQL, so it is unavailable while incognito. */}
          {sessionId && !incognito && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTeamHandoffOpen(true)}
              className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
              title="Hand this session off to a teammate"
              data-track="session_detail.handoff_teammate"
              data-track-category="modal"
            >
              <Share2 className="h-4 w-4" />
              Hand off
            </Button>
          )}
        </div>
      </div>

      {sessionId && (
        <HandoffDialog
          open={teamHandoffOpen}
          onClose={() => setTeamHandoffOpen(false)}
          sessionId={sessionId}
          cwd={cwd}
          provider={session?.provider ?? currentProvider}
        />
      )}

      {/* Content: terminal/transcript + optional Design sidebar (PanelGroup keeps terminal mounted across toggles) */}
      <PanelGroup
        orientation="horizontal"
        groupRef={panelGroupRef}
        className="flex-1 min-h-0"
        onLayoutChanged={(layout: Layout) => {
          const next = Math.round(layout['session-sidebar'] ?? sidebarSize);
          if (sidebarOpen && next !== sidebarSize && next >= 20 && next <= 80) {
            setSidebarSize(next);
            writeSidebarState({ size: next });
          }
        }}
      >
        <Panel
          id="session-main"
          defaultSize={sidebarOpen ? `${100 - sidebarSize}%` : '100%'}
          minSize="20%"
          className="!flex !overflow-visible"
        >
          <div className="flex-1 min-w-0">
            {sessionId && viewMode === 'terminal' && sessionLookupState === 'not-found' && !isNewSession && (
              <div className="flex h-full items-center justify-center p-8">
                <div className="max-w-md text-center space-y-3">
                  <div className="text-base text-foreground">Session no longer available</div>
                  <div className="text-sm text-muted-foreground">
                    No JSONL file was found for session <span className="font-mono">{sessionId.slice(0, 8)}…</span> under{' '}
                    <span className="font-mono">~/.claude/projects/</span>. Claude Code may have removed it, or it
                    belongs to a different machine.
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate('/sessions')}>
                    Back to sessions
                  </Button>
                </div>
              </div>
            )}
            {sessionId && viewMode === 'terminal' && terminalArgs !== null && sessionLookupState !== 'not-found' && (
              <TerminalView
                ref={terminalHandleRef}
                terminalId={sessionId}
                cwd={cwd}
                projectDir={session?.projectDir}
                command={handoff?.command ?? terminalCommand}
                args={handoff?.args ?? (terminalArgs.length > 0 ? terminalArgs : undefined)}
                initialPrompt={handoff?.initialPrompt}
                key={`${sessionId}:${activeAccount ?? 'default'}:${terminalEpoch}`}
                onAccountResolved={setResolvedAccount}
                provider={handoff?.provider ?? currentProvider}
                account={activeAccount}
                onSessionIdDiscovered={handleSessionIdDiscovered}
              />
            )}
            {sessionId && viewMode === 'transcript' && (
              <TranscriptViewer sessionId={sessionId} />
            )}
          </div>

          {/* Existing fixed-width side panels (Queue/Loops) — hidden when Consult is open, per existing behavior */}
          {(showQueue || showLoops) && sessionId && !consultOpen && (
            <div className="w-80 shrink-0 border-l border-border bg-secondary overflow-y-auto">
              {showQueue && <TaskQueuePanel sessionId={sessionId} />}
              {showLoops && <LiveLoopsPanel sessionId={sessionId} loops={sessionLoops} />}
            </div>
          )}

          {/* Consult / Second Opinion panel — also fixed-width per existing behavior */}
          {consultOpen && consultData && sessionId && (
            <div className="w-[45%] shrink-0">
              <ConsultPanel
                sourceSessionId={sessionId}
                targetProvider={consultData.provider}
                command={consultData.command}
                args={consultData.args}
                initialPrompt={consultData.prompt}
                cwd={cwd}
                onClose={() => { setConsultOpen(false); setConsultData(null); }}
              />
            </div>
          )}
        </Panel>

        {sidebarOpen && sessionId && !consultOpen && (
          <>
            <PanelResizeHandle
              className={cn(
                'group relative flex w-1.5 shrink-0 items-center justify-center bg-border',
                'cursor-col-resize hover:bg-primary/60 active:bg-primary transition-colors',
                'data-[separator]:w-1.5',
              )}
            >
              {/* visible drag affordance */}
              <span className="pointer-events-none h-8 w-0.5 rounded-full bg-muted-foreground/40 group-hover:bg-foreground/70" />
            </PanelResizeHandle>
            <Panel
              id="session-sidebar"
              defaultSize={`${sidebarSize}%`}
              minSize="20%"
              maxSize="80%"
            >
              <SessionSidebar terminalRef={terminalHandleRef} sessionId={sessionId} />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
