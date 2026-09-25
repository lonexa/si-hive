import type { Terminal, IDisposable } from '@xterm/xterm';

import { getTicketRefPattern, ticketKeyFromMatch } from './work-item-fetch';

export interface WorkItemDecorationCallbacks {
  /** Click on a matched work item — receives the ID and the click event. */
  onClick: (key: string, event: MouseEvent) => void;
}

export interface WorkItemDecorationController {
  /** Trigger a buffer scan. Cheap to call after every output chunk. */
  scanVisible: () => void;
  dispose: () => void;
}

interface DecoEntry {
  decoration: IDisposable;
  marker: IDisposable;
  onRender: IDisposable;
}

/**
 * Attach persistent underline-style decorations to every work-item mention
 * Hive can detect in the terminal buffer (using the connected tracker's
 * reference pattern, e.g. `#123`, `ABC-42`). Each decoration is clickable;
 * clicking it triggers `onClick(id)`. Decorations follow the buffer through
 * scrollback (they're anchored to xterm markers), so even after lots of
 * subsequent output the underline stays attached to the right line.
 *
 * Implementation: after each output chunk we scan the lines that fall in
 * the active buffer range (a bounded window) and register decorations for
 * any matches we haven't seen yet. Per-buffer-line dedup avoids re-painting
 * the same line when streaming spans multiple chunks.
 */
export function attachWorkItemDecorations(
  term: Terminal,
  callbacks: WorkItemDecorationCallbacks,
): WorkItemDecorationController {
  const seen = new Map<string, DecoEntry>();
  const MAX_DECOS = 500;

  function paintMatch(absLine: number, startCol: number, length: number, id: string) {
    const key = `${absLine}:${startCol}:${id}`;
    if (seen.has(key)) return;

    const buf = term.buffer.active;
    const cursorY = buf.cursorY;
    const offset = absLine - (buf.baseY + cursorY);
    let marker: IDisposable | null = null;
    try {
      marker = term.registerMarker(offset);
    } catch { marker = null; }
    if (!marker) return;

    const decoration = term.registerDecoration({
      marker: marker as ReturnType<Terminal['registerMarker']>,
      x: startCol,
      width: Math.min(length, term.cols - startCol),
      height: 1,
    });
    if (!decoration) {
      try { marker.dispose(); } catch { /* ignore */ }
      return;
    }

    const onRender = decoration.onRender((el: HTMLElement) => {
      el.style.boxShadow = 'inset 0 -1px 0 currentColor';
      el.style.color = '#60a5fa'; // blue-400
      el.style.cursor = 'pointer';
      el.style.pointerEvents = 'auto';
      el.title = `Ticket ${id} — click to open`;
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        callbacks.onClick(id, e);
      });
    });

    seen.set(key, { decoration, marker, onRender });

    // Cap stored decorations FIFO so a runaway session can't leak.
    if (seen.size > MAX_DECOS) {
      const firstKey = seen.keys().next().value;
      if (firstKey !== undefined) {
        const entry = seen.get(firstKey);
        if (entry) {
          try { entry.onRender.dispose(); } catch { /* ignore */ }
          try { entry.decoration.dispose(); } catch { /* ignore */ }
          try { entry.marker.dispose(); } catch { /* ignore */ }
        }
        seen.delete(firstKey);
      }
    }
  }

  function scanLine(absLine: number) {
    const pattern = getTicketRefPattern();
    if (!pattern) return; // no tracker connected
    const line = term.buffer.active.getLine(absLine);
    if (!line) return;
    const text = line.translateToString(true);
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[0].length === 0) { pattern.lastIndex++; continue; }
      paintMatch(absLine, m.index, m[0].length, ticketKeyFromMatch(m));
    }
  }

  function scanVisible() {
    const buf = term.buffer.active;
    const total = buf.length;
    const start = Math.max(0, total - 500); // cap to last 500 lines to bound cost
    for (let line = start; line < total; line++) {
      scanLine(line);
    }
  }

  return {
    scanVisible,
    dispose() {
      for (const entry of seen.values()) {
        try { entry.onRender.dispose(); } catch { /* ignore */ }
        try { entry.decoration.dispose(); } catch { /* ignore */ }
        try { entry.marker.dispose(); } catch { /* ignore */ }
      }
      seen.clear();
    },
  };
}
