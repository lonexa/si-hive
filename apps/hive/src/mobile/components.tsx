import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn, getSessionDisplayName, shortProject, timeAgo } from '@/lib/utils';
import { formatModelDisplay } from '@/lib/launch-flags';
import ActivityLine from '@/components/shared/ActivityLine';
import type { Session, SessionActivity } from '@/stores/types';
import { statusDotClass } from './mobile-data';

/** Folder name the session runs in (the aggregator's project label can be a mangled dir name). */
export function sessionProjectName(s: Session): string | null {
  const dir = s.cwd || s.projectDir;
  if (dir && /[\\/]/.test(dir)) return dir.split(/[\\/]/).filter(Boolean).pop() ?? null;
  return s.project && s.project !== 'unknown' ? shortProject(s.project) : null;
}

/** Small uppercase heading above a group of rows. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-1.5 mt-4 flex items-center justify-between px-1">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
      {action}
    </div>
  );
}

/** Rounded group that holds list rows separated by hairlines. */
export function RowGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-card divide-y divide-border', className)}>
      {children}
    </div>
  );
}

/** Tappable navigation row: icon, label, optional detail and chevron. */
export function LinkRow({ to, icon: Icon, label, detail, trailing, onClick }: {
  to?: string;
  icon?: LucideIcon;
  label: string;
  detail?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      {Icon && <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">{label}</div>
        {detail && <div className="truncate text-xs text-muted-foreground">{detail}</div>}
      </div>
      {trailing}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    </>
  );
  const cls = 'flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left active:bg-accent';
  if (to) return <Link to={to} className={cls}>{body}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

/** One-line pill filter. */
export function Chip({ active, onClick, children, className }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground active:bg-accent',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Horizontal strip of chips (scrolls sideways only if it has to). */
export function ChipRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3', className)}>{children}</div>;
}

export function EmptyState({ icon: Icon, title, hint, action }: { icon?: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center">
      {Icon && <Icon className="h-7 w-7 text-muted-foreground/60" />}
      <p className="text-sm text-foreground">{title}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}

/** Session list row: status, title, project/model, and what it's doing now. */
export function SessionRow({ session, activity, teamInfo, subCount, trailing }: {
  session: Session;
  activity?: SessionActivity;
  teamInfo?: { teamName: string; memberName: string } | null;
  subCount?: number;
  trailing?: ReactNode;
}) {
  const meta = [
    sessionProjectName(session),
    session.gitBranch && session.gitBranch !== 'main' && session.gitBranch !== 'master' ? session.gitBranch : null,
    session.model ? formatModelDisplay(session.provider, session.model) : null,
    subCount ? `+${subCount} agent${subCount > 1 ? 's' : ''}` : null,
  ].filter(Boolean);

  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <Link to={`/sessions/${session.id}`} className="flex min-w-0 flex-1 items-start gap-3 active:opacity-70">
        <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', statusDotClass(session.status))} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium text-foreground">
              {getSessionDisplayName(session, teamInfo, 120)}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(session.lastActivity)}</span>
          </div>
          {meta.length > 0 && <div className="truncate text-xs text-muted-foreground">{meta.join(' · ')}</div>}
          {activity?.active && (
            <div className="mt-0.5 min-w-0 overflow-hidden text-xs">
              <ActivityLine activity={activity} />
            </div>
          )}
        </div>
      </Link>
      {trailing}
    </div>
  );
}

/** Wraps a desktop page or tab shown in the phone UI (see mobile.css). */
export function Compat({ children }: { children: ReactNode }) {
  return <div className="mobile-compat">{children}</div>;
}

/** Equal-width segmented control for a page's sub-views; never scrolls sideways. */
export function Segmented<T extends string>({ options, value, onChange }: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 min-w-0 flex-1 truncate rounded-md px-1 text-xs font-medium transition-colors',
            value === o.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
