import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUpDown, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { PromptEntry } from '@/stores/types';
import { useDashboardStore } from '@/stores/dashboard-store';
import { cn } from '@/lib/utils';

interface PromptHistoryProps {
  entries: PromptEntry[];
}

type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'This Month' | 'Older';

function getDateGroup(timestamp: number): DateGroup {
  const now = new Date();
  const date = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const monthAgo = new Date(today.getTime() - 30 * 86400000);

  if (date >= today) return 'Today';
  if (date >= yesterday) return 'Yesterday';
  if (date >= weekAgo) return 'This Week';
  if (date >= monthAgo) return 'This Month';
  return 'Older';
}

function projectName(projectPath: string): string {
  const parts = projectPath.split('/');
  return parts[parts.length - 1] || projectPath;
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_COLORS: Record<string, string> = {
  working: 'bg-status-green',
  'waiting-approval': 'bg-yellow-500',
  'waiting-input': 'bg-yellow-500',
  done: 'bg-status-done',
  paused: 'bg-orange-400',
  idle: 'bg-zinc-500',
  error: 'bg-status-red',
};

export default function PromptHistory({ entries }: PromptHistoryProps) {
  const [search, setSearch] = useState('');
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessions = useDashboardStore((s) => s.sessions);
  const navigate = useNavigate();

  // Build session lookup by ID
  const sessionMap = useMemo(() => {
    const map = new Map<string, { slug?: string; status: string }>();
    for (const s of sessions) {
      map.set(s.id, { slug: s.slug, status: s.status });
    }
    return map;
  }, [sessions]);

  const projects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      const name = projectName(e.project);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [entries]);

  const filtered = useMemo(() => {
    let result = entries;
    if (activeProject) {
      result = result.filter((e) => projectName(e.project) === activeProject);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) => e.display.toLowerCase().includes(q));
    }
    return result;
  }, [entries, search, activeProject]);

  const sortedFiltered = useMemo(() => {
    const result = sortOrder === 'oldest' ? [...filtered].reverse() : filtered;
    return result;
  }, [filtered, sortOrder]);

  const itemsWithHeaders = useMemo(() => {
    const items: Array<{ type: 'header'; label: DateGroup } | { type: 'entry'; entry: PromptEntry }> = [];
    let lastGroup: DateGroup | null = null;
    for (const entry of sortedFiltered) {
      const group = getDateGroup(entry.timestamp);
      if (group !== lastGroup) {
        items.push({ type: 'header', label: group });
        lastGroup = group;
      }
      items.push({ type: 'entry', entry });
    }
    return items;
  }, [sortedFiltered]);

  const virtualizer = useVirtualizer({
    count: itemsWithHeaders.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => itemsWithHeaders[index]?.type === 'header' ? 36 : 80,
    overscan: 15,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search prompts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <button
          onClick={() => setSortOrder(s => s === 'newest' ? 'oldest' : 'newest')}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border"
        >
          <ArrowUpDown className="h-3 w-3" />
          {sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
        </button>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length} of {entries.length}
        </span>
      </div>

      {/* Project filter badges — show top 5, collapse the rest */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant={activeProject === null ? 'default' : 'outline'}
          className="cursor-pointer text-xs"
          onClick={() => setActiveProject(null)}
        >
          All
        </Badge>
        {(showAllProjects ? projects : projects.slice(0, 5)).map(({ name, count }) => (
          <Badge
            key={name}
            variant={activeProject === name ? 'default' : 'outline'}
            className="cursor-pointer text-xs"
            onClick={() => setActiveProject(activeProject === name ? null : name)}
          >
            {name} ({count})
          </Badge>
        ))}
        {projects.length > 5 && (
          <button
            onClick={() => setShowAllProjects(!showAllProjects)}
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded border border-border"
          >
            {showAllProjects ? (
              <><ChevronDown className="h-3 w-3" /> Less</>
            ) : (
              <><ChevronRight className="h-3 w-3" /> +{projects.length - 5} more</>
            )}
          </button>
        )}
      </div>

      {/* Virtual scrolled list */}
      <div ref={scrollRef} className="h-[calc(100vh-320px)] overflow-auto rounded-md border border-border">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const item = itemsWithHeaders[vRow.index];

            if (item.type === 'header') {
              return (
                <div
                  key={vRow.key}
                  ref={virtualizer.measureElement}
                  data-index={vRow.index}
                  className="absolute left-0 right-0 sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-2"
                  style={{ transform: `translateY(${vRow.start}px)` }}
                >
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {item.label}
                  </span>
                </div>
              );
            }

            const entry = item.entry;
            const session = sessionMap.get(entry.sessionId);
            return (
              <div
                key={vRow.key}
                ref={virtualizer.measureElement}
                data-index={vRow.index}
                className="absolute left-0 right-0 border-b border-border/50 cursor-pointer hover:bg-accent/50 transition-colors"
                style={{ transform: `translateY(${vRow.start}px)` }}
                onClick={() => entry.sessionId && navigate(`/sessions/${entry.sessionId}`)}
              >
                <Card className="border-0 rounded-none shadow-none">
                  <CardContent className="px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-relaxed line-clamp-2">{entry.display}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {session ? (
                            <>
                              <div className="flex items-center gap-1.5">
                                <div className={cn('h-1.5 w-1.5 rounded-full shrink-0', STATUS_COLORS[session.status] ?? 'bg-muted-foreground')} />
                                <span className="text-[10px] text-muted-foreground">{session.status}</span>
                              </div>
                              {session.slug && (
                                <span className="text-[10px] text-muted-foreground/70 truncate max-w-48">
                                  {session.slug}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/50">
                              {entry.sessionId?.slice(0, 8) ?? '—'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {formatTimestamp(entry.timestamp)}
                        </span>
                        <div className="flex items-center gap-1">
                          {entry.provider && entry.provider !== 'claude' && (
                            <span className={cn(
                              'text-[9px] font-mono font-bold px-1 py-0 rounded shrink-0',
                              entry.provider === 'gemini' && 'bg-blue-500/20 text-blue-400',
                              entry.provider === 'codex' && 'bg-green-500/20 text-green-400',
                            )}>
                              {entry.provider === 'gemini' ? 'Gemini' : 'Codex'}
                            </span>
                          )}
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {projectName(entry.project)}
                          </Badge>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(entry.display);
                          setCopiedId(entry.sessionId + entry.timestamp);
                          setTimeout(() => setCopiedId(null), 1500);
                        }}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1"
                        title="Copy prompt"
                      >
                        {copiedId === entry.sessionId + entry.timestamp ? (
                          <Check className="h-3.5 w-3.5 text-status-green" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
