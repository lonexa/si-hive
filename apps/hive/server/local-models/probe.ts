/**
 * Talk to a local model server directly: list its models and check that it
 * speaks the Anthropic Messages API Claude Code needs.
 */

import { normalizeBaseUrl } from './endpoints.js';

export interface ProbeResult {
  ok: boolean;
  models: string[];
  /** Context window per model id, when the server reports it (LM Studio does). */
  contexts?: Record<string, number>;
  error?: string;
}

export interface TestResult {
  ok: boolean;
  /** Short reply text from the model, when it answered. */
  reply?: string;
  error?: string;
  latencyMs?: number;
}

const LIST_TIMEOUT_MS = 5000;
/** Generous: LM Studio and Ollama load the model on first request. */
const TEST_TIMEOUT_MS = 120_000;

function authHeaders(apiKey?: string): Record<string, string> {
  const key = apiKey || 'local';
  return { Authorization: `Bearer ${key}`, 'x-api-key': key };
}

function describeFetchError(err: unknown, baseUrl: string): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return `Timed out waiting for ${baseUrl}`;
  if (e.cause?.code === 'ECONNREFUSED') {
    return `Nothing is listening at ${baseUrl}. Is the server running? (LM Studio: Developer tab → Start Server; Ollama: \`ollama serve\`)`;
  }
  return `Could not reach ${baseUrl}: ${e.message ?? String(err)}`;
}

/**
 * LM Studio's native listing carries each model's context window: the loaded
 * length when the model is in memory (what actually applies), else its max.
 * Other servers don't have this endpoint; they just get no hint.
 */
async function lmStudioContexts(baseUrl: string): Promise<Record<string, number> | undefined> {
  try {
    const res = await fetch(`${baseUrl}/api/v0/models`, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    if (!res.ok) return undefined;
    const body = await res.json() as {
      data?: Array<{ id?: string; loaded_context_length?: number; max_context_length?: number }>;
    };
    const contexts: Record<string, number> = {};
    for (const m of body.data ?? []) {
      const n = m.loaded_context_length ?? m.max_context_length;
      if (m.id && typeof n === 'number' && n > 0) contexts[m.id] = n;
    }
    return Object.keys(contexts).length ? contexts : undefined;
  } catch {
    return undefined;
  }
}

/** Model ids the server offers. Embedding models are dropped — they can't chat. */
export async function listModels(rawBaseUrl: string, apiKey?: string): Promise<ProbeResult> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: authHeaders(apiKey),
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = await res.json() as { data?: Array<{ id?: string }> };
      const models = (body.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
      return {
        ok: true,
        models: models.filter((id) => !/embed/i.test(id)),
        contexts: await lmStudioContexts(baseUrl),
      };
    }
    // Older Ollama builds have no OpenAI-style listing; try its native one.
    const tags = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    if (tags.ok) {
      const body = await tags.json() as { models?: Array<{ name?: string }> };
      const models = (body.models ?? []).map((m) => m.name).filter((n): n is string => !!n);
      return { ok: true, models: models.filter((id) => !/embed/i.test(id)) };
    }
    return { ok: false, models: [], error: `${baseUrl} answered HTTP ${res.status} when listing models` };
  } catch (err) {
    return { ok: false, models: [], error: describeFetchError(err, baseUrl) };
  }
}

/**
 * Send the smallest possible Messages API request — the same call Claude Code
 * makes — so a passing test means a session will actually work.
 */
export async function testMessages(rawBaseUrl: string, model: string, apiKey?: string): Promise<TestResult> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        ...authHeaders(apiKey),
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
      }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    if (res.status === 404 || res.status === 405) {
      return {
        ok: false,
        latencyMs,
        error: `${baseUrl} does not serve the Anthropic Messages API (/v1/messages), which Claude Code needs. `
          + 'Update to LM Studio 0.4.1+ or Ollama 0.14+, or use a server that supports it (llama.cpp, vLLM).',
      };
    }
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } | string };
        detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? detail;
      } catch { /* not JSON */ }
      return { ok: false, latencyMs, error: `HTTP ${res.status}: ${detail}` };
    }
    let reply = '';
    try {
      const parsed = JSON.parse(text) as { content?: Array<{ type?: string; text?: string }> };
      reply = (parsed.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
    } catch {
      return { ok: false, latencyMs, error: 'The server answered, but not with an Anthropic-format message' };
    }
    return { ok: true, latencyMs, reply };
  } catch (err) {
    return { ok: false, error: describeFetchError(err, baseUrl) };
  }
}
