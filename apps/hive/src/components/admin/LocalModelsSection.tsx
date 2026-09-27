import { useState, useEffect, useCallback } from 'react';
import { Cpu, Plus, RefreshCw, Trash2, CheckCircle2, AlertCircle, Search, PlugZap } from 'lucide-react';
import { API_BASE } from '@/lib/api-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invalidateLaunchFlagsCache } from '@/lib/launch-flags';

interface LocalEndpoint {
  id: string;
  accountId: string;
  label: string;
  baseUrl: string;
  model: string;
  contextTokens?: number;
  hasApiKey: boolean;
}

interface TestResult {
  ok: boolean;
  reply?: string;
  error?: string;
  latencyMs?: number;
}

const PRESETS = [
  { name: 'LM Studio', baseUrl: 'http://localhost:1234' },
  { name: 'Ollama', baseUrl: 'http://localhost:11434' },
] as const;

function formatTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

const inputClass =
  'h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground';

async function postJson<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
  return data as T;
}

function describeTest(label: string, r: TestResult): string {
  if (!r.ok) return `"${label}" failed: ${r.error ?? 'unknown error'}`;
  const secs = r.latencyMs !== undefined ? ` in ${(r.latencyMs / 1000).toFixed(1)}s` : '';
  return `"${label}" answered${secs}${r.reply ? `: "${r.reply}"` : ''}. Ready to use.`;
}

/**
 * Local model servers (LM Studio, Ollama, …) that Claude Code sessions can run
 * on. Each one appears next to the Claude accounts in the launch dialog and in a
 * session's "Runs on" menu, so it is picked per session.
 */
export default function LocalModelsSection({
  onSetDefault,
  onChanged,
}: {
  onSetDefault: (accountId: string) => Promise<void>;
  onChanged: () => void;
}) {
  const [endpoints, setEndpoints] = useState<LocalEndpoint[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Add-form state
  const [label, setLabel] = useState('LM Studio');
  const [baseUrl, setBaseUrl] = useState<string>(PRESETS[0].baseUrl);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [detected, setDetected] = useState<string[] | null>(null);
  const [contextTokens, setContextTokens] = useState('');
  // Context sizes the server reported during Detect (LM Studio only).
  const [detectedContexts, setDetectedContexts] = useState<Record<string, number>>({});

  function chooseModel(id: string, contexts = detectedContexts) {
    setModel(id);
    if (contexts[id]) setContextTokens(String(contexts[id]));
  }

  const fetchEndpoints = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/local-models`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load local models (${res.status})`);
      const body = await res.json() as { endpoints: LocalEndpoint[] };
      setEndpoints(body.endpoints);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void fetchEndpoints(); }, [fetchEndpoints]);

  function refreshEverywhere() {
    // The launch dialog caches provider status (which carries these entries).
    invalidateLaunchFlagsCache();
    onChanged();
    void fetchEndpoints();
  }

  function applyPreset(preset: typeof PRESETS[number]) {
    setBaseUrl(preset.baseUrl);
    setLabel(preset.name);
    setDetected(null);
  }

  async function handleDetect() {
    setBusy('detect');
    setError(null);
    setNotice(null);
    try {
      const r = await postJson<{ ok: boolean; models: string[]; contexts?: Record<string, number>; error?: string }>(
        '/api/local-models/probe', { baseUrl, apiKey: apiKey || undefined },
      );
      if (!r.ok) throw new Error(r.error ?? 'Could not list models');
      const contexts = r.contexts ?? {};
      setDetected(r.models);
      setDetectedContexts(contexts);
      if (r.models.length === 0) {
        setNotice({ ok: false, text: 'The server is running but has no models. Download or load one first.' });
      } else {
        chooseModel(model && r.models.includes(model) ? model : r.models[0], contexts);
      }
    } catch (err) {
      setDetected(null);
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleAdd() {
    setBusy('add');
    setError(null);
    setNotice(null);
    try {
      // Test before saving so a typo'd URL or a server without the Messages API
      // is caught here, not when a session fails to start.
      const test = await postJson<TestResult>('/api/local-models/test', {
        baseUrl, model, apiKey: apiKey || undefined,
      });
      if (!test.ok) {
        setNotice({ ok: false, text: describeTest(label, test) });
        return;
      }
      await postJson('/api/local-models', {
        label, baseUrl, model, contextTokens: contextTokens || undefined, apiKey: apiKey || undefined,
      });
      setNotice({ ok: true, text: describeTest(label, test) });
      setModel('');
      setApiKey('');
      setContextTokens('');
      setDetected(null);
      refreshEverywhere();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleTest(ep: LocalEndpoint) {
    setBusy(`test:${ep.id}`);
    setError(null);
    setNotice(null);
    try {
      const r = await postJson<TestResult>(`/api/local-models/${ep.id}/test`);
      setNotice({ ok: r.ok, text: describeTest(ep.label, r) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(ep: LocalEndpoint) {
    if (!window.confirm(`Remove "${ep.label}"?\n\nSessions already running on it keep running.`)) return;
    setBusy(`delete:${ep.id}`);
    setError(null);
    try {
      await postJson(`/api/local-models/${ep.id}`, undefined, 'DELETE');
      setNotice({ ok: true, text: `Removed "${ep.label}".` });
      refreshEverywhere();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDefault(ep: LocalEndpoint) {
    setBusy(`default:${ep.id}`);
    try {
      await onSetDefault(ep.accountId);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Cpu className="h-4 w-4" /> Local models
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Run Claude Code on a model served from your own machine instead of Anthropic.
          Pick it per session: in the launch dialog, or from a running session&apos;s
          &quot;Runs on&quot; menu. Needs a server that speaks the Anthropic Messages API:
          LM Studio 0.4.1+, Ollama 0.14+, llama.cpp or vLLM.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}
      {notice && (
        <div
          className={`rounded-md border p-3 text-sm flex gap-2 ${
            notice.ok ? 'border-border bg-muted/40 text-foreground' : 'border-amber-500/40 bg-amber-500/10 text-foreground'
          }`}
        >
          {notice.ok
            ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
            : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />}
          <span>{notice.text}</span>
        </div>
      )}

      {endpoints.length > 0 && (
        <div className="space-y-2">
          {endpoints.map((ep) => (
            <div
              key={ep.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{ep.label}</span>
                  <span className="font-mono text-[10px] leading-none rounded bg-amber-500/20 text-amber-500 px-1 py-0.5">
                    LOCAL
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {ep.model}{ep.contextTokens ? ` · ${formatTokens(ep.contextTokens)} context` : ''}
                </div>
                <div className="mt-0.5 truncate text-xs font-mono text-muted-foreground">
                  {ep.baseUrl}{ep.hasApiKey ? ' · API key set' : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === `test:${ep.id}`}
                  onClick={() => void handleTest(ep)}
                >
                  {busy === `test:${ep.id}`
                    ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    : <PlugZap className="h-3.5 w-3.5 mr-1.5" />}
                  Test
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy === `delete:${ep.id}`}
                  onClick={() => void handleDelete(ep)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy === `default:${ep.id}`}
                  onClick={() => void handleDefault(ep)}
                  title="Preselect this local model in launch dialogs"
                >
                  Make default
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-md border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Add a local model</h3>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.name}
              type="button"
              variant={baseUrl === p.baseUrl ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => applyPreset(p)}
            >
              {p.name}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">Server URL</label>
            <Input
              className={`${inputClass} w-64`}
              placeholder="http://localhost:1234"
              value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); setDetected(null); }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!baseUrl.trim() || busy === 'detect'}
            onClick={() => void handleDetect()}
          >
            {busy === 'detect'
              ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Search className="h-3.5 w-3.5 mr-1.5" />}
            Detect models
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">Model</label>
            {detected && detected.length > 0 ? (
              <select
                className={`${inputClass} w-72`}
                value={model}
                onChange={(e) => chooseModel(e.target.value)}
              >
                {detected.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <Input
                className={`${inputClass} w-72`}
                placeholder="Detect, or type the model id"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            )}
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">Context length</label>
            <Input
              inputMode="numeric"
              className={`${inputClass} w-28`}
              placeholder="e.g. 32768"
              value={contextTokens}
              onChange={(e) => setContextTokens(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">Label</label>
            <Input
              className={`${inputClass} w-44`}
              placeholder="LM Studio"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">API key (optional)</label>
            <Input
              type="password"
              className={`${inputClass} w-44`}
              placeholder="Only if the server needs one"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <Button
            disabled={!baseUrl.trim() || !model.trim() || !label.trim() || busy === 'add'}
            onClick={() => void handleAdd()}
          >
            {busy === 'add'
              ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Plus className="h-3.5 w-3.5 mr-1.5" />}
            Test &amp; add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          In LM Studio, start the server (Developer tab) and load a model that supports
          tool calling. Claude Code sends a lot of context, so give the model a context
          length of 25k tokens or more, and enter that length here so Claude Code compacts
          the conversation before it overflows (Detect fills it in for LM Studio). The first
          test can take a while if the model has to load.
        </p>
      </div>
    </div>
  );
}
