import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_BASE } from '@/lib/api-config';
import IntegrationsTab from '@/components/settings/IntegrationsTab';
import ModulesTab from '@/components/settings/ModulesTab';

interface ProviderStatus { id: 'claude' | 'gemini' | 'codex'; displayName: string; installed: boolean; resolvedPath: string | null }
interface SetupState { completed: boolean; projectsRoot: string; providers: ProviderStatus[]; primary: ProviderStatus['id'] }

const STEPS = ['Welcome', 'Projects', 'Integrations', 'Modules', 'Done'] as const;

async function post(body: Record<string, unknown>) {
  await fetch(`${API_BASE}/api/setup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * First-run setup: pick the AI CLI, the projects folder, and optionally
 * connect integrations and choose modules. Everything can be changed later
 * in Settings; "Skip" finishes immediately.
 */
export default function SetupWizard({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<SetupState | null>(null);
  const [step, setStep] = useState(0);
  const [primary, setPrimary] = useState<ProviderStatus['id']>('claude');
  const [projectsRoot, setProjectsRoot] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/api/setup`, { credentials: 'include' })
      .then((r) => r.json() as Promise<SetupState>)
      .then((s) => {
        setState(s);
        setProjectsRoot(s.projectsRoot ?? '');
        const installed = s.providers.find((p) => p.id === s.primary && p.installed) ?? s.providers.find((p) => p.installed);
        setPrimary(installed?.id ?? s.primary);
      })
      .catch(() => onDone());
  }, [onDone]);

  async function finish() {
    await post({ primary, projectsRoot, complete: true });
    onDone();
  }

  async function next() {
    if (step === 0 || step === 1) await post({ primary, projectsRoot });
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  if (!state) return null;
  const anyInstalled = state.providers.some((p) => p.installed);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Set up SI Hive</h1>
          <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => void finish()}>Skip setup</button>
        </div>

        <ol className="flex gap-2 text-xs">
          {STEPS.map((label, i) => (
            <li key={label} className={`flex-1 rounded-full px-3 py-1 text-center ${i === step ? 'bg-primary text-primary-foreground' : i < step ? 'bg-secondary text-foreground' : 'bg-secondary/40 text-muted-foreground'}`}>
              {label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              SI Hive is a local dashboard for your AI coding agents. It found these agent CLIs on this machine — pick the one SI Hive should use by default.
            </p>
            <div className="space-y-2">
              {state.providers.map((p) => (
                <label key={p.id} className={`flex items-center gap-3 rounded-md border p-3 ${p.installed ? 'border-border cursor-pointer' : 'border-border/50 opacity-60'}`}>
                  <input type="radio" name="primary" disabled={!p.installed} checked={primary === p.id} onChange={() => setPrimary(p.id)} />
                  {p.installed ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
                  <span className="font-medium text-foreground">{p.displayName}</span>
                  <span className="text-xs text-muted-foreground truncate">{p.installed ? p.resolvedPath : 'not installed'}</span>
                </label>
              ))}
            </div>
            {!anyInstalled && (
              <p className="text-sm text-amber-500">
                No agent CLI found. Install Claude Code (or Codex / Gemini CLI), then restart SI Hive — or continue and set a custom path later in Settings.
              </p>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Where do your code projects live? SI Hive lists folders from here (plus any project you've used with your agent CLI).
            </p>
            <Input value={projectsRoot} placeholder="e.g. C:\Users\you\code or /Users/you/code" onChange={(e) => setProjectsRoot(e.target.value)} />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Optional: connect your code host and ticket tracker. You can skip this and do it later.</p>
            <IntegrationsTab />
          </div>
        )}

        {step === 3 && <ModulesTab />}

        {step === 4 && (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p className="text-foreground font-medium">You're all set.</p>
            <p>SI Hive is running in single-user mode: it only listens on this machine and needs no login.</p>
            <p>To share one SI Hive with others, turn on login in <span className="text-foreground">Settings → Authentication</span>. AI features use your agent CLI by default — change that in <span className="text-foreground">Settings → AI</span>.</p>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep((s) => Math.max(s - 1, 0))}>
            <ChevronLeft className="h-4 w-4 mr-1" />Back
          </Button>
          {step < STEPS.length - 1
            ? <Button size="sm" onClick={() => void next()}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
            : <Button size="sm" onClick={() => void finish()}>Open SI Hive</Button>}
        </div>
      </div>
    </div>
  );
}
