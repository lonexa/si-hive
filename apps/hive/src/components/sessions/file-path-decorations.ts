import type { Terminal, IDisposable } from '@xterm/xterm';

/**
 * Persistent underline decorations for absolute file paths in the terminal
 * buffer. Click → opens the file in VS Code at the specified line/column.
 *
 * Detection is conservative to avoid false positives on prose:
 *   - Must start with a drive letter (Windows) or a leading slash (POSIX).
 *   - Must end in a known file extension.
 *   - Optional `:LINE` or `:LINE:COL` suffix is captured separately so we
 *     can pass it through to VS Code.
 *
 * This is a sibling of `work-item-decorations.ts` — same buffer-scan + dedup
 * pattern. They could share infrastructure later if a third pattern shows up.
 */

// Reasonable set of dev/file extensions we expect to see in Claude's output.
// Intentionally not exhaustive — favour low false-positive over completeness.
const EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'pyw', 'ipynb',
  'cs', 'csproj', 'sln', 'cshtml', 'razor',
  'sql', 'md', 'txt', 'rst',
  'json', 'jsonc', 'yml', 'yaml', 'toml', 'ini',
  'ps1', 'psm1', 'bat', 'cmd', 'sh', 'bash', 'zsh',
  'css', 'scss', 'sass', 'less', 'html', 'htm', 'xml',
  'go', 'rs', 'java', 'kt', 'rb', 'php', 'swift', 'm',
  'c', 'h', 'cpp', 'hpp', 'cc',
  'config', 'env', 'gitignore', 'gitattributes',
  'dockerfile', 'lock',
  'log', 'csv', 'tsv',
  // Image extensions intentionally excluded — those have their own inline
  // preview pipeline and don't usually want to open in VS Code.
].join('|');

// Windows absolute path: drive letter + : + slash + segments + .ext + optional :line:col
// Forbidden chars in path: < > " | ? * (\s breaks at whitespace)
const WIN_PATH = new RegExp(
  `[A-Za-z]:[\\\\/](?:[^\\s<>"'\`|?*:]+[\\\\/])*[^\\s<>"'\`|?*:]+\\.(?:${EXTENSIONS})(?::(\\d+)(?::(\\d+))?)?\\b`,
  'g',
);

// POSIX absolute path: leading / + segments + .ext + optional :line:col
const POSIX_PATH = new RegExp(
  `(?<=^|[\\s'"\`(\\[])/(?:[^\\s<>"'\`|?*:]+/)*[^\\s<>"'\`|?*:]+\\.(?:${EXTENSIONS})(?::(\\d+)(?::(\\d+))?)?\\b`,
  'g',
);

const PATTERNS = [WIN_PATH, POSIX_PATH];

export interface FilePathClickPayload {
  path: string;
  line?: number;
  column?: number;
}

export interface FilePathDecorationCallbacks {
  onClick: (payload: FilePathClickPayload, event: MouseEvent) => void;
}

export interface FilePathDecorationController {
  scanVisible: () => void;
  dispose: () => void;
}

interface DecoEntry {
  decoration: IDisposable;
  marker: IDisposable;
  onRender: IDisposable;
}

/**
 * Strip a trailing `:LINE` or `:LINE:COL` from the matched text and return
 * the bare path plus the (optional) line/column numbers.
 */
function splitLineCol(match: string): FilePathClickPayload {
  // Match `:LINE(:COL)?` at the very end of the string.
  const m = /^(.*?)(?::(\d+)(?::(\d+))?)?$/.exec(match);
  if (!m) return { path: match };
  return {
    path: m[1] ?? match,
    line: m[2] ? parseInt(m[2], 10) : undefined,
    column: m[3] ? parseInt(m[3], 10) : undefined,
  };
}

/**
 * Build a `vscode://file/...` URL for the given path. VS Code accepts the
 * native Windows path with forward slashes and a `:LINE:COL` suffix.
 */
export function buildVsCodeUrl(payload: FilePathClickPayload): string {
  // Normalize backslashes to forward slashes — VS Code accepts either but
  // forward slashes are friendlier inside a URL.
  let p = payload.path.replace(/\\/g, '/');
  // Ensure a leading slash so the URL form is `vscode://file/C:/...` or
  // `vscode://file//Users/...`.
  if (!p.startsWith('/')) p = `/${p}`;
  let url = `vscode://file${p}`;
  if (payload.line) {
    url += `:${payload.line}`;
    if (payload.column) url += `:${payload.column}`;
  }
  return url;
}

export function attachFilePathDecorations(
  term: Terminal,
  callbacks: FilePathDecorationCallbacks,
): FilePathDecorationController {
  const seen = new Map<string, DecoEntry>();
  const MAX_DECOS = 500;

  function paintMatch(absLine: number, startCol: number, length: number, payload: FilePathClickPayload) {
    const key = `${absLine}:${startCol}:${payload.path}:${payload.line ?? ''}:${payload.column ?? ''}`;
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
      el.style.color = '#a78bfa'; // violet-400 — distinct from the blue used for work items
      el.style.cursor = 'pointer';
      el.style.pointerEvents = 'auto';
      el.title = payload.line
        ? `${payload.path}:${payload.line} — click to open in VS Code`
        : `${payload.path} — click to open in VS Code`;
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        callbacks.onClick(payload, e);
      });
    });

    seen.set(key, { decoration, marker, onRender });

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
    const line = term.buffer.active.getLine(absLine);
    if (!line) return;
    const text = line.translateToString(true);
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const payload = splitLineCol(m[0]);
        if (!payload.path) continue;
        paintMatch(absLine, m.index, m[0].length, payload);
      }
    }
  }

  function scanVisible() {
    const buf = term.buffer.active;
    const total = buf.length;
    const start = Math.max(0, total - 500);
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
