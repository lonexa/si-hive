import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card } from '@hive/shared/components/ui/card';
import { Badge } from '@hive/shared/components/ui/badge';
import { Loader2, Search as SearchIcon, Sparkles, BookOpen, ClipboardList, Monitor, User } from 'lucide-react';
import { API_BASE } from '@/lib/api-config';

type Source = 'kb' | 'workitem' | 'session' | 'person';

interface SearchHit {
  source: Source;
  id: string;
  title: string;
  snippet: string;
  url?: string;
  badge?: string;
  date?: string;
}

interface SearchResults {
  query: string;
  kb: SearchHit[];
  workItems: SearchHit[];
  sessions: SearchHit[];
  people: SearchHit[];
  warnings: string[];
}

interface AskResult {
  question: string;
  answer: string | null;
  sources: Array<{ n: number; source: Source; title: string; url?: string }>;
  warnings: string[];
  note?: string;
}

const SOURCE_META: Record<Source, { label: string; icon: typeof BookOpen }> = {
  kb: { label: 'Knowledge Base', icon: BookOpen },
  workitem: { label: 'Work Items', icon: ClipboardList },
  session: { label: 'Sessions', icon: Monitor },
  person: { label: 'People', icon: User },
};

export default function SearchPage() {
  const [mode, setMode] = useState<'search' | 'ask'>('search');
  const [input, setInput] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [ask, setAsk] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults(null); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResults(await res.json() as SearchResults);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const runAsk = useCallback(async (q: string) => {
    if (q.trim().length < 3) return;
    setLoading(true);
    setError(null);
    setAsk(null);
    try {
      const res = await fetch(`${API_BASE}/api/search/ask`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAsk(await res.json() as AskResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Live search (debounced) in search mode.
  useEffect(() => {
    if (mode !== 'search') return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void runSearch(input), 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [input, mode, runSearch]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'ask') void runAsk(input);
    else void runSearch(input);
  };

  const groups: Array<[Source, SearchHit[]]> = results
    ? [['kb', results.kb], ['workitem', results.workItems], ['session', results.sessions], ['person', results.people]]
    : [];
  const totalHits = results ? results.kb.length + results.workItems.length + results.sessions.length + results.people.length : 0;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Search</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Across the Knowledge Base, work items, your sessions, and people — or ask a question and let SI Hive answer from them.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-1">
        {(['search', 'ask'] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(null); }}
            className={`text-xs px-3 py-1.5 rounded border flex items-center gap-1.5 ${mode === m ? 'border-foreground/60 bg-foreground/5 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {m === 'search' ? <SearchIcon className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {m === 'search' ? 'Search' : 'Ask SI Hive'}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={mode === 'ask' ? 'Ask a question, then press Enter…' : 'Search everything…'}
          className="w-full h-10 rounded-md border border-border bg-background pl-9 pr-10 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/30"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
      </form>

      {error && <div className="text-sm text-destructive">Failed: {error}</div>}

      {/* Ask mode */}
      {mode === 'ask' && ask && (
        <div className="space-y-3">
          {ask.note && <Card className="p-2.5 text-xs text-amber-500 border-amber-500/40">{ask.note}</Card>}
          {ask.answer && (
            <Card className="p-4 border-primary/30">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
                <Sparkles className="h-3.5 w-3.5" /> Answer
              </div>
              <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-ul:my-1">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{ask.answer}</ReactMarkdown>
              </div>
            </Card>
          )}
          {ask.sources.length > 0 && (
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Sources</div>
              <div className="space-y-1">
                {ask.sources.map((s) => {
                  const Icon = SOURCE_META[s.source].icon;
                  return (
                    <div key={s.n} className="flex items-center gap-2 text-sm">
                      <span className="text-[10px] font-mono text-muted-foreground w-5">[{s.n}]</span>
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {s.url
                        ? <Link to={s.url} className="truncate hover:underline">{s.title}</Link>
                        : <span className="truncate">{s.title}</span>}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          {ask.warnings.map((w, i) => <div key={i} className="text-xs text-amber-500">{w}</div>)}
        </div>
      )}

      {/* Search mode */}
      {mode === 'search' && results && (
        <div className="space-y-4">
          {results.warnings.map((w, i) => <div key={i} className="text-xs text-amber-500">{w}</div>)}
          {totalHits === 0 && !loading && input.trim().length >= 2 && (
            <div className="text-center py-10 text-sm text-muted-foreground">No results for “{results.query}”.</div>
          )}
          {groups.map(([source, hits]) => hits.length > 0 && (
            <div key={source}>
              <div className="flex items-center gap-1.5 mb-1.5">
                {(() => { const Icon = SOURCE_META[source].icon; return <Icon className="h-4 w-4 text-muted-foreground" />; })()}
                <h3 className="text-sm font-medium text-foreground">{SOURCE_META[source].label}</h3>
                <span className="text-xs text-muted-foreground">{hits.length}</span>
              </div>
              <div className="space-y-1.5">
                {hits.map((h) => <HitRow key={`${h.source}:${h.id}`} hit={h} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HitRow({ hit }: { hit: SearchHit }) {
  const body = (
    <div className="rounded-md border border-border bg-background p-2.5 hover:bg-accent/20 transition-colors">
      <div className="flex items-center gap-2">
        {hit.badge && <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">{hit.badge}</Badge>}
        <span className="text-sm font-medium text-foreground truncate">{hit.title}</span>
      </div>
      {hit.snippet && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{hit.snippet}</p>}
    </div>
  );
  return hit.url ? <Link to={hit.url} className="block">{body}</Link> : body;
}
