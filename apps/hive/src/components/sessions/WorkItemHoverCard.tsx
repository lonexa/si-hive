import { useEffect, useState } from 'react';
import { Bug, CheckSquare, BookOpen, FileText, Loader2, AlertCircle } from 'lucide-react';
import { fetchWorkItemCard as fetchCard, getCachedWorkItem, type WorkItemCardData } from './work-item-fetch';

export type { WorkItemCardData };

/** Hook: fetches a card by ID with built-in caching + loading/error state. */
export function useWorkItemCard(id: string | null): {
  card: WorkItemCardData | null;
  loading: boolean;
  error: boolean;
} {
  const [card, setCard] = useState<WorkItemCardData | null>(
    id !== null ? getCachedWorkItem(id) : null,
  );
  const [loading, setLoading] = useState(id !== null && getCachedWorkItem(id) === null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (id === null) return;
    const cached = getCachedWorkItem(id);
    if (cached) {
      setCard(cached);
      setLoading(false);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchCard(id).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result) {
        setCard(result);
      } else {
        setCard(null);
        setError(true);
      }
    });
    return () => { cancelled = true; };
  }, [id]);

  return { card, loading, error };
}

/** Pick an icon component based on the work-item type. */
function iconForType(type: string) {
  const t = type.toLowerCase();
  if (t.includes('bug')) return Bug;
  if (t.includes('task')) return CheckSquare;
  if (t.includes('story') || t.includes('feature')) return BookOpen;
  if (t.includes('epic')) return BookOpen;
  if (t === 'issue' || t.includes('issue')) return AlertCircle;
  return FileText;
}

/** Map the work-item type to a tint color. */
function typeTint(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('bug')) return 'text-red-300';
  if (t.includes('task')) return 'text-blue-300';
  if (t.includes('story') || t.includes('feature')) return 'text-violet-300';
  if (t.includes('epic')) return 'text-amber-300';
  return 'text-zinc-300';
}

/** Map common state strings to a colored badge. */
function stateBadgeClasses(state: string): string {
  const s = state.toLowerCase();
  if (s === 'closed' || s === 'done' || s === 'resolved') return 'bg-green-500/15 text-green-300 ring-green-400/40';
  if (s === 'active' || s === 'in progress' || s.includes('progress')) return 'bg-blue-500/15 text-blue-300 ring-blue-400/40';
  if (s === 'new' || s === 'to do' || s === 'open') return 'bg-zinc-500/15 text-zinc-300 ring-zinc-400/40';
  if (s.includes('block')) return 'bg-amber-500/15 text-amber-300 ring-amber-400/40';
  if (s.includes('review')) return 'bg-violet-500/15 text-violet-300 ring-violet-400/40';
  if (s.includes('removed') || s.includes('cancel')) return 'bg-zinc-700/30 text-zinc-500 ring-zinc-600/40';
  return 'bg-zinc-500/15 text-zinc-300 ring-zinc-400/40';
}

/** Format a YYYY-MM-DD or ISO date as "May 12". */
function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

interface WorkItemHoverCardProps {
  id: string;
  /** Pixel position of the bottom-left corner of the card. */
  anchor: { x: number; y: number };
  onClose: () => void;
}

/**
 * Floating card that hovers near the matched work-item mention in the
 * terminal. Self-contained: fetches its own data, renders loading and
 * error states. Stays open while the cursor is over it (parent handles
 * the show/hide lifecycle).
 */
export default function WorkItemHoverCard({ id, anchor, onClose }: WorkItemHoverCardProps) {
  const { card, loading, error } = useWorkItemCard(id);

  // Choose icon + tint outside the JSX so the loading/error states can
  // still show *something* identifiable (just the ID + a generic icon).
  const Icon = card ? iconForType(card.type) : FileText;
  const tint = card ? typeTint(card.type) : 'text-zinc-400';

  // Cap the card to viewport width so very long titles don't push offscreen.
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(anchor.x, window.innerWidth - 380),
    top: Math.max(anchor.y - 4, 8),
    transform: 'translateY(-100%)',
    maxWidth: 380,
    zIndex: 60,
  };

  function handleOpen() {
    if (card?.url) {
      window.open(card.url, '_blank', 'noopener,noreferrer');
    }
    onClose();
  }

  return (
    <div
      style={style}
      className="pointer-events-auto w-80 cursor-pointer rounded-md border border-zinc-700 bg-zinc-900/95 p-3 text-sm text-zinc-100 shadow-2xl backdrop-blur-sm"
      onClick={handleOpen}
      role="link"
      aria-label={card ? `Open ticket ${id}: ${card.title}` : `Ticket ${id}`}
    >
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tint}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            <span>{id}</span>
            {card && <span className="text-zinc-600">·</span>}
            {card && <span>{card.type}</span>}
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          </div>
          <div className="mt-0.5 text-sm font-medium text-zinc-100 leading-snug line-clamp-3">
            {card?.title ?? (error ? 'Work item not found or inaccessible' : loading ? 'Loading…' : '')}
          </div>
        </div>
      </div>

      {card && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${stateBadgeClasses(card.state)}`}>
              {card.state}
            </span>
            {card.priority && (
              <span className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] text-zinc-300 ring-1 ring-zinc-600/40">
                {card.priority}
              </span>
            )}
            {card.assignedTo?.displayName && (
              <span className="text-[11px] text-zinc-400">
                {card.assignedTo.displayName}
              </span>
            )}
            {card.changedDate && (
              <span className="ml-auto text-[10px] text-zinc-500">
                {shortDate(card.changedDate)}
              </span>
            )}
          </div>
          {card.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {card.tags.slice(0, 5).map((t) => (
                <span key={t} className="rounded bg-zinc-700/30 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  {t}
                </span>
              ))}
            </div>
          )}
          {card.iterationPath && (
            <div className="mt-2 text-[10px] text-zinc-500 truncate" title={card.iterationPath}>
              {card.iterationPath}
            </div>
          )}
        </>
      )}

      <div className="mt-2 border-t border-zinc-800 pt-1.5 text-[10px] text-zinc-500">
        Click to open in your tracker
      </div>
    </div>
  );
}
