/**
 * Usage stats and plans limited to this install's project folders.
 *
 * Claude Code's own `stats-cache.json` and `plans/` directory are
 * machine-wide with no project attached. When project folders are
 * configured (see project-scope.ts), Hive derives both from the session
 * transcripts that ran inside those folders instead:
 *   - usage stats: messages, sessions, tool calls, tokens per model, hours
 *   - plans: the plan files those sessions wrote (Write/Edit of plans/*.md)
 *
 * Parsed per file and cached by mtime, so repeat calls only re-read
 * transcripts that changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { HiveConfig } from '../types.js';
import { isProjectDirInScope, isPathInScope } from '../project-scope.js';

interface ModelTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

interface FileSummary {
  sessionId: string;
  /** Working directory recorded in the transcript (authoritative scope check). */
  cwd?: string;
  firstTs?: string;
  lastTs?: string;
  messages: number;
  /** date → { messages, toolCalls } */
  days: Record<string, { messages: number; toolCalls: number }>;
  /** date → model → output+input tokens */
  dayTokens: Record<string, Record<string, number>>;
  models: Record<string, ModelTotals>;
  hours: Record<string, number>;
  /** Plan file slugs this session wrote. */
  plans: string[];
}

const cache = new Map<string, { mtimeMs: number; summary: FileSummary }>();
const PLAN_PATH = /[\\/]plans[\\/]+([^\\/]+)\.md$/i;

function summarize(filePath: string): FileSummary {
  const summary: FileSummary = {
    sessionId: path.basename(filePath, '.jsonl'),
    messages: 0,
    days: {},
    dayTokens: {},
    models: {},
    hours: {},
    plans: [],
  };
  const plans = new Set<string>();
  let raw = '';
  try { raw = fs.readFileSync(filePath, 'utf-8'); } catch { return summary; }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let e: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { e = JSON.parse(line); } catch { continue; }
    if (!summary.cwd && typeof e.cwd === 'string') summary.cwd = e.cwd;
    const ts: string | undefined = typeof e.timestamp === 'string' ? e.timestamp : undefined;
    if (e.type !== 'user' && e.type !== 'assistant') continue;
    if (!ts) continue;
    summary.firstTs ??= ts;
    summary.lastTs = ts;
    const day = ts.slice(0, 10);
    const d = (summary.days[day] ??= { messages: 0, toolCalls: 0 });
    d.messages++;
    summary.messages++;
    const hour = String(new Date(ts).getHours());
    summary.hours[hour] = (summary.hours[hour] ?? 0) + 1;

    const msg = e.message;
    if (e.type !== 'assistant' || !msg) continue;
    const content: any[] = Array.isArray(msg.content) ? msg.content : []; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const c of content) {
      if (c?.type !== 'tool_use') continue;
      d.toolCalls++;
      const file = c.input?.file_path;
      if ((c.name === 'Write' || c.name === 'Edit') && typeof file === 'string') {
        const m = PLAN_PATH.exec(file);
        if (m) plans.add(m[1]);
      }
    }
    const model = typeof msg.model === 'string' ? msg.model : null;
    const u = msg.usage;
    if (model && u && model !== '<synthetic>') {
      const t = (summary.models[model] ??= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 });
      t.inputTokens += u.input_tokens ?? 0;
      t.outputTokens += u.output_tokens ?? 0;
      t.cacheReadInputTokens += u.cache_read_input_tokens ?? 0;
      t.cacheCreationInputTokens += u.cache_creation_input_tokens ?? 0;
      const dt = (summary.dayTokens[day] ??= {});
      dt[model] = (dt[model] ?? 0) + (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
    }
  }
  summary.plans = [...plans];
  return summary;
}

/** Summaries of every in-scope top-level session transcript. */
function scopedSummaries(config: HiveConfig): FileSummary[] {
  const projectsDir = path.join(config.claudeHome, 'projects');
  if (!fs.existsSync(projectsDir)) return [];
  const out: FileSummary[] = [];
  const seen = new Set<string>();
  for (const dir of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!dir.isDirectory() || !isProjectDirInScope(config, dir.name)) continue;
    const dirPath = path.join(projectsDir, dir.name);
    let files: string[] = [];
    try { files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const filePath = path.join(dirPath, f);
      seen.add(filePath);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch { continue; }
      const hit = cache.get(filePath);
      const summary = hit && hit.mtimeMs === mtimeMs ? hit.summary : summarize(filePath);
      if (!hit || hit.mtimeMs !== mtimeMs) cache.set(filePath, { mtimeMs, summary });
      // The encoded folder name is lossy; confirm with the recorded cwd.
      if (summary.cwd && !isPathInScope(config, summary.cwd)) continue;
      out.push(summary);
    }
  }
  for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);
  return out;
}

/** Same shape as Claude Code's stats-cache.json, computed from in-scope sessions. */
export function computeScopedStats(config: HiveConfig) {
  const summaries = scopedSummaries(config);
  const days: Record<string, { messageCount: number; sessionCount: number; toolCallCount: number }> = {};
  const dayTokens: Record<string, Record<string, number>> = {};
  const modelUsage: Record<string, ModelTotals & { webSearchRequests: number; costUSD: number; contextWindow: number; maxOutputTokens: number }> = {};
  const hourCounts: Record<string, number> = {};
  let totalMessages = 0;
  let firstSessionDate = '';
  let longest = { sessionId: '', duration: 0, messageCount: 0, timestamp: '' };

  for (const s of summaries) {
    totalMessages += s.messages;
    if (s.firstTs && (!firstSessionDate || s.firstTs < firstSessionDate)) firstSessionDate = s.firstTs;
    for (const [day, v] of Object.entries(s.days)) {
      const d = (days[day] ??= { messageCount: 0, sessionCount: 0, toolCallCount: 0 });
      d.messageCount += v.messages;
      d.toolCallCount += v.toolCalls;
      d.sessionCount++;
    }
    for (const [day, byModel] of Object.entries(s.dayTokens)) {
      const dt = (dayTokens[day] ??= {});
      for (const [m, n] of Object.entries(byModel)) dt[m] = (dt[m] ?? 0) + n;
    }
    for (const [m, t] of Object.entries(s.models)) {
      const mu = (modelUsage[m] ??= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0, contextWindow: 0, maxOutputTokens: 0 });
      mu.inputTokens += t.inputTokens;
      mu.outputTokens += t.outputTokens;
      mu.cacheReadInputTokens += t.cacheReadInputTokens;
      mu.cacheCreationInputTokens += t.cacheCreationInputTokens;
    }
    for (const [h, n] of Object.entries(s.hours)) hourCounts[h] = (hourCounts[h] ?? 0) + n;
    const duration = s.firstTs && s.lastTs ? Date.parse(s.lastTs) - Date.parse(s.firstTs) : 0;
    if (duration > longest.duration) longest = { sessionId: s.sessionId, duration, messageCount: s.messages, timestamp: s.firstTs ?? '' };
  }

  const sortedDays = Object.keys(days).sort();
  return {
    version: 1,
    lastComputedDate: new Date().toISOString().slice(0, 10),
    dailyActivity: sortedDays.map((date) => ({ date, ...days[date] })),
    dailyModelTokens: Object.keys(dayTokens).sort().map((date) => ({ date, tokensByModel: dayTokens[date] })),
    modelUsage,
    totalSessions: summaries.length,
    totalMessages,
    longestSession: longest,
    firstSessionDate,
    hourCounts,
    totalSpeculationTimeSavedMs: 0,
  };
}

/** Plan slugs written by in-scope sessions. */
export function scopedPlanSlugs(config: HiveConfig): Set<string> {
  const slugs = new Set<string>();
  for (const s of scopedSummaries(config)) for (const p of s.plans) slugs.add(p);
  return slugs;
}
