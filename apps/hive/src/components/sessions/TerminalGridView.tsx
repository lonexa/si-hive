import { useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLaunchFlags, getPrimaryProviderId, getProviderStatus, buildProviderFlags, type ProviderId } from '@/lib/launch-flags';
import GridCell from './GridCell';
import type { GridCell as GridCellType } from '@/stores/dashboard-store';
import { useDashboardStore } from '@/stores/dashboard-store';
import type { Session } from '@/stores/types';

interface TerminalGridViewProps {
  sessions: Session[];
  addSessionId?: string | null;
  onAddConsumed?: () => void;
}

function getGridClasses(count: number): string {
  if (count === 1) return 'grid-cols-1 grid-rows-1';
  if (count === 2) return 'grid-cols-2 grid-rows-1';
  if (count <= 4) return 'grid-cols-2 grid-rows-2';
  if (count <= 6) return 'grid-cols-3 grid-rows-2';
  return 'grid-cols-3 grid-rows-3';
}

export default function TerminalGridView({ sessions, addSessionId, onAddConsumed }: TerminalGridViewProps) {
  const navigate = useNavigate();
  const cells = useDashboardStore((s) => s.gridCells);
  const setCells = useDashboardStore((s) => s.setGridCells);
  const maximizedCellId = useDashboardStore((s) => s.gridMaximizedCellId);
  const setMaximizedCellId = useDashboardStore((s) => s.setGridMaximizedCellId);
  const projectsRoot = useDashboardStore((s) => s.projectsRoot);

  // Auto-assign from "Add to Grid" navigation
  useEffect(() => {
    if (!addSessionId) return;
    if (cells.some(c => c.sessionId === addSessionId)) {
      onAddConsumed?.();
      return;
    }
    const emptyCell = cells.find(c => c.sessionId === null && !c.cwd);
    if (emptyCell) {
      setCells(cells.map(c => c.id === emptyCell.id ? { ...c, sessionId: addSessionId } : c));
    } else if (cells.length < 9) {
      setCells([...cells, { id: crypto.randomUUID(), sessionId: addSessionId }]);
    }
    onAddConsumed?.();
  }, [addSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate grid cell assignments — clear sessionId for sessions that no longer exist
  useEffect(() => {
    if (sessions.length === 0) return;
    const sessionIds = new Set(sessions.map(s => s.id));
    const stale = cells.filter(c => c.sessionId && !sessionIds.has(c.sessionId));
    if (stale.length > 0) {
      setCells(cells.map(c =>
        c.sessionId && !sessionIds.has(c.sessionId)
          ? { ...c, sessionId: null }
          : c
      ));
    }
  }, [sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-link: associate a sessionId with spawn cells once the watcher detects a matching session.
  // Only sets sessionId — the terminal keeps running with the same PTY.
  useEffect(() => {
    if (sessions.length === 0) return;
    const unlinked = cells.filter(c => !c.sessionId && c.cwd);
    if (unlinked.length === 0) return;

    let changed = false;
    const updated = cells.map(c => {
      if (c.sessionId || !c.cwd) return c;
      const cellProvider = c.provider ?? 'claude';
      const match = sessions.find(s =>
        (s.status === 'working' || s.status === 'waiting-input' || s.status === 'waiting-approval') &&
        (s.cwd === c.cwd || s.projectDir === c.cwd) &&
        (s.provider ?? 'claude') === cellProvider
      );
      if (match) {
        changed = true;
        return { ...c, sessionId: match.id };
      }
      return c;
    });
    if (changed) setCells(updated);
  }, [sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  const parentSessions = useMemo(
    () => [...sessions]
      .filter(s => !s.isSubagent && (s.initialPrompt || s.latestPrompt || s.fileSize >= 2048))
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()),
    [sessions]
  );

  const addCell = () => {
    if (cells.length >= 9) return;
    setCells([...cells, { id: crypto.randomUUID(), sessionId: null }]);
  };

  const removeCell = (cellId: string) => {
    setCells(cells.filter(c => c.id !== cellId));
    if (maximizedCellId === cellId) setMaximizedCellId(null);
  };

  const setSessionForCell = (cellId: string, sessionId: string | null) => {
    setCells(cells.map(c => c.id === cellId ? { id: c.id, sessionId } : c));
  };

  const setProjectForCell = (cellId: string, projectPath: string) => {
    setCells(cells.map(c => c.id === cellId ? { id: c.id, sessionId: null, cwd: projectPath } : c));
  };

  const startNewSession = async (cellId: string, overrideProviderId?: ProviderId) => {
    const genericCwd = projectsRoot ? `${projectsRoot}/Generic` : '';
    const [flags, defaultProviderId, statuses] = await Promise.all([
      getLaunchFlags(), getPrimaryProviderId(), getProviderStatus(),
    ]);
    const providerId = overrideProviderId ?? defaultProviderId;
    const status = statuses.find(p => p.id === providerId);
    const command = status?.resolvedPath || providerId;
    const providerNames: Record<ProviderId, string> = { claude: 'Claude', gemini: 'Gemini', codex: 'Codex' };
    const providerArgs = buildProviderFlags(providerId, flags);
    setCells(cells.map(c => c.id === cellId ? {
      id: c.id,
      sessionId: null,
      cwd: genericCwd,
      command,
      args: providerArgs.length > 0 ? providerArgs : undefined,
      label: `Generic (${providerNames[providerId]})`,
      provider: providerId,
    } : c));
  };

  const launchReviewForCell = async (cellId: string, sourceCwd: string, reviewProviderId: ProviderId) => {
    const [flags, , statuses] = await Promise.all([
      getLaunchFlags(), getPrimaryProviderId(), getProviderStatus(),
    ]);
    const status = statuses.find(p => p.id === reviewProviderId);
    const command = status?.resolvedPath || reviewProviderId;
    const providerNames: Record<ProviderId, string> = { claude: 'Claude', gemini: 'Gemini', codex: 'Codex' };
    const providerArgs = buildProviderFlags(reviewProviderId, flags);
    const reviewPrompt = `Review the recent work in this project. Check the git log and recent changes for:\n1. Bugs or logic errors\n2. Code quality issues\n3. Security concerns\n4. Suggestions for improvement\n\nProvide a clear, actionable summary.`;
    const newCell: GridCellType = {
      id: crypto.randomUUID(),
      sessionId: null,
      cwd: sourceCwd,
      command,
      args: providerArgs.length > 0 ? providerArgs : undefined,
      label: `Review (${providerNames[reviewProviderId]})`,
      initialPrompt: reviewPrompt,
      provider: reviewProviderId,
    };
    if (cells.length < 9) {
      setCells([...cells, newCell]);
    } else {
      const emptyCell = cells.find(c => c.sessionId === null && !c.cwd);
      if (emptyCell) {
        setCells(cells.map(c => c.id === emptyCell.id ? { ...newCell, id: c.id } : c));
      } else {
        setCells(cells.map(c => c.id === cellId ? { ...newCell, id: c.id } : c));
      }
    }
  };

  const displayCount = maximizedCellId ? 1 : cells.length;

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <button
          onClick={addCell}
          disabled={cells.length >= 9}
          className={cn(
            'flex items-center gap-1 text-xs px-2 py-1 rounded border border-border transition-colors',
            cells.length >= 9 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent/50 cursor-pointer'
          )}
        >
          <Plus className="h-3 w-3" />
          Add terminal
        </button>
        <span className="text-xs text-muted-foreground">
          {cells.length} terminal{cells.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Grid */}
      <div className={cn(
        'grid gap-2 h-[calc(100vh-200px)]',
        getGridClasses(displayCount)
      )}>
        {cells.map(cell => {
          const isMaximized = maximizedCellId === cell.id;
          const isHidden = maximizedCellId !== null && !isMaximized;

          const assignedIds = cells.filter(c => c.id !== cell.id).map(c => c.sessionId).filter(Boolean) as string[];
          const availableSessions = parentSessions.filter(s => !assignedIds.includes(s.id));

          return (
            <div
              key={cell.id}
              className={cn(
                isHidden && 'hidden',
                isMaximized && 'col-span-full row-span-full'
              )}
            >
              <GridCell
                cellId={cell.id}
                sessionId={cell.sessionId}
                cell={cell}
                sessions={sessions}
                availableSessions={availableSessions}
                maximized={isMaximized}
                canClose={cells.length > 1}
                onSelectSession={(id) => setSessionForCell(cell.id, id)}
                onSelectProject={(path) => setProjectForCell(cell.id, path)}
                onNewSession={(providerId?: ProviderId) => startNewSession(cell.id, providerId)}
                onReviewWithAI={(cwd: string, providerId: ProviderId) => launchReviewForCell(cell.id, cwd, providerId)}
                onMaximize={() => {
                  if (cell.sessionId) {
                    navigate(`/sessions/${cell.sessionId}`);
                  } else if (cell.cwd) {
                    const match = sessions.find(s =>
                      s.cwd === cell.cwd || s.projectDir === cell.cwd
                    );
                    if (match) {
                      navigate(`/sessions/${match.id}`);
                      return;
                    }
                    setMaximizedCellId(cell.id);
                  } else {
                    setMaximizedCellId(cell.id);
                  }
                }}
                onRestore={() => setMaximizedCellId(null)}
                onRemove={() => removeCell(cell.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
