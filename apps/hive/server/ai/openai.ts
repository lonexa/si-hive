/**
 * Shared Azure OpenAI helper.
 *
 * The original `callAzureOpenAI` + `getOpenAIConfig` were duplicated privately
 * inside `ai-studio/docs-client.ts` and `ai-studio/triage-client.ts`. Newer
 * features (dev summary, "what landed" feed, Ask Hive) need the same calls, so
 * the logic now lives here. Config is read from the Hive config
 * (`$HIVE_HOME/config.json`) under the `azureOpenAI` key.
 */

import fs from 'node:fs';
import { hivePath } from '../../../../packages/shared/src/server/paths.js';
import type { AzureOpenAIConfig } from '../types.js';

/**
 * Load the Azure OpenAI config from the Hive config.
 * Returns null when not configured (callers should degrade gracefully).
 */
export function getOpenAIConfig(): AzureOpenAIConfig | null {
  try {
    const configPath = hivePath('config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as { azureOpenAI?: Partial<AzureOpenAIConfig> };
    const cfg = parsed.azureOpenAI;
    if (!cfg?.endpoint || !cfg?.apiKey || !cfg?.model) return null;
    return {
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.model,
      apiVersion: cfg.apiVersion ?? '2024-02-15-preview',
    };
  } catch {
    return null;
  }
}

export interface CompletionOptions {
  /** Hard cap on completion tokens. Defaults to 1500. */
  maxTokens?: number;
}

/**
 * Single-shot chat completion. Mirrors the call shape used by AI Studio
 * (system prompt sent as the `developer` role, which the deployed models accept).
 */
export async function callAzureOpenAI(
  config: AzureOpenAIConfig,
  systemPrompt: string,
  userPrompt: string,
  options: CompletionOptions = {},
): Promise<string> {
  const endpoint = config.endpoint.replace(/^https?:\/\//, '');
  const url = `https://${endpoint}/openai/deployments/${config.model}/chat/completions?api-version=${config.apiVersion}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.apiKey,
    },
    body: JSON.stringify({
      messages: [
        { role: 'developer', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: options.maxTokens ?? 1500,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Azure OpenAI API ${response.status}: ${response.statusText} - ${text}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content ?? '';
}
