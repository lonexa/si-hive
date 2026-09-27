/**
 * Local model endpoints — Claude Code pointed at a model server on this machine
 * (LM Studio, Ollama, llama.cpp, vLLM, …) instead of Anthropic.
 *
 * Claude Code talks the Anthropic Messages API, and these servers expose that
 * same API (`POST /v1/messages`), so a session is redirected purely through its
 * environment: ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN. No proxy.
 *
 * Each endpoint surfaces as an extra Claude "account" with id `local-<id>`.
 * That reuses the whole per-session account plumbing — the launch picker, the
 * spawn message, respawn-on-change, and switching a live session via --resume —
 * so a local session and an Anthropic session run side by side. A local session
 * uses the DEFAULT config dir, so skills, agents, settings and session history
 * are shared with Anthropic sessions.
 */

import type { ProviderId } from '../providers/types.js';
import { getSecret } from '../../../../packages/shared/src/server/credentials.js';

export interface LocalModelEndpoint {
  /** Slug; the account id is `local-<id>`. */
  id: string;
  label: string;
  /** Server root, e.g. http://localhost:1234 — Claude Code appends /v1/messages. */
  baseUrl: string;
  /** Model id as the server knows it, e.g. qwen/qwen3-coder-30b. */
  model: string;
  /**
   * The model's context window as loaded on the server. Claude Code does not
   * know local models and otherwise assumes 200k, so it would only auto-compact
   * long after a small local context had overflowed.
   */
  contextTokens?: number;
}

export interface LocalModelsConfig {
  endpoints: LocalModelEndpoint[];
}

export const LOCAL_ACCOUNT_PREFIX = 'local-';

/** Only Claude Code can be redirected this way. */
export const LOCAL_MODEL_PROVIDER: ProviderId = 'claude';

export function isLocalAccountId(accountId: string | undefined): boolean {
  return !!accountId && accountId.startsWith(LOCAL_ACCOUNT_PREFIX);
}

export function localAccountId(endpointId: string): string {
  return `${LOCAL_ACCOUNT_PREFIX}${endpointId}`;
}

export function isValidEndpointId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,30}$/.test(id);
}

export function apiKeyRef(endpointId: string): string {
  return `localmodel:${endpointId}:apiKey`;
}

/**
 * Store the server root. Users paste all sorts — `localhost:1234`,
 * `http://localhost:1234/v1/`, the OpenAI-style base URL LM Studio shows — but
 * Claude Code appends `/v1/messages` itself, so a trailing /v1 must go.
 */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/v1$/i, '');
  // Node resolves `localhost` to ::1 only, while LM Studio and Ollama listen on
  // 127.0.0.1 — so a probe of http://localhost:1234 is refused. Pin IPv4.
  url = url.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');
  return url.replace(/\/+$/, '');
}

export function listEndpoints(config: { localModels?: LocalModelsConfig }): LocalModelEndpoint[] {
  const endpoints = config.localModels?.endpoints;
  return Array.isArray(endpoints) ? endpoints : [];
}

/** The endpoint a session's account id selects, or null for a normal account. */
export function getEndpointForAccount(
  config: { localModels?: LocalModelsConfig },
  providerId: ProviderId | undefined,
  accountId: string | undefined,
): LocalModelEndpoint | null {
  if (providerId !== LOCAL_MODEL_PROVIDER || !isLocalAccountId(accountId)) return null;
  const id = accountId!.slice(LOCAL_ACCOUNT_PREFIX.length);
  return listEndpoints(config).find((e) => e.id === id) ?? null;
}

/**
 * Environment that points one Claude Code process at the endpoint. Every model
 * alias is pinned to the local model too: Claude Code makes background calls
 * (titles, summaries) and subagent calls on "haiku"/"sonnet", which a local
 * server does not have.
 */
export function buildLocalEnv(endpoint: LocalModelEndpoint): Record<string, string> {
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: endpoint.baseUrl,
    // Local servers accept any token; one must be set or Claude Code falls back
    // to the signed-in Anthropic login.
    ANTHROPIC_AUTH_TOKEN: getSecret(apiKeyRef(endpoint.id)) || 'local',
    ANTHROPIC_MODEL: endpoint.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: endpoint.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: endpoint.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: endpoint.model,
    CLAUDE_CODE_SUBAGENT_MODEL: endpoint.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    // The attribution header opens the system prompt and varies between
    // requests, so a local server's prompt cache never matches and every turn
    // re-processes the whole ~20k-token prompt.
    CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
  };
  if (endpoint.contextTokens) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(endpoint.contextTokens);
  return env;
}

/** A positive whole number of tokens, or undefined for anything else. */
export function parseContextTokens(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Adapt Claude Code's args for a local model:
 * - Any `--model <x>` (an Anthropic name from the UI) becomes the local model.
 * - Auto mode is dropped: its permission classifier only runs on Anthropic's
 *   models, so every tool call fails with "auto mode cannot classify". The
 *   session starts in acceptEdits instead (edits auto-approved, commands ask).
 *   An explicit mode is always passed so a settings.json defaultMode of "auto"
 *   cannot bring it back.
 * - WebSearch is disabled: it is an Anthropic server-side tool, and a local
 *   server returns no real results, so the model works from invented ones.
 */
export function withLocalModelArg(args: string[], model: string): string[] {
  const out: string[] = [];
  let hasMode = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--model' || a === '--permission-mode') {
      const value = args[++i];
      if (a === '--permission-mode' && value !== undefined && value !== 'auto') {
        out.push(a, value);
        hasMode = true;
      }
      continue;
    }
    if (a.startsWith('--model=') || a === '--enable-auto-mode' || a === '--permission-mode=auto') continue;
    if (a.startsWith('--permission-mode=') || a === '--dangerously-skip-permissions') hasMode = true;
    out.push(a);
  }
  if (!hasMode) out.push('--permission-mode', 'acceptEdits');
  out.push('--disallowedTools', 'WebSearch');
  out.push('--model', model);
  return out;
}
