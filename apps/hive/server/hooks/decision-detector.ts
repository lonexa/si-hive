import fs from 'node:fs';
import type { KBEntryInput } from '../kb/types.js';

/**
 * Detects architectural decisions from Claude Code session transcripts
 * and returns structured ADR (Architecture Decision Record) entries
 * ready for insertion into the Knowledge Base.
 *
 * Conservative: only flags clear, significant decisions — not every small coding choice.
 */

interface TranscriptMessage {
  role: string;
  type: string;
  content: string;
  timestamp: string;
}

interface DetectedDecision {
  title: string;
  context: string;
  decision: string;
  consequences: string;
  sourceText: string;
}

// --- Decision-signal patterns ---
// Each has a regex and a minimum "significance" weight.
// We require a combined weight >= 2 to flag a block as a decision.

interface SignalPattern {
  regex: RegExp;
  weight: number;
}

const DECISION_SIGNALS: SignalPattern[] = [
  // Explicit decision language
  { regex: /\b(?:decided\s+to|decision\s+is\s+to|we\s+decided)\b/i, weight: 2 },
  { regex: /\b(?:going\s+with|we(?:'ll| will)\s+go\s+with)\b/i, weight: 2 },
  { regex: /\bchoosing\s+\S+\s+over\b/i, weight: 2 },
  { regex: /\b(?:architecture|architectural)\s+decision\b/i, weight: 3 },
  { regex: /\bdesign\s+decision\b/i, weight: 3 },

  // Strong alternatives discussion
  { regex: /\binstead\s+of\b/i, weight: 1 },
  { regex: /\brather\s+than\b/i, weight: 1 },
  { regex: /\btrade-?off\b/i, weight: 1.5 },

  // Moderate decision signals (need corroboration)
  { regex: /\blet(?:'s| us)\s+use\b/i, weight: 1 },
  { regex: /\bthe\s+approach\s+(?:will|is)\b/i, weight: 1.5 },
  { regex: /\bwe(?:'ll| will)\s+(?:adopt|implement|use|switch\s+to)\b/i, weight: 1.5 },
  { regex: /\bmoving\s+(?:forward|ahead)\s+with\b/i, weight: 2 },
  { regex: /\bcommitting\s+to\b/i, weight: 1.5 },

  // Pattern / approach keywords (weak on their own)
  { regex: /\b(?:pattern|strategy|approach|paradigm)\b/i, weight: 0.5 },
  { regex: /\b(?:migrate|migration|refactor)\b/i, weight: 0.5 },
];

// Minimum combined signal weight for a text block to be considered a decision
const MIN_SIGNAL_WEIGHT = 2;

// Minimum length (chars) for assistant text to be worth scanning
const MIN_TEXT_LENGTH = 80;

// Maximum number of decisions to extract per session (avoid noise)
const MAX_DECISIONS_PER_SESSION = 5;

/**
 * Read and parse a Claude Code JSONL transcript file into text messages.
 */
export function parseTranscriptFile(filePath: string): TranscriptMessage[] {
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf-8');
  const messages: TranscriptMessage[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry.type || !entry.message) continue;

      const msg = entry.message;

      if (entry.type === 'user' && msg.role === 'user') {
        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter((b: { type: string }) => b.type === 'text')
            .map((b: { text: string }) => b.text)
            .join('\n');
        }
        if (text && !text.startsWith('<system-reminder>') && text !== 'Warmup') {
          messages.push({ role: 'user', type: 'text', content: text, timestamp: entry.timestamp ?? '' });
        }
      } else if (entry.type === 'assistant' && msg.role === 'assistant') {
        if (!Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            messages.push({ role: 'assistant', type: 'text', content: block.text, timestamp: entry.timestamp ?? '' });
          }
        }
      }
    } catch { /* skip malformed lines */ }
  }

  return messages;
}

/**
 * Score a block of text for decision signals.
 * Returns total weight of matched patterns.
 */
function scoreDecisionSignals(text: string): number {
  let total = 0;
  for (const signal of DECISION_SIGNALS) {
    if (signal.regex.test(text)) {
      total += signal.weight;
    }
  }
  return total;
}

/**
 * Extract a concise title from the decision text.
 * Looks for the core "decided to X" or "going with X" phrase.
 */
function extractTitle(text: string): string {
  // Try to pull a short phrase from explicit patterns
  const titlePatterns = [
    /(?:decided\s+to|decision\s+is\s+to)\s+(.{10,80}?)(?:\.|,|\n|$)/i,
    /(?:going\s+with|we(?:'ll| will)\s+go\s+with)\s+(.{5,80}?)(?:\.|,|\n|$)/i,
    /choosing\s+(\S+(?:\s+\S+){0,6})\s+over\s+(\S+(?:\s+\S+){0,4})/i,
    /(?:we(?:'ll| will)\s+(?:adopt|implement|use|switch\s+to))\s+(.{5,80}?)(?:\.|,|\n|$)/i,
    /moving\s+forward\s+with\s+(.{5,80}?)(?:\.|,|\n|$)/i,
  ];

  for (const p of titlePatterns) {
    const match = p.exec(text);
    if (match) {
      const raw = match[1].trim();
      // Capitalize first letter
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }
  }

  // Fallback: first sentence, trimmed
  const firstSentence = text.split(/[.!?\n]/).find(s => s.trim().length > 10);
  if (firstSentence) {
    const trimmed = firstSentence.trim().slice(0, 80);
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }

  return 'Architectural Decision';
}

/**
 * Build surrounding context from the preceding user message(s).
 */
function extractContext(messages: TranscriptMessage[], decisionIdx: number): string {
  // Look back for the most recent user message to establish context
  for (let i = decisionIdx - 1; i >= Math.max(0, decisionIdx - 5); i--) {
    if (messages[i].role === 'user' && messages[i].content.length > 20) {
      const userText = messages[i].content.slice(0, 500);
      return `User asked: ${userText}`;
    }
  }
  return 'Identified during a Claude Code session.';
}

/**
 * Extract consequences / implications from the decision text.
 */
function extractConsequences(text: string): string {
  // Look for explicit consequence markers
  const consequencePatterns = [
    /(?:this\s+means|this\s+will|as\s+a\s+result|consequence|downside|upside|benefit|drawback|implication)\s*[:\-]?\s*(.{10,300})/i,
    /(?:trade-?off)\s+(?:is|here\s+is)\s*[:\-]?\s*(.{10,300})/i,
    /(?:instead\s+of|rather\s+than)\s+(.{10,200})/i,
  ];

  const consequences: string[] = [];
  for (const p of consequencePatterns) {
    const match = p.exec(text);
    if (match) {
      consequences.push(match[1].trim().replace(/\n/g, ' ').slice(0, 200));
    }
  }

  if (consequences.length > 0) {
    return consequences.map(c => `- ${c}`).join('\n');
  }

  return 'To be evaluated as the implementation progresses.';
}

/**
 * Scan transcript messages and detect significant architectural decisions.
 */
export function detectDecisions(messages: TranscriptMessage[]): DetectedDecision[] {
  const decisions: DetectedDecision[] = [];
  const seenTitles = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || msg.type !== 'text') continue;
    if (msg.content.length < MIN_TEXT_LENGTH) continue;

    const score = scoreDecisionSignals(msg.content);
    if (score < MIN_SIGNAL_WEIGHT) continue;

    const title = extractTitle(msg.content);

    // De-duplicate by title similarity
    const titleLower = title.toLowerCase();
    if (seenTitles.has(titleLower)) continue;
    seenTitles.add(titleLower);

    const context = extractContext(messages, i);
    const consequences = extractConsequences(msg.content);

    // Trim decision text to a reasonable excerpt
    const decisionText = msg.content.length > 600
      ? msg.content.slice(0, 600) + '...'
      : msg.content;

    decisions.push({
      title: `ADR: ${title}`,
      context,
      decision: decisionText,
      consequences,
      sourceText: msg.content.slice(0, 200),
    });

    if (decisions.length >= MAX_DECISIONS_PER_SESSION) break;
  }

  return decisions;
}

/**
 * Format a detected decision as an ADR markdown entry for the KB.
 */
function formatADRContent(decision: DetectedDecision): string {
  return [
    '## Status',
    'Accepted',
    '',
    '## Context',
    decision.context,
    '',
    '## Decision',
    decision.decision,
    '',
    '## Consequences',
    decision.consequences,
  ].join('\n');
}

/**
 * Convert detected decisions into KBEntryInput objects ready for insertion.
 */
export function decisionsToKBEntries(
  decisions: DetectedDecision[],
  sessionId: string,
  projectName?: string,
): KBEntryInput[] {
  return decisions.map(d => ({
    title: d.title,
    content: formatADRContent(d),
    category: 'decision',
    tags: ['auto-detected', projectName ?? 'unknown-project'].filter(Boolean).join(','),
    scope: 'shared' as const,
    scope_owner: '',
    source: `claude-session:${sessionId}`,
    created_by: 'hive-decision-detector',
  }));
}

/**
 * Main entry point: scan a transcript file for decisions and return KB entries.
 * Called from the stop hook handler after a session ends.
 */
export function scanTranscriptForDecisions(
  transcriptPath: string,
  sessionId: string,
  projectName?: string,
): KBEntryInput[] {
  try {
    const messages = parseTranscriptFile(transcriptPath);
    if (messages.length === 0) return [];

    const decisions = detectDecisions(messages);
    if (decisions.length === 0) return [];

    console.log(`[decision-detector] Found ${decisions.length} decision(s) in session ${sessionId}`);
    return decisionsToKBEntries(decisions, sessionId, projectName);
  } catch (err) {
    console.error(`[decision-detector] Error scanning transcript:`, err);
    return [];
  }
}
