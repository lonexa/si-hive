/**
 * Built-in action: AI Daily Briefing.
 *
 * Once per day, spawns Claude Code in headless mode and asks it to use the
 * `claude-daily` skill to generate today's AI industry briefing (Anthropic,
 * OpenAI, Google DeepMind, Meta, and broader AI news). The skill writes the
 * rendered HTML to `~/.hive/daily/<YYYY-MM-DD>.html` and a small sidecar JSON
 * to `~/.hive/daily/<YYYY-MM-DD>.json` listing the URLs / titles it covered.
 *
 * **Cross-instance dedup.** Dedup history must work across Hive instances
 * because the daily claim can be won by any dev machine. We read past N
 * runs from the DB (WorkflowRuns.dataJson.items) — the one piece of state
 * every instance shares — and pass the union of URLs/titles to the skill
 * as excludeUrls/excludeTitles. The local on-disk sidecars are kept as a
 * fallback (and so the skill is still useful for standalone manual runs
 * outside Hive) but the DB run history is the authoritative source when
 * a workflowId is available.
 *
 * **Sidecar fallback.** If the skill didn't write the sidecar (older skill
 * version, or it forgot), this action extracts URLs from the rendered HTML
 * and writes both the sidecar and the dataJson items list itself — so dedup
 * keeps working regardless.
 *
 * The returned ActionResult stuffs the full HTML under `dataJson.html` so
 * the connector dispatcher can email it via the `raw_html` template, and
 * the items list under `dataJson.items` so tomorrow's run can query it.
 *
 * Once-per-day exactly-once semantics come from the scheduler's day-anchor
 * claim. Structural failures (Claude CLI missing, skill missing) don't
 * release the claim (see workflow-scheduler.ts).
 */

import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { claudeExePath, isClaudeInstalled } from '../../claude/detect.js';
import { getWorkflowRunDataRecent } from '../workflow-db.js';
import type { ActionResult, ActionContext } from './index.js';
import { hivePath } from '../../../../../packages/shared/src/server/paths.js';

const DAILY_DIR = hivePath('daily');
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const DEDUP_LOOKBACK_DAYS = 7;

/**
 * Rich history-item schema (adopted from the original developer's skill).
 * Older runs and HTML-fallback items just have {url, title?} — the action
 * normalizes both shapes when building the history array passed to the skill.
 */
interface HistoryItem {
  date?: string;
  topic?: string;
  category?: 'top_story' | 'claude_corner' | 'across_ecosystem' | 'from_x' | 'on_the_radar' | 'updated_story';
  player?: string;
  summary?: string;
  sources?: string[];
  // Legacy fields from earlier versions of this action
  url?: string;
  title?: string;
}

interface Sidecar {
  date: string;
  // Older sidecars used `items`; the new richer format is also `items`, just
  // with the fuller per-item schema. Same field name, different shape.
  items: HistoryItem[];
}

function dateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function loadRecentSidecars(now: Date): Promise<Sidecar[]> {
  const sidecars: Sidecar[] = [];
  for (let i = 1; i <= DEDUP_LOOKBACK_DAYS; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const sidecarPath = path.join(DAILY_DIR, `${dateString(d)}.json`);
    try {
      const text = await fsp.readFile(sidecarPath, 'utf-8');
      const parsed = JSON.parse(text);
      // Accept two shapes: the new {date, items[]} envelope and the bare
      // [HistoryItem] array used by the original developer's skill.
      if (Array.isArray(parsed)) {
        sidecars.push({ date: dateString(d), items: parsed as HistoryItem[] });
      } else if (parsed && Array.isArray(parsed.items)) {
        sidecars.push(parsed as Sidecar);
      }
    } catch {
      // Missing sidecar for that day is fine.
    }
  }
  return sidecars;
}

/**
 * Load items from the last N runs of this workflow in the DB. This is the
 * cross-machine source of truth: whatever Hive instance won yesterday's claim
 * wrote items to WorkflowRuns.dataJson, and any instance can read them today.
 */
async function loadRecentItemsFromDb(workflowId: number): Promise<HistoryItem[]> {
  if (!workflowId) return [];
  try {
    const rows = await getWorkflowRunDataRecent(workflowId, DEDUP_LOOKBACK_DAYS + 3);
    const items: HistoryItem[] = [];
    for (const row of rows) {
      try {
        const data = JSON.parse(row.dataJson) as { items?: HistoryItem[] };
        if (Array.isArray(data.items)) items.push(...data.items);
      } catch {
        // Old runs (before items was added) won't parse — fine.
      }
    }
    return items;
  } catch (err) {
    console.warn(`[claude-daily] DB dedup history fetch failed for workflow ${workflowId}:`, err);
    return [];
  }
}

/**
 * Deduplicate history items. Prefers richer items (topic + summary + sources)
 * over thinner ones (url-only fallback) when both describe the same topic.
 * Items are uniqued by topic+date, falling back to URL when topic is missing.
 */
function dedupeHistory(items: HistoryItem[]): HistoryItem[] {
  const byKey = new Map<string, HistoryItem>();
  for (const item of items) {
    const key = item.topic
      ? `topic:${item.topic.toLowerCase()}`
      : item.url
        ? `url:${item.url}`
        : item.title
          ? `title:${item.title.toLowerCase()}`
          : `random:${Math.random()}`;
    const existing = byKey.get(key);
    // Prefer the item with a topic + summary over a url-only entry
    const richness = (i: HistoryItem): number =>
      (i.topic ? 2 : 0) + (i.summary ? 2 : 0) + (i.sources?.length ? 1 : 0);
    if (!existing || richness(item) > richness(existing)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

/**
 * Pull http/https URLs out of the rendered HTML. Used to construct a sidecar
 * after the fact if the skill didn't write one itself. We only keep one URL
 * per host+path so we don't blow up the exclusion set with tracking params.
 */
function extractUrlsFromHtml(html: string): string[] {
  const seen = new Set<string>();
  const re = /href="(https?:\/\/[^"#]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      const u = new URL(match[1]);
      const key = `${u.protocol}//${u.host}${u.pathname}`;
      seen.add(key);
    } catch {
      // Skip malformed URLs
    }
  }
  return [...seen];
}

function spawnClaude(prompt: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    let cmd = claudeExePath();
    const args = ['--dangerously-skip-permissions', '--print', '--output-format', 'text'];

    // The prompt is ALWAYS delivered on stdin — never as an argv argument.
    // The dedup `history` payload grows day over day and can push the prompt
    // well past the OS command-line length limit (~32 KB on Windows), which
    // previously surfaced as `spawn ENAMETOOLONG` and failed the run almost
    // every day on machines where claude resolved to `claude.exe` (the old
    // code only wrote to stdin for the `.cmd`/`.bat` branch and otherwise
    // pushed the whole prompt onto argv). `claude --print` reads the prompt
    // from stdin when no positional prompt is given.
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) {
      // .cmd/.bat can't be exec'd directly by spawn() without a shell — run
      // them through cmd.exe. Node applies cmd.exe-specific quoting, so a path
      // with spaces is handled correctly.
      args.unshift('/c', cmd);
      cmd = process.env.ComSpec || 'cmd.exe';
    }

    console.log(`[claude-daily] Spawning: ${cmd} (${args.length} args, prompt via stdin)`);

    const proc = spawn(cmd, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined },
    });

    proc.stdin?.write(prompt);
    proc.stdin?.end();

    let output = '';
    const MAX_BYTES = 2 * 1024 * 1024;
    let bytes = 0;
    const append = (chunk: Buffer): void => {
      if (bytes >= MAX_BYTES) return;
      const text = chunk.toString('utf-8');
      output += text;
      bytes += text.length;
    };
    proc.stdout?.on('data', append);
    proc.stderr?.on('data', append);

    const killTimer = setTimeout(() => {
      console.warn('[claude-daily] Claude exceeded timeout, killing');
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    }, RUN_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(killTimer);
      console.log(`[claude-daily] Claude exited with code ${code}, output length: ${output.length}`);
      resolve({ code, output });
    });
    proc.on('error', (err) => {
      clearTimeout(killTimer);
      reject(err);
    });
  });
}

export async function runClaudeDaily(ctx?: ActionContext): Promise<ActionResult> {
  if (!isClaudeInstalled()) {
    return {
      output: '',
      errorMessage: `Claude CLI not found at ${claudeExePath()} on this machine. Releasing the daily claim so another SI Hive instance can run it.`,
    };
  }

  await fsp.mkdir(DAILY_DIR, { recursive: true });
  const now = new Date();
  const dateStr = dateString(now);
  const outputPath = path.join(DAILY_DIR, `${dateStr}.html`);
  const sidecarPath = path.join(DAILY_DIR, `${dateStr}.json`);

  // Clean today's prior outputs so we know what's newly written.
  try { await fsp.unlink(outputPath); } catch { /* not present, fine */ }
  try { await fsp.unlink(sidecarPath); } catch { /* not present, fine */ }

  // Build the history array by unioning two sources, then deduping:
  //   1. DB run history — works across all Hive instances (any machine that
  //      ran the workflow contributes its items). Authoritative when a
  //      workflowId is available.
  //   2. Local on-disk sidecars — covers items from runs before this code
  //      was deployed (no DB items), and supports standalone skill use
  //      outside Hive.
  const [dbItems, sidecars] = await Promise.all([
    loadRecentItemsFromDb(ctx?.workflowId ?? 0),
    loadRecentSidecars(now),
  ]);
  const sidecarItems = sidecars.flatMap((sc) => sc.items);
  const history = dedupeHistory([...dbItems, ...sidecarItems]);
  console.log(
    `[claude-daily] Dedup history: ${dbItems.length} item(s) from DB + ${sidecarItems.length} from local sidecars → ${history.length} unique history entries passed to skill`,
  );

  const inputs = {
    outputPath,
    sidecarPath,
    history,
  };

  // The prompt names the skill so Claude Code loads it even without trigger
  // keywords, then hands over the JSON inputs as both stdin (Windows) and the
  // prompt body so the skill can parse them either way.
  const prompt = [
    `Use the claude-daily skill to generate today's AI Daily briefing.`,
    `Today's date is ${dateStr}.`,
    ``,
    `Inputs (as JSON):`,
    JSON.stringify(inputs, null, 2),
    ``,
    `When done, print the two "Wrote <path> (<bytes>)" lines so I can verify.`,
  ].join('\n');

  let claudeOutput = '';
  try {
    const result = await spawnClaude(prompt);
    claudeOutput = result.output;
    if (result.code !== 0) {
      return {
        output: claudeOutput.slice(0, 4000),
        errorMessage: `Claude CLI exited with code ${result.code}. Releasing daily claim for retry.`,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      output: claudeOutput,
      errorMessage: `Failed to spawn Claude: ${msg}`,
    };
  }

  let html: string;
  try {
    html = await fsp.readFile(outputPath, 'utf-8');
  } catch {
    return {
      output: claudeOutput.slice(0, 4000),
      errorMessage: `Claude finished but did not produce ${outputPath}. See run output for details.`,
    };
  }

  if (html.length < 500 || !/<\/html>/i.test(html)) {
    return {
      output: claudeOutput.slice(0, 4000),
      errorMessage: `Generated HTML at ${outputPath} looks truncated or malformed (${html.length} bytes). Releasing daily claim for retry.`,
    };
  }

  // Resolve today's item list from two sources, in order of preference:
  //   1. The skill's own sidecar JSON (rich items with topic/category/player/summary/sources)
  //   2. Fallback: every http(s) link found in the rendered HTML (url-only items)
  // The chosen list is written BOTH to the on-disk sidecar AND stored in
  // dataJson.items so tomorrow's run can find it via the DB regardless of
  // which Hive instance won today.
  let items: HistoryItem[] = [];
  try {
    const text = await fsp.readFile(sidecarPath, 'utf-8');
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      // Bare-array format (original developer's skill convention)
      items = parsed as HistoryItem[];
    } else if (parsed && Array.isArray(parsed.items)) {
      // {date, items[]} envelope
      items = parsed.items as HistoryItem[];
    }
  } catch {
    const urls = extractUrlsFromHtml(html);
    items = urls.map((url) => ({ url, date: dateStr }));
    const fallback: Sidecar = { date: dateStr, items };
    await fsp.writeFile(sidecarPath, JSON.stringify(fallback, null, 2), 'utf-8');
    console.log(`[claude-daily] Skill didn't write sidecar; wrote URL-only fallback with ${urls.length} URL(s)`);
  }

  const summary = [
    `AI Daily briefing generated on ${os.hostname()}.`,
    `Date: ${dateStr}`,
    `File: ${outputPath} (${html.length.toLocaleString()} bytes)`,
    `Passed ${history.length} history entries to the skill for dedup.`,
    `Recorded ${items.length} item(s) in today's run for tomorrow's dedup.`,
  ].join('\n');

  return {
    output: summary,
    dataJson: JSON.stringify({
      html,
      date: dateStr,
      path: outputPath,
      bytes: html.length,
      // items is the cross-machine dedup state — tomorrow's run reads this via
      // getWorkflowRunDataRecent regardless of which machine wrote it.
      items,
    }),
  };
}
