import { useState, useEffect, useRef, useCallback } from 'react';
import { GraduationCap, Check, Loader2, AlertTriangle, X } from 'lucide-react';
import { API_BASE } from '@/lib/api-config';

interface ResolvedRequirement {
  id: number;
  contextType: 'repo' | 'topic';
  contextLabel: string | null;
  skillName: string;
  required: boolean;
  installed: boolean;
  availableInTeam: boolean;
  matchedOn: string;
}

interface Props {
  /** The open session to scan (user prompts) and resolve the repo for. */
  sessionId?: string;
  /** The session's working directory — used to read its git origin. */
  cwd?: string;
}

const POLL_MS = 30_000;

/**
 * On an open session, surfaces the team-approved skills required by the repo
 * (matched via git remote) or the topic the user is working on (matched via
 * keywords in their prompts), and auto-installs any that are missing. Renders
 * nothing when no requirement matches.
 */
export default function RequiredSkillsBanner({ sessionId, cwd }: Props) {
  const [requirements, setRequirements] = useState<ResolvedRequirement[]>([]);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const installedOnce = useRef<Set<string>>(new Set());

  const query = (() => {
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    if (cwd) params.set('cwd', cwd);
    return params.toString();
  })();

  const resolve = useCallback(async (): Promise<ResolvedRequirement[]> => {
    if (!query) return [];
    try {
      const res = await fetch(`${API_BASE}/api/skill-requirements/resolve?${query}`, { credentials: 'include' });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return [];
      const data = (await res.json()) as { requirements?: ResolvedRequirement[] };
      return data.requirements ?? [];
    } catch {
      return [];
    }
  }, [query]);

  useEffect(() => {
    if (!query) return;
    let cancelled = false;

    async function tick() {
      const reqs = await resolve();
      if (cancelled) return;
      setRequirements(reqs);

      // Auto-install required-but-missing skills available in the team DB,
      // each at most once per mount.
      const missing = reqs.filter(
        (r) => r.required && !r.installed && r.availableInTeam && !installedOnce.current.has(r.skillName),
      );
      if (missing.length > 0) {
        missing.forEach((m) => installedOnce.current.add(m.skillName));
        setInstalling(true);
        try {
          await fetch(`${API_BASE}/api/skill-requirements/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ skills: missing.map((m) => m.skillName) }),
          });
        } catch {
          // best-effort; next resolve reflects whatever landed
        }
        const after = await resolve();
        if (!cancelled) {
          setRequirements(after);
          setInstalling(false);
        }
      }
    }

    void tick();
    const interval = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (dismissed || requirements.length === 0) return null;

  const required = requirements.filter((r) => r.required);
  if (required.length === 0) return null;
  const missingUnavailable = required.filter((r) => !r.installed && !r.availableInTeam);
  const allSatisfied = required.every((r) => r.installed);

  return (
    <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
      <div className="flex items-start gap-3">
        <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-amber-700 dark:text-amber-300">
            {installing
              ? 'Installing required skills…'
              : allSatisfied
                ? 'Approved skills for this work are installed'
                : 'Required skills for this work'}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {required.map((r) => (
              <span key={r.id} className="inline-flex items-center gap-1 text-xs">
                {r.installed ? (
                  <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                ) : !r.availableInTeam ? (
                  <AlertTriangle className="h-3 w-3 text-red-500" />
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin text-amber-600 dark:text-amber-400" />
                )}
                <span className={r.installed ? 'text-muted-foreground' : 'text-foreground'}>
                  {r.skillName}
                </span>
                {r.matchedOn && (
                  <span className="text-[10px] text-muted-foreground">
                    ({r.contextType === 'repo' ? 'repo' : `matched ${r.matchedOn}`})
                  </span>
                )}
              </span>
            ))}
          </div>
          {missingUnavailable.length > 0 && (
            <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
              Not available in team skills (ask an admin to publish):{' '}
              {missingUnavailable.map((r) => r.skillName).join(', ')}
            </div>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-600/70 hover:text-amber-700 dark:hover:text-amber-300"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
