/**
 * Move a Claude Code transcript from one project folder to another — possibly
 * from Windows to Linux or back.
 *
 * Every JSONL line records the absolute `cwd`, and tool inputs/outputs are full
 * of absolute paths. Claude finds a session by its cwd's folder name, and the
 * model reads paths back from history, so each occurrence of the source root is
 * replaced with the target root and the rest of that path gets the target's
 * separators. Lines are rewritten through a JSON parse so escaping stays valid.
 */

export interface PathStyle {
  root: string;
  windows: boolean;
}

interface Variant {
  /** The source root as it appears in text. */
  needle: string;
  /** Separator used after the root in this form. */
  sep: string;
}

/** Characters that end a path inside free text. Spaces end it too: roots carry their own spaces. */
const PATH_CHAR = /[^\s"'`<>|*?,;()[\]{}]/;

function trimSep(p: string): string {
  return p.replace(/[\\/]+$/, '');
}

function variantsOf(from: PathStyle): Variant[] {
  const root = trimSep(from.root);
  if (!from.windows) return [{ needle: root, sep: '/' }];
  const back = root.replace(/\//g, '\\');
  return [
    // Inside text that was itself JSON (a tool result echoing JSON), backslashes are doubled.
    { needle: back.replace(/\\/g, '\\\\'), sep: '\\\\' },
    { needle: back, sep: '\\' },
    { needle: back.replace(/\\/g, '/'), sep: '/' },
  ];
}

export class TranscriptRewriter {
  private readonly variants: Variant[];
  private readonly toRoot: string;
  private readonly toSep: string;
  private readonly caseInsensitive: boolean;

  constructor(from: PathStyle, to: PathStyle) {
    this.variants = variantsOf(from);
    this.caseInsensitive = from.windows;
    this.toSep = to.windows ? '\\' : '/';
    this.toRoot = trimSep(to.root).replace(/[\\/]/g, this.toSep);
  }

  private find(hay: string, needle: string, from: number): number {
    return this.caseInsensitive
      ? hay.toLowerCase().indexOf(needle.toLowerCase(), from)
      : hay.indexOf(needle, from);
  }

  /** Rewrite every occurrence of the source root in one string. */
  rewriteString(s: string): string {
    let out = s;
    for (const v of this.variants) {
      let pos = 0;
      for (;;) {
        const at = this.find(out, v.needle, pos);
        if (at < 0) break;
        const after = at + v.needle.length;
        // `C:\work\app` must not match inside `C:\work\app2`.
        const next = out[after];
        if (next !== undefined && next !== v.sep[0] && PATH_CHAR.test(next) && !/[.:]/.test(next)) {
          pos = after;
          continue;
        }
        // The rest of the path, up to the first character that ends a path.
        let end = after;
        while (end < out.length && PATH_CHAR.test(out[end])) end++;
        const rest = out.slice(after, end).split(v.sep).join(this.toSep);
        const replacement = this.toRoot + rest;
        out = out.slice(0, at) + replacement + out.slice(end);
        pos = at + replacement.length;
      }
    }
    return out;
  }

  private mightContain(line: string): boolean {
    const hay = this.caseInsensitive ? line.toLowerCase() : line;
    // In raw JSON a single backslash is escaped, so the doubled form also covers it.
    return this.variants.some((v) => hay.includes(this.caseInsensitive ? v.needle.toLowerCase() : v.needle));
  }

  private walk(value: unknown): unknown {
    if (typeof value === 'string') return this.rewriteString(value);
    if (Array.isArray(value)) return value.map((v) => this.walk(v));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.walk(v);
      return out;
    }
    return value;
  }

  /** Rewrite one JSONL line. Unparseable lines are kept as they are. */
  rewriteLine(line: string): string {
    if (!line.trim() || !this.mightContain(line)) return line;
    try {
      return JSON.stringify(this.walk(JSON.parse(line)));
    } catch {
      return line;
    }
  }

  rewriteJsonl(text: string): string {
    return text.split('\n').map((l) => this.rewriteLine(l.replace(/\r$/, ''))).join('\n');
  }
}
