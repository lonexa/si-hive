import type { TrackerProvider } from '../integrations/types.js';
import { complete, isLlmConfigured } from '../ai/llm.js';
import { searchAll, type SearchHit, type SearchResults } from './search-client.js';

// Common words that carry no retrieval signal — dropped before keyword search.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'about', 'from', 'into',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'done', 'have', 'has', 'had',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'that', 'this', 'these', 'those',
  'we', 'i', 'you', 'they', 'it', 'our', 'my', 'your', 'their', 'me', 'us', 'them',
  'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must',
  'any', 'all', 'some', 'there', 'here', 'as', 'at', 'by', 'so', 'if', 'then', 'than', 'use', 'used', 'using',
  'get', 'got', 'tell', 'show', 'find', 'know', 'need', 'want', 'please', 'hive', 'team',
]);

/**
 * Pull the salient keywords out of a natural-language question. A RAG box must
 * not search literally for the whole sentence — the underlying sources match by
 * substring/CONTAINS, so "what did we decide about X?" matches nothing. We strip
 * stopwords/punctuation and keep the distinctive terms.
 */
function extractKeywords(question: string, max = 4): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of question.toLowerCase().split(/[^a-z0-9_+#.-]+/)) {
    const t = raw.replace(/^[.+#-]+|[.+#-]+$/g, '');
    if (t.length < 3 || STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    terms.push(t);
  }
  // Prefer longer (more distinctive) terms first.
  return terms.sort((a, b) => b.length - a.length).slice(0, max);
}

function mergeResults(parts: SearchResults[]): SearchResults {
  const dedup = (arr: SearchHit[][]): SearchHit[] => {
    const out: SearchHit[] = [];
    const seen = new Set<string>();
    for (const list of arr) for (const h of list) {
      const key = `${h.source}:${h.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
    }
    return out;
  };
  return {
    query: parts.map((p) => p.query).join(' | '),
    kb: dedup(parts.map((p) => p.kb)),
    workItems: dedup(parts.map((p) => p.workItems)),
    sessions: dedup(parts.map((p) => p.sessions)),
    people: dedup(parts.map((p) => p.people)),
    warnings: [...new Set(parts.flatMap((p) => p.warnings))],
  };
}

/**
 * Retrieve context for a question: search the whole phrase (catches exact
 * matches) AND each extracted keyword (catches everything else), then merge.
 */
async function retrieve(question: string, tracker: TrackerProvider | null): Promise<SearchResults> {
  const keywords = extractKeywords(question);
  const queries = [...new Set([question.trim(), ...keywords])].filter((q) => q.length >= 2);
  const parts = await Promise.all(queries.map((q) => searchAll(q, tracker)));
  return mergeResults(parts);
}

/**
 * "Ask Hive" RAG (B2.2). Retrieves context from the same federated sources as
 * universal search, then asks the configured LLM to answer using ONLY that context,
 * with inline [n] citations the UI maps back to source links.
 */

export interface AskSource {
  n: number;
  source: SearchHit['source'];
  title: string;
  url?: string;
}

export interface AskResult {
  question: string;
  answer: string | null;
  sources: AskSource[];
  warnings: string[];
  note?: string;
}

const MAX_CONTEXT_HITS = 16;
const SOURCE_LABEL: Record<SearchHit['source'], string> = {
  kb: 'Knowledge Base',
  workitem: 'Work Item',
  session: 'Session',
  person: 'Person',
};

export async function askHive(question: string, tracker: TrackerProvider | null): Promise<AskResult> {
  const results = await retrieve(question, tracker);
  const warnings = [...results.warnings];

  // Interleave sources so one chatty source can't crowd out the rest.
  const buckets = [results.kb, results.workItems, results.sessions, results.people];
  const hits: SearchHit[] = [];
  for (let i = 0; hits.length < MAX_CONTEXT_HITS; i++) {
    let added = false;
    for (const b of buckets) {
      if (b[i]) { hits.push(b[i]); added = true; if (hits.length >= MAX_CONTEXT_HITS) break; }
    }
    if (!added) break;
  }

  const sources: AskSource[] = hits.map((h, i) => ({ n: i + 1, source: h.source, title: h.title, url: h.url }));

  if (!isLlmConfigured()) {
    return { question, answer: null, sources, warnings, note: 'No AI backend is configured (Settings → AI) — showing retrieved sources only.' };
  }
  if (hits.length === 0) {
    return { question, answer: null, sources, warnings, note: 'No relevant content found across the Knowledge Base, tickets, sessions, or people.' };
  }

  const context = hits
    .map((h, i) => `[${i + 1}] (${SOURCE_LABEL[h.source]}) ${h.title}\n${h.snippet}`)
    .join('\n\n');

  const systemPrompt = [
    'You are "Ask SI Hive", a retrieval-augmented assistant for an engineering team.',
    'Answer the user\'s question using ONLY the numbered context items provided.',
    'Cite the sources you use inline with their bracket numbers, e.g. [2].',
    'If the context does not contain the answer, say so plainly — do not speculate or use outside knowledge.',
    'Be concise. Use GitHub-flavored markdown.',
  ].join('\n');

  const userPrompt = `Question: ${question}\n\nContext:\n${context}`;

  try {
    const answer = await complete(systemPrompt, userPrompt, { maxTokens: 1000 });
    return { question, answer, sources, warnings };
  } catch (err: unknown) {
    return { question, answer: null, sources, warnings, note: `AI answer unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
}
