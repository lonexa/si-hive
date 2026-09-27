import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, EyeOff, FolderOpen, Play, Search, SlidersHorizontal } from 'lucide-react';
import { cn, timeAgo } from '@/lib/utils';
import { PROVIDER_SHORT_NAMES, type CodexReasoningEffort, type ProviderId } from '@/lib/launch-flags';
import { useAISession } from '@/hooks/useAISession';
import { useIncognito } from '@/hooks/useIncognito';
import GenericLaunchDialog from '@/components/shared/GenericLaunchDialog';
import { Chip, ChipRow, SectionTitle } from './components';
import { byRecent, useProjects, useProviders } from './use-projects';

const PICKER_LIMIT = 8;
/**
 * Tag this history entry as used, without a navigation, so coming back to it
 * (back from the new session) skips the form. Tapping New again creates a
 * fresh entry without the tag.
 */
function markLaunched() {
  const st = (window.history.state ?? {}) as { usr?: Record<string, unknown> };
  window.history.replaceState({ ...st, usr: { ...(st.usr ?? {}), launched: true } }, '');
}

export default function MobileNewSessionPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { projects } = useProjects();
  const { providers, primary } = useProviders();
  const { launchSession } = useAISession();
  const { canToggle, isProjectIncognito } = useIncognito();

  const [cwd, setCwd] = useState<string | null>(searchParams.get('cwd'));
  const [picking, setPicking] = useState(!searchParams.get('cwd'));
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [prompt, setPrompt] = useState('');
  const [incognito, setIncognito] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const launched = (location.state as { launched?: boolean } | null)?.launched;
  useEffect(() => {
    if (launched) navigate('/sessions', { replace: true });
  }, [launched, navigate]);

  useEffect(() => {
    if (!provider) setProvider(primary);
  }, [primary, provider]);

  const selected = projects.find((p) => p.path === cwd);
  const projectIncognito = cwd ? isProjectIncognito(cwd) : false;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...projects].sort(byRecent).filter((p) => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
    return showAll || q ? list : list.slice(0, PICKER_LIMIT);
  }, [projects, query, showAll]);

  const start = () => {
    if (!cwd || starting) return;
    setStarting(true);
    markLaunched();
    void launchSession({ cwd, prompt: prompt.trim(), providerId: provider ?? undefined, incognito: incognito && !projectIncognito });
  };

  const launchAdvanced = (
    finalPrompt: string,
    projectDir: string,
    providerId?: ProviderId,
    options?: { model?: string; reasoningEffort?: CodexReasoningEffort; accountId?: string },
  ) => {
    setAdvancedOpen(false);
    markLaunched();
    void launchSession({
      cwd: projectDir,
      prompt: finalPrompt,
      providerId: providerId ?? provider ?? undefined,
      model: options?.model,
      reasoningEffort: options?.reasoningEffort,
      accountId: options?.accountId,
      incognito: incognito && !projectIncognito,
    });
  };

  return (
    <div className="flex min-h-full flex-col">
      <SectionTitle>Project</SectionTitle>
      {!picking && cwd ? (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex w-full items-center gap-3 rounded-xl border border-primary/50 bg-card px-3 py-2.5 text-left"
        >
          <FolderOpen className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{selected?.name ?? cwd.split(/[\\/]/).pop()}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">{cwd}</div>
          </div>
          <span className="shrink-0 text-xs text-primary">Change</span>
        </button>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a project"
              className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-3 text-base text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
            />
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
            {matches.map((p) => (
              <button
                key={p.path}
                type="button"
                onClick={() => { setCwd(p.path); setPicking(false); }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-accent"
              >
                <FolderOpen className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{p.name}</span>
                {p.lastActivity && <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(p.lastActivity)}</span>}
                {p.path === cwd && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            ))}
            {matches.length === 0 && <div className="px-3 py-4 text-center text-xs text-muted-foreground">No matching projects</div>}
          </div>
          {!showAll && !query && projects.length > PICKER_LIMIT && (
            <button type="button" onClick={() => setShowAll(true)} className="w-full py-1 text-center text-xs text-primary">
              Show all {projects.length} projects
            </button>
          )}
        </div>
      )}

      {providers.length > 1 && (
        <>
          <SectionTitle>AI</SectionTitle>
          <ChipRow>
            {providers.map((p) => (
              <Chip key={p.id} active={provider === p.id} onClick={() => setProvider(p.id)}>
                {p.displayName || PROVIDER_SHORT_NAMES[p.id]}
              </Chip>
            ))}
          </ChipRow>
        </>
      )}

      <SectionTitle>First message (optional)</SectionTitle>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        placeholder="What should it work on?"
        className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-base text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
      />

      {canToggle && !projectIncognito && (
        <button
          type="button"
          onClick={() => setIncognito(!incognito)}
          className={cn('mt-2 flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-xs', incognito ? 'border-violet-500/60 text-violet-300' : 'border-border text-muted-foreground')}
        >
          <EyeOff className="h-3.5 w-3.5" /> Incognito {incognito ? 'on' : 'off'}
        </button>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={!cwd}
          onClick={() => setAdvancedOpen(true)}
          aria-label="More launch options"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border text-foreground disabled:opacity-40"
        >
          <SlidersHorizontal className="h-5 w-5" />
        </button>
        <button
          type="button"
          disabled={!cwd || starting}
          onClick={start}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-base font-medium text-primary-foreground disabled:opacity-40"
        >
          <Play className="h-4 w-4" /> {starting ? 'Starting…' : 'Start session'}
        </button>
      </div>

      {cwd && (
        <GenericLaunchDialog
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          label="Start AI Session"
          subtitle={selected?.name}
          suggestedPrompt={prompt}
          projectDir={cwd}
          availableDirs={[cwd]}
          initialProvider={provider ?? undefined}
          onLaunch={launchAdvanced}
        />
      )}
    </div>
  );
}
