import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, AlertTriangle, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { PullRequestState, StateCategory } from './delivery-api';

const MD_CLASSES =
  'text-sm text-foreground/90 break-words [&_pre]:bg-background [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_a]:text-primary [&_a]:underline [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_th]:border [&_th]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:border [&_td]:border-border [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 [&_li]:mb-0.5 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_img]:max-w-full';

const HTML_HINT = /<(p|div|br|span|ul|ol|li|table|tr|td|h[1-6]|strong|em|b|i|a)(\s[^>]*)?\/?>/i;

/** Flatten HTML to readable plain text without ever injecting it into the DOM. */
function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Renders tracker / git-host text: markdown normally, plain text when the provider handed back HTML. */
export function Markdown({ text, className }: { text?: string | null; className?: string }) {
  if (!text?.trim()) return null;
  if (HTML_HINT.test(text)) {
    return <div className={cn('text-sm text-foreground/90 whitespace-pre-wrap break-words', className)}>{htmlToText(text)}</div>;
  }
  return (
    <div className={cn(MD_CLASSES, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const ISSUE_STATE_CLS: Record<StateCategory, string> = {
  todo: 'text-muted-foreground border-border',
  in_progress: 'text-status-blue border-status-blue/40',
  done: 'text-status-green border-status-green/40',
};

export function IssueStateBadge({ state, category }: { state: string; category: StateCategory }) {
  return (
    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 font-medium whitespace-nowrap', ISSUE_STATE_CLS[category])}>
      {state}
    </Badge>
  );
}

const PR_STATE_CLS: Record<PullRequestState, string> = {
  open: 'text-status-green border-status-green/40',
  draft: 'text-muted-foreground border-border',
  merged: 'text-purple-400 border-purple-400/40',
  closed: 'text-status-red border-status-red/40',
};

export function PrStateBadge({ state }: { state: PullRequestState }) {
  return (
    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 font-medium capitalize', PR_STATE_CLS[state])}>
      {state}
    </Badge>
  );
}

export function LoadingRow({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Card className="p-3 text-sm text-destructive border-destructive/40 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> <span className="break-words">{error}</span>
    </Card>
  );
}

/** Per-repo fetch problems from the feeds — shown quietly so one bad repo doesn't dominate the page. */
export function Warnings({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) return null;
  return (
    <details className="text-[11px] text-amber-500/80">
      <summary className="cursor-pointer select-none">{warnings.length} warning{warnings.length === 1 ? '' : 's'}</summary>
      <ul className="mt-1 space-y-0.5 pl-4 list-disc">
        {warnings.map((w, i) => <li key={i} className="break-words">{w}</li>)}
      </ul>
    </details>
  );
}

export function EmptyState({ icon: Icon, title, children, showSettingsLink = false }: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  showSettingsLink?: boolean;
}) {
  return (
    <Card className="p-8 flex flex-col items-center text-center gap-3">
      <Icon className="h-8 w-8 text-muted-foreground" />
      <div className="text-sm font-medium text-foreground">{title}</div>
      {children && <div className="text-sm text-muted-foreground max-w-md">{children}</div>}
      {showSettingsLink && (
        <Button asChild size="sm" variant="outline">
          <Link to="/settings?tab=integrations">Open integration settings</Link>
        </Button>
      )}
    </Card>
  );
}

export function PersonName({ person, fallback = 'Unassigned' }: { person?: { name: string } | null; fallback?: string }) {
  return <span className={person ? '' : 'italic'}>{person?.name || fallback}</span>;
}
