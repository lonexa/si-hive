import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GitMerge, XCircle, ExternalLink, Sparkles, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { timeAgo, cn } from '@/lib/utils';
import { api, readLocal, writeLocal, type BuildFailuresFeed, type LandedFeed, type WorkStatus } from './delivery-api';
import { EmptyState, ErrorBanner, LoadingRow, Markdown, Warnings } from './DeliveryShared';

const DAY_OPTIONS = [1, 7, 14, 30] as const;
const DAYS_KEY = 'hive-main-feed-days';
const AI_KEY = 'hive-main-feed-ai';

export default function MainFeedPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'builds' ? 'builds' : 'landed';
  const [days, setDays] = useState<number>(() => {
    const saved = Number(readLocal(DAYS_KEY));
    return (DAY_OPTIONS as readonly number[]).includes(saved) ? saved : 7;
  });
  const [ai, setAi] = useState(() => readLocal(AI_KEY) === '1');
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<WorkStatus>('/api/work/status').then((s) => setAiAvailable(s.ai)).catch(() => setAiAvailable(false));
  }, []);

  const pickDays = (d: number) => { setDays(d); writeLocal(DAYS_KEY, String(d)); };
  const toggleAi = (on: boolean) => { setAi(on); writeLocal(AI_KEY, on ? '1' : '0'); };
  const aiOn = ai && aiAvailable === true;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">What Landed</h1>
          <p className="text-sm text-muted-foreground mt-0.5">What merged to the default branch across your repos, and which builds are failing.</p>
        </div>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setReload((n) => n + 1)}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setSearchParams({ tab: v }, { replace: true })}>
          <TabsList>
            <TabsTrigger value="landed">What landed</TabsTrigger>
            <TabsTrigger value="builds">Build failures</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => pickDays(d)}
                className={cn(
                  'text-xs px-2.5 py-1.5 rounded border',
                  days === d ? 'border-foreground/60 bg-foreground/5 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {d === 1 ? '24h' : `${d}d`}
              </button>
            ))}
          </div>
          <label
            className={cn('flex items-center gap-2 text-xs', aiAvailable === false ? 'text-muted-foreground/60' : 'text-muted-foreground')}
            title={aiAvailable === false ? 'Configure an AI backend in Settings to enable AI summaries' : undefined}
          >
            <Switch checked={aiOn} disabled={aiAvailable !== true} onCheckedChange={toggleAi} />
            <Sparkles className="h-3.5 w-3.5" /> {tab === 'landed' ? 'AI highlights' : 'AI triage'}
          </label>
        </div>
      </div>

      {tab === 'landed'
        ? <LandedTab days={days} ai={aiOn} reload={reload} />
        : <BuildsTab days={days} ai={aiOn} reload={reload} />}
    </div>
  );
}

function useFeed<T>(path: string, reload: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, reload]);
  return { data, loading, error };
}

function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function LandedTab({ days, ai, reload }: { days: number; ai: boolean; reload: number }) {
  const { data, loading, error } = useFeed<LandedFeed>(`/api/delivery/landed?days=${days}&ai=${ai ? 1 : 0}`, reload);

  if (error) return <ErrorBanner error={error} />;
  if (!data || (loading && data.days.length === 0)) return <LoadingRow label={ai ? 'Loading commits and AI highlights…' : 'Loading…'} />;

  const total = data.days.reduce((n, d) => n + d.commits.length, 0);

  return (
    <div className={cn('space-y-4', loading && 'opacity-60 transition-opacity')}>
      {ai && data.highlights && (
        <Card className="p-4 space-y-2 border-primary/30">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Highlights
          </div>
          <Markdown text={data.highlights} />
        </Card>
      )}

      {total === 0 ? (
        <EmptyState icon={GitMerge} title={`Nothing landed in the last ${days === 1 ? '24 hours' : `${days} days`}`} showSettingsLink={data.warnings.length === 0}>
          Commits appear here for local checkouts of repositories hosted on a connected git host.
        </EmptyState>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">{total} commit{total === 1 ? '' : 's'} across {new Set(data.days.flatMap((d) => d.commits.map((c) => c.repo))).size} repo(s)</div>
          {data.days.map((day) => (
            <section key={day.date} className="space-y-1.5">
              <h3 className="text-xs font-semibold text-muted-foreground">{formatDay(day.date)} <span className="font-normal">· {day.commits.length}</span></h3>
              <Card className="p-0 overflow-hidden">
                {day.commits.map((c) => (
                  <div key={`${c.connectionId}:${c.repo}:${c.sha}`} className="px-3 py-2 flex items-center gap-3 border-b border-border last:border-b-0">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground shrink-0 max-w-[12rem] truncate" title={c.repo}>
                      {c.repo.split('/').pop()}
                    </Badge>
                    <span className="text-sm text-foreground truncate flex-1" title={c.message}>{c.message.split(/\r?\n/)[0]}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0 max-w-[9rem] truncate">{c.author?.name ?? 'unknown'}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0 w-14 text-right" title={new Date(c.date).toLocaleString()}>{timeAgo(c.date)}</span>
                    {c.url
                      ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-primary hover:underline shrink-0 w-14 text-right">
                          {c.sha.slice(0, 7)}
                        </a>
                      )
                      : <span className="font-mono text-[11px] text-muted-foreground shrink-0 w-14 text-right">{c.sha.slice(0, 7)}</span>}
                  </div>
                ))}
              </Card>
            </section>
          ))}
        </>
      )}

      <Warnings warnings={data.warnings} />
    </div>
  );
}

function BuildsTab({ days, ai, reload }: { days: number; ai: boolean; reload: number }) {
  const { data, loading, error } = useFeed<BuildFailuresFeed>(`/api/delivery/build-failures?days=${days}&ai=${ai ? 1 : 0}`, reload);

  if (error) return <ErrorBanner error={error} />;
  if (!data || (loading && data.failures.length === 0)) return <LoadingRow label={ai ? 'Loading failures and AI triage…' : 'Loading…'} />;

  return (
    <div className={cn('space-y-3', loading && 'opacity-60 transition-opacity')}>
      {data.failures.length === 0 ? (
        <EmptyState icon={XCircle} title={`No failed builds in the last ${days === 1 ? '24 hours' : `${days} days`}`}>
          Failed CI runs show up here for local checkouts of repositories on git hosts that report builds.
        </EmptyState>
      ) : (
        data.failures.map((f) => (
          <Card key={f.id} className="p-3 space-y-2">
            <div className="flex items-start gap-2">
              <XCircle className="h-4 w-4 text-status-red shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{f.definition}</div>
                <div className="text-[11px] text-muted-foreground font-mono truncate">{f.buildNumber}</div>
              </div>
              <span className="text-[11px] text-muted-foreground shrink-0" title={new Date(f.finishTime).toLocaleString()}>{timeAgo(f.finishTime)}</span>
              {f.url && (
                <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 shrink-0">
                  <a href={f.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Open</a>
                </Button>
              )}
            </div>
            {f.triage && (
              <div className="ml-6 rounded-md border border-border bg-muted/30 p-2.5 space-y-1">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Sparkles className="h-3 w-3" /> Triage
                </div>
                <Markdown text={f.triage} className="text-xs" />
              </div>
            )}
          </Card>
        ))
      )}
      {ai && data.failures.length > 5 && (
        <div className="text-[11px] text-muted-foreground">AI triage covers the 5 most recent failures.</div>
      )}
      <Warnings warnings={data.warnings} />
    </div>
  );
}
