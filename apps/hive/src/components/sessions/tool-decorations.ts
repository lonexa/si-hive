import type { Terminal, IDisposable } from '@xterm/xterm';

/**
 * Colored left-edge gutter bar per Claude tool-call type. The bar makes long
 * transcripts visually scannable: at a glance you can see which sections are
 * reads, which are bash, which are edits, etc.
 *
 * Detection is line-based: when the WS handler is about to write a chunk we
 * call `noteChunk(chunk)`. The accumulator splits on '\n' and, for each
 * completed line that matches a tool-call header, registers a marker at the
 * current cursor position before the line was written. The decoration follows
 * the marker through scrollback automatically.
 */

const COLORS: Record<string, { bar: string; flash?: string }> = {
  Read:     { bar: '#3b82f6' },                   // blue
  Edit:     { bar: '#22c55e', flash: '#4ade80' }, // green + one-shot flash on completion
  Write:    { bar: '#f59e0b' },                   // amber
  Bash:     { bar: '#a855f7' },                   // violet
  Grep:     { bar: '#06b6d4' },                   // cyan
  Glob:     { bar: '#06b6d4' },                   // cyan (sibling of grep)
  Task:     { bar: '#ec4899' },                   // pink
  WebFetch: { bar: '#14b8a6' },                   // teal
  WebSearch:{ bar: '#14b8a6' },                   // teal
};

// Modern Claude TUI tool-header pattern. Examples seen in the live stream:
//   ● Listing 1 directory… (ctrl+o to expand)
//   ● Reading file.ts… (ctrl+o to expand)
//   ● Editing file.ts…
//   ● Searched for "foo"
// We REQUIRE the verb to end in -ing or -ed; without that constraint Claude's
// own response lines (e.g. "● Directory contents listed above…") false-match
// on nouns like "Directory".
const TOOL_HEAD_RE = /^\s*●\s+([A-Z][a-z]+(?:ing|ed))\b/;

const TOOL_RESULT_RE = /^\s*[⎿└]/;

// Map of Claude-TUI verbs to underlying tool name for color selection.
// Unknown -ing/-ed verbs fall back to Bash (violet) so they still get a bar.
const VERB_TO_TOOL: Record<string, string> = {
  Listing: 'Bash', Listed: 'Bash',
  Running: 'Bash', Ran: 'Bash', Executing: 'Bash', Executed: 'Bash',
  Bashing: 'Bash',
  Reading: 'Read', Read: 'Read',
  Editing: 'Edit', Edited: 'Edit',
  Updating: 'Edit', Updated: 'Edit',
  Patching: 'Edit', Patched: 'Edit',
  Writing: 'Write', Wrote: 'Write',
  Creating: 'Write', Created: 'Write',
  Searching: 'Grep', Searched: 'Grep',
  Grepping: 'Grep', Grepped: 'Grep',
  Looking: 'Glob', Looked: 'Glob',
  Globbing: 'Glob', Globbed: 'Glob',
  Finding: 'Glob', Found: 'Glob',
  Fetching: 'WebFetch', Fetched: 'WebFetch',
  Browsing: 'WebSearch', Browsed: 'WebSearch',
  Querying: 'WebSearch', Queried: 'WebSearch',
  Delegating: 'Task', Delegated: 'Task',
};

const STRIP_ANSI = /\x1b\[[0-9;?!>]*[a-zA-Z~]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-Z]/g;

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec === 0 ? `${min}m` : `${min}m${sec}s`;
}

export interface ToolDecorationController {
  /** Call from ws.onmessage with the raw chunk *before* term.write. */
  noteChunk: (chunk: string) => void;
  dispose: () => void;
}

export interface ToolDecorationOptions {
  /** Fired when a tool-call header line is detected. */
  onToolStart?: (toolName: string, arg: string) => void;
  /** Fired when a tool-result line (⎿ …) is detected. */
  onToolResult?: () => void;
  /** When true, paint a right-aligned `⏱ Xs` chip on each result line. */
  timingChips?: boolean;
}

/**
 * Attach gutter-bar decorations to the given terminal. The controller's
 * `noteChunk` should be called with every output chunk before it is written
 * to xterm so we can capture cursor positions accurately.
 */
export function attachToolDecorations(
  term: Terminal,
  options: ToolDecorationOptions = {},
): ToolDecorationController {
  let lineBuf = '';
  const disposables: IDisposable[] = [];
  // Cap on outstanding decorations so a runaway session can't leak DOM.
  const decoQueue: IDisposable[] = [];
  const MAX_DECOS = 500;
  let pendingTool: { name: string; startedAt: number } | null = null;

  function ensureCap() {
    while (decoQueue.length > MAX_DECOS) {
      const old = decoQueue.shift();
      try { old?.dispose(); } catch { /* ignore */ }
    }
  }

  function paintAtCurrentRow(toolName: string) {
    const spec = COLORS[toolName];
    if (!spec) return;
    try {
      // Marker at the row that holds the tool-call header (offset -1 from
      // current cursor since the microtask fires after term.write).
      const marker = term.registerMarker(-1);
      if (!marker) return;
      disposables.push(marker);
      const deco = term.registerDecoration({
        marker,
        x: 0,
        width: 1,
        height: 1,
      });
      if (!deco) return;
      decoQueue.push(deco);
      ensureCap();
      const onRender = deco.onRender((el: HTMLElement) => {
        el.style.background = spec.bar;
        el.style.borderRadius = '2px';
        el.style.opacity = '0.9';
        el.style.pointerEvents = 'none';
        if (spec.flash) {
          el.style.transition = 'box-shadow 600ms ease-out';
          el.style.boxShadow = `0 0 6px ${spec.flash}`;
          setTimeout(() => { el.style.boxShadow = 'none'; }, 700);
        }
      });
      disposables.push(onRender);
    } catch { /* xterm internals raised; skip silently */ }
  }

  function paintTimingChip(elapsedMs: number, toolName: string) {
    const spec = COLORS[toolName];
    if (!spec) return;
    const text = formatElapsed(elapsedMs);
    const label = `⏱ ${text}`;
    try {
      const marker = term.registerMarker(-1);
      if (!marker) return;
      disposables.push(marker);
      const width = Math.max(4, label.length + 1);
      const startCol = Math.max(0, term.cols - width - 1);
      const deco = term.registerDecoration({
        marker,
        x: startCol,
        width,
        height: 1,
      });
      if (!deco) return;
      decoQueue.push(deco);
      ensureCap();
      const onRender = deco.onRender((el: HTMLElement) => {
        el.style.color = spec.bar;
        el.style.opacity = '0.78';
        el.style.fontSize = '11px';
        el.style.fontFamily = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace";
        el.style.fontWeight = '500';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'flex-end';
        el.style.whiteSpace = 'nowrap';
        el.style.pointerEvents = 'none';
        el.style.background = 'rgba(10, 10, 10, 0.55)';
        el.style.borderRadius = '3px';
        el.style.padding = '0 4px';
        el.textContent = label;
      });
      disposables.push(onRender);
    } catch { /* ignore */ }
  }

  // Dedup of recently-seen lines. Modern Claude TUI redraws the same row many
  // times in place as its spinner ticks, so the same `● Listing 1 directory…`
  // line will fire handleCompleteLine 20+ times for a single tool invocation.
  // Without this guard we'd register a fresh decoration per redraw.
  const recentLines = new Map<string, number>();
  function dedupSeen(clean: string): boolean {
    const now = performance.now();
    const seen = recentLines.get(clean);
    recentLines.set(clean, now);
    if (recentLines.size > 200) {
      for (const [k, t] of recentLines) {
        if (now - t > 5000) recentLines.delete(k);
      }
    }
    return seen !== undefined && now - seen < 2000;
  }

  function handleCompleteLine(rawLine: string) {
    const clean = rawLine.replace(STRIP_ANSI, '').trim();
    if (clean.length === 0) return;
    if (dedupSeen(clean)) return;

    if (TOOL_RESULT_RE.test(clean)) {
      if (pendingTool && options.timingChips) {
        const elapsedMs = performance.now() - pendingTool.startedAt;
        paintTimingChip(elapsedMs, pendingTool.name);
      }
      pendingTool = null;
      options.onToolResult?.();
      return;
    }
    const m = TOOL_HEAD_RE.exec(clean);
    if (!m) return;
    const verb = m[1];
    const toolName = VERB_TO_TOOL[verb] ?? 'Bash';
    paintAtCurrentRow(toolName);
    pendingTool = { name: toolName, startedAt: performance.now() };
    options.onToolStart?.(toolName, '');
  }

  return {
    noteChunk(chunk: string) {
      lineBuf += chunk;
      if (lineBuf.length > 8192) lineBuf = lineBuf.slice(-4096);
      const parts = lineBuf.split(/\r?\n/);
      lineBuf = parts.pop() ?? '';
      for (const line of parts) {
        if (line.length === 0) continue;
        const captured = line;
        queueMicrotask(() => handleCompleteLine(captured));
      }
    },
    dispose() {
      for (const d of disposables) {
        try { d.dispose(); } catch { /* ignore */ }
      }
      for (const d of decoQueue) {
        try { d.dispose(); } catch { /* ignore */ }
      }
      disposables.length = 0;
      decoQueue.length = 0;
      lineBuf = '';
      pendingTool = null;
    },
  };
}
