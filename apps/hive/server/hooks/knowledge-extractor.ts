import type { KBEntryInput } from '../kb/types.js';
import { parseTranscriptFile } from './decision-detector.js';
import { complete, getLlmConfig, isLlmConfigured } from '../ai/llm.js';

/**
 * LLM-based knowledge auto-capture (B2.3).
 *
 * The regex `decision-detector` only catches explicitly-worded architectural
 * decisions. This pass uses the configured LLM (ai/llm.ts) to extract BOTH significant decisions
 * AND non-obvious "gotchas" / learnings from a session transcript, writing them
 * to the KB (categories 'decision' and 'gotcha') so they surface in Search /
 * Ask Hive. Directly addresses the "KB is lacking" gap.
 *
 * The Stop hook fires once per assistant turn, not once per session, so an
 * unthrottled LLM call here would be expensive and noisy. We therefore:
 *   - only run when auto-capture is enabled in Settings → AI,
 *   - throttle to at most once per session per THROTTLE_MS,
 *   - require the transcript to have grown enough to be worth re-scanning,
 *   - cap the number of captured items.
 * KBClient.create() dedups by (title, category, scope), so repeated scans of a
 * growing session don't create duplicates.
 */

const THROTTLE_MS = 20 * 60 * 1000; // 20 min between extractions for one session
const MIN_MESSAGES = 6;
const MIN_NEW_MESSAGES = 4; // require this many new messages since the last scan
const MAX_TRANSCRIPT_CHARS = 14_000;
const MAX_ITEMS = 4;

interface ExtractState { lastAt: number; lastMsgCount: number }
const lastScan = new Map<string, ExtractState>();

interface ExtractedItem {
  type: 'decision' | 'gotcha';
  title: string;
  content: string;
  tags?: string;
}

/** Whether this session is due for an LLM extraction right now. */
function shouldRun(sessionId: string, messageCount: number, now: number): boolean {
  if (messageCount < MIN_MESSAGES) return false;
  const prev = lastScan.get(sessionId);
  if (!prev) return true;
  if (now - prev.lastAt < THROTTLE_MS) return false;
  if (messageCount - prev.lastMsgCount < MIN_NEW_MESSAGES) return false;
  return true;
}

function parseItems(raw: string): ExtractedItem[] {
  // Strip code fences / prose around the JSON.
  const cleaned = raw.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return [];
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as { items?: ExtractedItem[] };
    if (!Array.isArray(obj.items)) return [];
    return obj.items
      .filter((i) => (i.type === 'decision' || i.type === 'gotcha') && i.title && i.content)
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

/**
 * Scan a transcript with the LLM and return KB entries for any captured
 * decisions / gotchas. Returns [] when not configured, throttled, or nothing
 * worth capturing. `nowMs` is injected so callers control time (testability).
 */
export async function extractKnowledge(
  transcriptPath: string,
  sessionId: string,
  projectName: string | undefined,
  nowMs: number,
): Promise<KBEntryInput[]> {
  // Opt-in: every capture is an LLM call (with the CLI backend, an agent run).
  if (!getLlmConfig().autoCaptureKnowledge || !isLlmConfigured()) return [];

  const messages = parseTranscriptFile(transcriptPath);
  if (!shouldRun(sessionId, messages.length, nowMs)) return [];

  // Build a condensed transcript, weighted toward the end (where conclusions
  // and gotchas tend to land), within the char budget.
  let budget = MAX_TRANSCRIPT_CHARS;
  const parts: string[] = [];
  for (let i = messages.length - 1; i >= 0 && budget > 0; i--) {
    const m = messages[i];
    const line = `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`;
    const slice = line.slice(0, Math.min(line.length, budget));
    parts.push(slice);
    budget -= slice.length;
  }
  const transcript = parts.reverse().join('\n\n');

  const systemPrompt = [
    'You extract durable, reusable knowledge from a software engineering session transcript.',
    'Return ONLY a JSON object: {"items":[{"type","title","content","tags"}]}.',
    '"type" is "decision" (a significant architectural/technical decision and why) or "gotcha" (a non-obvious fact, pitfall, fix, or constraint worth remembering).',
    'Capture at most 4 items, only genuinely reusable ones. If nothing rises to that bar, return {"items":[]}.',
    '"title": a concise specific phrase (no "ADR:" prefix). "content": 2-5 sentences of markdown with enough context to be useful later. "tags": comma-separated keywords.',
    'Do NOT capture routine coding steps, trivia, or anything you are not confident about. Do NOT invent details not in the transcript.',
  ].join('\n');

  let answer: string;
  try {
    answer = await complete(systemPrompt, transcript, { maxTokens: 1000 });
  } catch (err) {
    console.error('[knowledge-extractor] LLM call failed:', err);
    return [];
  }

  // Record the scan regardless of yield so throttling holds.
  lastScan.set(sessionId, { lastAt: nowMs, lastMsgCount: messages.length });

  const items = parseItems(answer);
  if (items.length === 0) return [];

  const tagSuffix = projectName ? `,${projectName}` : '';
  return items.map((it): KBEntryInput => ({
    title: it.title.slice(0, 200),
    content: it.content,
    category: it.type, // 'decision' | 'gotcha'
    tags: `auto-captured${tagSuffix}${it.tags ? `,${it.tags}` : ''}`.slice(0, 400),
    scope: 'shared' as const,
    scope_owner: '',
    source: `claude-session:${sessionId}`,
    created_by: 'hive-knowledge-extractor',
  }));
}
