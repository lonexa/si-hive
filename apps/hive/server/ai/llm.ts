/**
 * Pluggable LLM completion layer (Settings → AI).
 *
 * Features that need a one-shot text completion (Ask Hive, knowledge
 * capture, docs generator, build triage, summaries…) call `complete()` and
 * never care which backend answers:
 *
 *   - `cli` (default)       the user's primary AI CLI in print mode — no key needed
 *   - `anthropic`           Anthropic Messages API
 *   - `openai-compatible`   any /v1/chat/completions endpoint (OpenAI, Ollama, LM Studio, vLLM, …)
 *   - `azure-openai`        Azure OpenAI deployments
 *   - `off`                 AI features report "not configured"
 *
 * Non-secret settings live in `config.llm`; the API key in the credential
 * store under `llm:apiKey`.
 */
import type { HiveConfig } from '../types.js';
import { loadConfig } from '../config.js';
import { getSecret } from '../../../../packages/shared/src/server/credentials.js';
import { getPrimaryProvider } from '../providers/registry.js';
import { spawnProviderBatch } from '../claude/batch.js';

export type LlmBackend = 'cli' | 'anthropic' | 'openai-compatible' | 'azure-openai' | 'off';

export interface LlmConfig {
  backend: LlmBackend;
  /** Model id (anthropic / openai-compatible) or deployment name (azure-openai). */
  model?: string;
  /** openai-compatible: base URL up to /v1, e.g. http://localhost:11434/v1 */
  baseUrl?: string;
  /** azure-openai: https://<resource>.openai.azure.com */
  endpoint?: string;
  apiVersion?: string;
  /**
   * Mine finished session transcripts for decisions/gotchas into the
   * knowledge base. Off by default: each capture is an LLM call.
   */
  autoCaptureKnowledge?: boolean;
}

export const LLM_API_KEY_REF = 'llm:apiKey';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5';

export interface CompleteOptions {
  /** Hard cap on output tokens (API backends). Defaults to 1500. */
  maxTokens?: number;
  timeoutMs?: number;
}

export function getLlmConfig(config: HiveConfig = loadConfig()): LlmConfig {
  const raw = config.llm as Partial<LlmConfig> | undefined;
  const backend = raw?.backend;
  if (backend === 'anthropic' || backend === 'openai-compatible' || backend === 'azure-openai' || backend === 'off' || backend === 'cli') {
    return { ...raw, backend } as LlmConfig;
  }
  return { backend: 'cli' };
}

/** Whether `complete()` can be expected to work (used to show/hide AI buttons). */
export function isLlmConfigured(config: HiveConfig = loadConfig()): boolean {
  const llm = getLlmConfig(config);
  switch (llm.backend) {
    case 'off': return false;
    case 'cli': {
      try {
        const provider = getPrimaryProvider(config);
        return provider.isInstalled(config.aiProviders?.providers?.[provider.id]?.customPath);
      } catch {
        return false;
      }
    }
    case 'anthropic': return !!getSecret(LLM_API_KEY_REF);
    case 'openai-compatible': return !!llm.baseUrl && !!llm.model;
    case 'azure-openai': return !!llm.endpoint && !!llm.model && !!getSecret(LLM_API_KEY_REF);
  }
}

/** Human-readable description of the active backend, for UI status lines. */
export function describeLlm(config: HiveConfig = loadConfig()): string {
  const llm = getLlmConfig(config);
  switch (llm.backend) {
    case 'off': return 'AI completions are turned off';
    case 'cli': return `${getPrimaryProvider(config).displayName} CLI`;
    case 'anthropic': return `Anthropic API (${llm.model || DEFAULT_ANTHROPIC_MODEL})`;
    case 'openai-compatible': return `${llm.baseUrl} (${llm.model})`;
    case 'azure-openai': return `Azure OpenAI (${llm.model})`;
  }
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super('No AI backend is configured. Choose one in Settings → AI.');
    this.name = 'LlmNotConfiguredError';
  }
}

/** Single-shot completion: system instructions + one user message → text. */
export async function complete(system: string, user: string, opts: CompleteOptions = {}): Promise<string> {
  const config = loadConfig();
  const llm = getLlmConfig(config);
  const maxTokens = opts.maxTokens ?? 1500;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 180_000);

  switch (llm.backend) {
    case 'off':
      throw new LlmNotConfiguredError();

    case 'cli': {
      const prompt = `${system.trim()}\n\n---\n\n${user}`;
      return (await spawnProviderBatch(prompt, 'llm', { timeoutMs: opts.timeoutMs ?? 180_000 })).trim();
    }

    case 'anthropic': {
      const apiKey = getSecret(LLM_API_KEY_REF);
      if (!apiKey) throw new LlmNotConfiguredError();
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create(
        {
          model: llm.model || DEFAULT_ANTHROPIC_MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        },
        { signal },
      );
      return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    }

    case 'openai-compatible': {
      if (!llm.baseUrl || !llm.model) throw new LlmNotConfiguredError();
      const apiKey = getSecret(LLM_API_KEY_REF);
      const res = await fetch(`${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          model: llm.model,
          max_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
        signal,
      });
      return readChatCompletion(res, 'OpenAI-compatible API');
    }

    case 'azure-openai': {
      const apiKey = getSecret(LLM_API_KEY_REF);
      if (!llm.endpoint || !llm.model || !apiKey) throw new LlmNotConfiguredError();
      const endpoint = llm.endpoint.replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
      const url = `${endpoint}/openai/deployments/${encodeURIComponent(llm.model)}/chat/completions?api-version=${llm.apiVersion || '2024-10-21'}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          messages: [{ role: 'developer', content: system }, { role: 'user', content: user }],
          max_completion_tokens: maxTokens,
        }),
        signal,
      });
      return readChatCompletion(res, 'Azure OpenAI');
    }
  }
}

async function readChatCompletion(res: Response, label: string): Promise<string> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${label} ${res.status}: ${res.statusText}${text ? ` - ${text.slice(0, 300)}` : ''}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}
