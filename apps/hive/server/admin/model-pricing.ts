/**
 * Estimated Claude API cost from stored token counts.
 *
 * ai_usage_log stores raw token counts per session but no dollar
 * figure — Anthropic doesn't expose a per-call billing number we capture. This
 * helper derives an **estimated** USD cost from published per-model pricing so
 * managers get a real-money sense of usage. It is intentionally approximate:
 * the Usage dashboard always labels these figures "estimated".
 *
 * Prices are USD per 1,000,000 tokens. Matched by substring against the Model
 * string (e.g. "claude-opus-4-8", "claude-3-5-haiku-20241022"). Unknown models
 * fall back to Sonnet-class pricing so their usage is still counted, not zeroed.
 */

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

interface ModelPriceCard {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// Per-million-token USD rates by model tier.
const OPUS: ModelPriceCard = { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 };
const SONNET: ModelPriceCard = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
const HAIKU: ModelPriceCard = { input: 0.8, output: 4, cacheWrite: 1.0, cacheRead: 0.08 };

function priceCardFor(model: string | null | undefined): ModelPriceCard {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return OPUS;
  if (m.includes('haiku')) return HAIKU;
  // Default (incl. "sonnet" and anything unrecognized) → Sonnet-class rates.
  return SONNET;
}

/**
 * Estimated USD cost for a set of token counts under a given model.
 * Returns a non-negative dollar figure (often fractions of a cent).
 */
export function estimateCostUSD(tokens: TokenCounts, model: string | null | undefined): number {
  const p = priceCardFor(model);
  const perM = (count: number, rate: number) => (Math.max(0, count) / 1_000_000) * rate;
  return (
    perM(tokens.inputTokens, p.input) +
    perM(tokens.outputTokens, p.output) +
    perM(tokens.cacheCreationTokens, p.cacheWrite) +
    perM(tokens.cacheReadTokens, p.cacheRead)
  );
}
