import { useEffect, useState } from 'react';
import { Sparkles, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { API_BASE } from '@/lib/api-config';

type Backend = 'cli' | 'anthropic' | 'openai-compatible' | 'azure-openai' | 'off';

interface LlmConfig {
  backend: Backend;
  model?: string;
  baseUrl?: string;
  endpoint?: string;
  apiVersion?: string;
  autoCaptureKnowledge?: boolean;
}

const BACKENDS: { value: Backend; label: string; help: string }[] = [
  { value: 'cli', label: 'My AI CLI (default)', help: 'Uses your primary AI CLI (Claude Code, Codex or Gemini) in print mode. No API key needed; counts against that CLI\'s plan.' },
  { value: 'anthropic', label: 'Anthropic API', help: 'Claude models via the Anthropic API with your API key.' },
  { value: 'openai-compatible', label: 'OpenAI-compatible endpoint', help: 'OpenAI, or a local server such as Ollama, LM Studio or vLLM (anything serving /v1/chat/completions).' },
  { value: 'azure-openai', label: 'Azure OpenAI', help: 'A model deployment in your Azure OpenAI resource.' },
  { value: 'off', label: 'Off', help: 'Disable AI-generated answers, summaries and triage.' },
];

const selectClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/**
 * Settings → AI: which backend answers one-shot completions (Ask Hive,
 * docs generator, summaries, triage, knowledge capture). Interactive agent
 * sessions are configured under General → AI Providers.
 */
export default function AiTab() {
  const [llm, setLlm] = useState<LlmConfig>({ backend: 'cli' });
  const [savedKey, setSavedKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function load() {
    const res = await fetch(`${API_BASE}/api/llm`);
    if (!res.ok) return;
    const data = (await res.json()) as { llm: LlmConfig; apiKey: string; description: string };
    setLlm(data.llm);
    setSavedKey(data.apiKey);
    setDescription(data.description);
  }

  useEffect(() => { void load(); }, []);

  const set = (patch: Partial<LlmConfig>) => setLlm((l) => ({ ...l, ...patch }));
  const needsKey = llm.backend === 'anthropic' || llm.backend === 'azure-openai' || llm.backend === 'openai-compatible';
  const help = BACKENDS.find((b) => b.value === llm.backend)?.help;

  async function save(): Promise<boolean> {
    setBusy('save');
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/llm`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm, apiKey: apiKey || undefined }),
      });
      const data = (await res.json()) as { error?: string; description?: string };
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setApiKey('');
      await load();
      setResult({ ok: true, message: `Saved — using ${data.description}.` });
      return true;
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    if (!(await save())) return;
    setBusy('test');
    try {
      const res = await fetch(`${API_BASE}/api/llm/test`, { method: 'POST' });
      const data = (await res.json()) as { ok: boolean; reply?: string; error?: string; ms: number };
      setResult(data.ok
        ? { ok: true, message: `Working (${(data.ms / 1000).toFixed(1)}s): "${data.reply}"` }
        : { ok: false, message: data.error ?? 'Test failed' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">AI</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The model behind SI Hive's own AI features — Ask SI Hive answers, generated docs, summaries, build triage and knowledge capture.
          Currently: <span className="text-foreground">{description || '…'}</span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" />Completion backend</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">Backend</span>
            <select className={selectClass} value={llm.backend} onChange={(e) => set({ backend: e.target.value as Backend })}>
              {BACKENDS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
            {help && <p className="text-xs text-muted-foreground">{help}</p>}
          </label>

          {llm.backend === 'openai-compatible' && (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">Base URL</span>
              <Input value={llm.baseUrl ?? ''} placeholder="https://api.openai.com/v1 or http://localhost:11434/v1" onChange={(e) => set({ baseUrl: e.target.value })} />
            </label>
          )}

          {llm.backend === 'azure-openai' && (
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 block space-y-1">
                <span className="text-sm font-medium text-foreground">Endpoint</span>
                <Input value={llm.endpoint ?? ''} placeholder="https://my-resource.openai.azure.com" onChange={(e) => set({ endpoint: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-foreground">API version</span>
                <Input value={llm.apiVersion ?? ''} placeholder="2024-10-21" onChange={(e) => set({ apiVersion: e.target.value })} />
              </label>
            </div>
          )}

          {llm.backend !== 'cli' && llm.backend !== 'off' && (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">{llm.backend === 'azure-openai' ? 'Deployment name' : 'Model'}</span>
              <Input
                value={llm.model ?? ''}
                placeholder={llm.backend === 'anthropic' ? 'claude-sonnet-5' : llm.backend === 'azure-openai' ? 'my-gpt-deployment' : 'model id'}
                onChange={(e) => set({ model: e.target.value })}
              />
            </label>
          )}

          {needsKey && (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">API key{llm.backend === 'openai-compatible' ? ' (optional for local servers)' : ''}</span>
              <Input
                type="password"
                autoComplete="new-password"
                value={apiKey}
                placeholder={savedKey ? `Saved (${savedKey}) — leave blank to keep` : ''}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
          )}

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-sm font-medium text-foreground">Auto-capture knowledge</span>
              <p className="text-xs text-muted-foreground">
                After agent sessions, extract decisions and gotchas into the knowledge base. Each capture is one completion call.
              </p>
            </div>
            <Switch checked={!!llm.autoCaptureKnowledge} onCheckedChange={(v) => set({ autoCaptureKnowledge: v })} />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void save()} data-track="settings.ai.save">
              {busy === 'save' && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Save
            </Button>
            {llm.backend !== 'off' && (
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void test()} data-track="settings.ai.test">
                {busy === 'test' && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Save & test
              </Button>
            )}
          </div>

          {result && (
            <p className={`flex items-center gap-1.5 text-sm ${result.ok ? 'text-green-500' : 'text-destructive'}`}>
              {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {result.message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
