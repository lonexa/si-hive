/**
 * Settings → AI (LLM backend for completions).
 *
 *   GET  /api/llm        { llm, apiKey (masked), configured, description }
 *   PUT  /api/llm        { llm: LlmConfig, apiKey? }   — '' apiKey clears it
 *   POST /api/llm/test   run a tiny completion with the saved settings
 */
import type http from 'node:http';
import type { HiveConfig } from '../types.js';
import { sendJson, readBody } from '../../../../packages/shared/src/server/http-utils.js';
import { getSecret, setSecret, deleteSecret, maskSecret } from '../../../../packages/shared/src/server/credentials.js';
import { complete, describeLlm, getLlmConfig, isLlmConfigured, LLM_API_KEY_REF, type LlmBackend, type LlmConfig } from './llm.js';

const BACKENDS: LlmBackend[] = ['cli', 'anthropic', 'openai-compatible', 'azure-openai', 'off'];

function sanitize(input: unknown): LlmConfig | null {
  if (!input || typeof input !== 'object') return null;
  const c = input as Record<string, unknown>;
  if (!BACKENDS.includes(c.backend as LlmBackend)) return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    backend: c.backend as LlmBackend,
    model: str(c.model),
    baseUrl: str(c.baseUrl),
    endpoint: str(c.endpoint),
    apiVersion: str(c.apiVersion),
    autoCaptureKnowledge: c.autoCaptureKnowledge === true,
  };
}

export function registerLlmRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: HiveConfig,
  saveConfig: (c: HiveConfig) => void,
): boolean {
  if (url.pathname === '/api/llm' && req.method === 'GET') {
    sendJson(res, 200, {
      llm: getLlmConfig(config),
      apiKey: maskSecret(getSecret(LLM_API_KEY_REF)),
      configured: isLlmConfigured(config),
      description: describeLlm(config),
    });
    return true;
  }

  if (url.pathname === '/api/llm' && req.method === 'PUT') {
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { llm?: unknown; apiKey?: string };
        const llm = sanitize(body.llm);
        if (!llm) return sendJson(res, 400, { error: 'Invalid AI settings' });
        if (typeof body.apiKey === 'string') {
          if (body.apiKey) setSecret(LLM_API_KEY_REF, body.apiKey);
          else deleteSecret(LLM_API_KEY_REF);
        }
        config.llm = llm;
        saveConfig(config);
        sendJson(res, 200, { llm, configured: isLlmConfigured(config), description: describeLlm(config) });
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
    })();
    return true;
  }

  if (url.pathname === '/api/llm/test' && req.method === 'POST') {
    void (async () => {
      const started = Date.now();
      try {
        const reply = await complete('You are a connectivity check. Reply with exactly: OK', 'Reply with OK.', { maxTokens: 16, timeoutMs: 120_000 });
        sendJson(res, 200, { ok: true, reply: reply.slice(0, 200), ms: Date.now() - started, description: describeLlm(config) });
      } catch (err) {
        sendJson(res, 200, { ok: false, error: (err as Error).message, ms: Date.now() - started });
      }
    })();
    return true;
  }

  return false;
}
