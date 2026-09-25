import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, FastForward, Rewind, RotateCcw, ChevronLeft, Terminal, User, Bot, Wrench, AlertCircle, Info, Loader2 } from 'lucide-react';
import AISessionButton from '@/components/shared/AISessionButton';
import { replayEntry } from '@/lib/prompt-templates';
import { resolveDefaultProjectDir } from '@/lib/project-mappings';

import { API_BASE } from '@/lib/api-config';

// ── Types ──────────────────────────────────────────────────────────────

interface SessionListEntry {
  id: string;
  project: string;
  projectEncoded: string;
  modifiedAt: string;
  sizeBytes: number;
}

interface SessionEntry {
  index: number;
  type: string;
  role?: string;
  content?: string;
  toolName?: string;
  toolUseId?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  isSidechain?: boolean;
}

interface SessionSummary {
  totalEntries: number;
  userTurns: number;
  assistantTurns: number;
  toolCalls: number;
  systemMessages: number;
  progressMessages: number;
  duration?: string;
}

interface SessionDetail {
  id: string;
  project: string;
  projectEncoded: string;
  entries: SessionEntry[];
  summary: SessionSummary;
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function shortProject(project: string): string {
  // Show last 2 path segments
  const parts = project.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : parts.join('/');
}

function roleIcon(role?: string) {
  switch (role) {
    case 'user': return <User className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />;
    case 'assistant': return <Bot className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" />;
    case 'progress': return <Loader2 className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5 animate-spin" />;
    case 'system': return <Info className="h-3.5 w-3.5 text-gray-400 shrink-0 mt-0.5" />;
    default: return <Terminal className="h-3.5 w-3.5 text-gray-500 shrink-0 mt-0.5" />;
  }
}

function roleBg(role?: string): string {
  switch (role) {
    case 'user': return 'border-l-blue-500/60';
    case 'assistant': return 'border-l-green-500/60';
    case 'progress': return 'border-l-yellow-500/40';
    case 'system': return 'border-l-gray-500/40';
    default: return 'border-l-gray-600/30';
  }
}

function roleLabel(role?: string): string {
  switch (role) {
    case 'user': return 'Human';
    case 'assistant': return 'Assistant';
    case 'progress': return 'Progress';
    case 'system': return 'System';
    default: return role || 'Unknown';
  }
}

// ── Speed options ──────────────────────────────────────────────────────

const SPEEDS = [
  { label: '1x', ms: 600 },
  { label: '2x', ms: 300 },
  { label: '5x', ms: 120 },
  { label: '10x', ms: 60 },
  { label: 'Max', ms: 10 },
];

// ── Component ──────────────────────────────────────────────────────────

export default function ReplayTab() {
  // Session list state
  const [sessions, setSessions] = useState<SessionListEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');

  const [defaultCwd, setDefaultCwd] = useState('');

  // Selected session state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Replay state
  const [playing, setPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Fetch session list ──────────────────────────────────────────────

  useEffect(() => {
    resolveDefaultProjectDir().then(setDefaultCwd);
  }, []);

  useEffect(() => {
    setListLoading(true);
    setListError(null);
    fetch(`${API_BASE}/api/sessions/replay?limit=500`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: { sessions: SessionListEntry[]; total: number }) => {
        setSessions(data.sessions);
        setTotal(data.total);
      })
      .catch(err => setListError(err.message))
      .finally(() => setListLoading(false));
  }, []);

  // ── Fetch session detail ────────────────────────────────────────────

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    setDetailLoading(true);
    setDetailError(null);
    setCurrentFrame(0);
    setPlaying(false);
    fetch(`${API_BASE}/api/sessions/replay/${encodeURIComponent(selectedId)}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: SessionDetail) => setDetail(data))
      .catch(err => setDetailError(err.message))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  // ── Replay interval ─────────────────────────────────────────────────

  const visibleEntries = detail
    ? (showProgress ? detail.entries : detail.entries.filter(e => e.role !== 'progress'))
    : [];
  const totalFrames = visibleEntries.length;

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  useEffect(() => {
    if (!playing || totalFrames === 0) return;
    const ms = SPEEDS[speedIndex].ms;
    intervalRef.current = setInterval(() => {
      setCurrentFrame(prev => {
        if (prev >= totalFrames - 1) {
          stopPlayback();
          return prev;
        }
        return prev + 1;
      });
    }, ms);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, speedIndex, totalFrames, stopPlayback]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [currentFrame]);

  // ── Handlers ────────────────────────────────────────────────────────

  const togglePlay = () => {
    if (currentFrame >= totalFrames - 1) setCurrentFrame(0);
    setPlaying(p => !p);
  };

  const stepBack = () => {
    stopPlayback();
    setCurrentFrame(prev => Math.max(0, prev - 1));
  };

  const stepForward = () => {
    stopPlayback();
    setCurrentFrame(prev => Math.min(totalFrames - 1, prev + 1));
  };

  const reset = () => {
    stopPlayback();
    setCurrentFrame(0);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (totalFrames === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const frame = Math.round(pct * (totalFrames - 1));
    stopPlayback();
    setCurrentFrame(frame);
  };

  // ── Filter sessions ─────────────────────────────────────────────────

  const filtered = searchFilter
    ? sessions.filter(s =>
        s.project.toLowerCase().includes(searchFilter.toLowerCase()) ||
        s.id.toLowerCase().includes(searchFilter.toLowerCase())
      )
    : sessions;

  // ── Annotation markers (tool calls) ─────────────────────────────────

  const toolCallFrames = visibleEntries
    .map((e, i) => (e.toolName ? i : -1))
    .filter(i => i >= 0);

  // ────────────────────────────────────────────────────────────────────
  // RENDER: Session Detail (Replay View)
  // ────────────────────────────────────────────────────────────────────

  if (selectedId) {
    if (detailLoading) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading session...
        </div>
      );
    }
    if (detailError) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-red-400">
          <AlertCircle className="h-6 w-6 mb-2" />
          <p className="text-sm">{detailError}</p>
          <button onClick={() => setSelectedId(null)} className="mt-3 text-xs text-blue-400 hover:underline">Back to list</button>
        </div>
      );
    }
    if (!detail) return null;

    const progressPct = totalFrames > 0 ? ((currentFrame + 1) / totalFrames) * 100 : 0;

    return (
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => { stopPlayback(); setSelectedId(null); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to sessions
          </button>
          <div className="text-xs text-muted-foreground">
            {detail.project}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          <SummaryCard label="Human Turns" value={detail.summary.userTurns} />
          <SummaryCard label="Assistant Turns" value={detail.summary.assistantTurns} />
          <SummaryCard label="Tool Calls" value={detail.summary.toolCalls} />
          <SummaryCard label="System" value={detail.summary.systemMessages} />
          <SummaryCard label="Progress" value={detail.summary.progressMessages} />
          {detail.summary.duration && <SummaryCard label="Duration" value={detail.summary.duration} />}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={reset} className="p-1.5 rounded hover:bg-muted transition-colors" title="Reset">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button onClick={stepBack} className="p-1.5 rounded hover:bg-muted transition-colors" title="Step back">
            <Rewind className="h-4 w-4" />
          </button>
          <button
            onClick={togglePlay}
            className="p-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button onClick={stepForward} className="p-1.5 rounded hover:bg-muted transition-colors" title="Step forward">
            <FastForward className="h-4 w-4" />
          </button>

          {/* Speed selector */}
          <div className="flex items-center gap-1 ml-2">
            {SPEEDS.map((s, i) => (
              <button
                key={s.label}
                onClick={() => setSpeedIndex(i)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  i === speedIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Frame counter */}
          <span className="text-xs text-muted-foreground ml-auto tabular-nums">
            {currentFrame + 1} / {totalFrames}
          </span>

          {/* Toggle progress messages */}
          <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showProgress}
              onChange={e => { setShowProgress(e.target.checked); setCurrentFrame(0); stopPlayback(); }}
              className="rounded"
            />
            Progress msgs
          </label>
        </div>

        {/* Progress bar with annotation markers */}
        <div
          className="relative h-3 bg-muted rounded cursor-pointer group"
          onClick={handleProgressClick}
        >
          <div
            className="absolute inset-y-0 left-0 bg-primary/70 rounded transition-[width] duration-100"
            style={{ width: `${progressPct}%` }}
          />
          {/* Tool call markers */}
          {toolCallFrames.map(fi => (
            <div
              key={fi}
              className="absolute top-0 bottom-0 w-0.5 bg-orange-400/80"
              style={{ left: `${(fi / Math.max(1, totalFrames - 1)) * 100}%` }}
              title={`Tool: ${visibleEntries[fi]?.toolName}`}
            />
          ))}
          {/* Hover indicator */}
          <div className="absolute inset-0 rounded group-hover:bg-white/5 transition-colors" />
        </div>

        {/* Terminal replay area */}
        <div
          ref={scrollRef}
          className="bg-gray-900 text-gray-100 font-mono text-sm p-4 rounded-lg overflow-y-auto border border-gray-700/50"
          style={{ maxHeight: 'calc(100vh - 380px)', minHeight: '300px' }}
        >
          {visibleEntries.slice(0, currentFrame + 1).map((entry) => (
            <div
              key={entry.index}
              className={`flex gap-2 py-1.5 px-2 border-l-2 mb-1 rounded-r ${roleBg(entry.role)} ${
                entry.index === visibleEntries[currentFrame]?.index ? 'bg-white/5' : ''
              }`}
            >
              {roleIcon(entry.role)}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                    entry.role === 'user' ? 'text-blue-400' :
                    entry.role === 'assistant' ? 'text-green-400' :
                    entry.role === 'progress' ? 'text-yellow-500' :
                    'text-gray-400'
                  }`}>
                    {roleLabel(entry.role)}
                  </span>
                  {entry.toolName && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 flex items-center gap-1">
                      <Wrench className="h-2.5 w-2.5" />
                      {entry.toolName}
                    </span>
                  )}
                  {entry.isSidechain && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">sidechain</span>
                  )}
                </div>
                <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-200 mt-0.5 max-h-40 overflow-y-auto">
                  {entry.content || '(empty)'}
                </pre>
              </div>
            </div>
          ))}
          {totalFrames === 0 && (
            <div className="text-gray-500 text-center py-8">No replay entries found in this session.</div>
          )}
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // RENDER: Session List
  // ────────────────────────────────────────────────────────────────────

  if (listLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Scanning sessions...
      </div>
    );
  }

  if (listError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-400">
        <AlertCircle className="h-6 w-6 mb-2" />
        <p className="text-sm">{listError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {total} session{total !== 1 ? 's' : ''} found across all projects
        </div>
        <input
          type="text"
          placeholder="Filter by project or ID..."
          value={searchFilter}
          onChange={e => setSearchFilter(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-md border bg-background text-foreground placeholder:text-muted-foreground w-64"
        />
      </div>

      {/* Sessions table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Project</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Session ID</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Modified</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Size</th>
              <th className="px-3 py-2 text-xs font-medium text-muted-foreground w-10"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground text-xs">
                  {searchFilter ? 'No sessions match your filter.' : 'No session files found.'}
                </td>
              </tr>
            )}
            {filtered.map(s => (
              <tr
                key={`${s.projectEncoded}/${s.id}`}
                onClick={() => setSelectedId(s.id)}
                className="border-b last:border-b-0 cursor-pointer hover:bg-muted/30 transition-colors"
              >
                <td className="px-3 py-2 font-mono text-xs truncate max-w-[250px]" title={s.project}>
                  {shortProject(s.project)}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground truncate max-w-[200px]" title={s.id}>
                  {s.id.slice(0, 8)}...
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                  {formatDate(s.modifiedAt)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground text-right tabular-nums">
                  {formatBytes(s.sizeBytes)}
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <AISessionButton
                    cwd={defaultCwd}
                    prompt={replayEntry(s.id, 'session', `Continue work from project: ${shortProject(s.project)}`)}
                    variant="icon-only"
                    size="icon"
                    tooltip="Continue Work"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Summary card ───────────────────────────────────────────────────────

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-muted/40 rounded-lg px-3 py-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
