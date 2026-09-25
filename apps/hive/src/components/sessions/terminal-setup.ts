import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { ImageAddon } from '@xterm/addon-image';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import type { TerminalSettings } from '@/stores/terminal-settings-store';
import { resolveEffectiveSettings } from '@/stores/terminal-settings-store';
import { type TerminalTheme } from './themes';

export const DEFAULT_THEME = {
  background: '#0a0a0a',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  selectionBackground: '#3f3f46',
  black: '#18181b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e4e4e7',
  brightBlack: '#52525b',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#fafafa',
} as const;

export const DEFAULT_FONT_FAMILY =
  "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace";

export interface TerminalSetupResult {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon | null;
  webglDisposer: (() => void) | null;
}

/** Subset of ImageAddon API we use for click-to-expand. */
export interface ImageLookup {
  getImageAtBufferCell(x: number, y: number): HTMLCanvasElement | undefined;
}

/**
 * Create an xterm Terminal with FitAddon and any opt-in enhancement addons
 * (WebGL, Image, WebLinks, Search). The Terminal must already be `open()`ed
 * to the host element BEFORE calling `loadEnhancements()` for WebGL to attach.
 *
 * Returns { term, fit, search }. Call `loadEnhancements()` after `term.open()`.
 */
export function createTerminal(
  opts: Partial<ITerminalOptions> = {},
  themePreset?: TerminalTheme,
): {
  term: Terminal;
  fit: FitAddon;
} {
  // Merge the user-selected theme preset over our defaults, then force the
  // background to be slightly translucent so the 3D backdrop (if enabled)
  // can be toggled on/off without remounting the session. The wrapper element
  // behind the terminal carries the theme's bg color, so when no canvas
  // is rendered the terminal still looks correct for the active theme.
  const preset = themePreset?.xterm ?? {};
  const theme = {
    ...DEFAULT_THEME,
    ...preset,
    background: 'rgba(0, 0, 0, 0)', // fully transparent; wrapper provides color
  };
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: DEFAULT_FONT_FAMILY,
    theme,
    allowProposedApi: true,
    allowTransparency: true,
    ...opts,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  return { term, fit };
}

/**
 * Load enhancement addons (WebGL, Image, WebLinks, Search) based on the
 * provided settings. Must be called AFTER `term.open(container)`.
 * Each addon is wrapped in try/catch so a failure in one doesn't block the others.
 *
 * Returns the SearchAddon instance (or null if disabled) so callers can wire
 * Ctrl+F, plus a `webglDisposer` that should be invoked on terminal cleanup.
 */
export function loadEnhancements(term: Terminal, settings: TerminalSettings): {
  search: SearchAddon | null;
  webglDisposer: (() => void) | null;
  image: ImageLookup | null;
} {
  const effective = resolveEffectiveSettings(settings);
  let search: SearchAddon | null = null;
  let webglDisposer: (() => void) | null = null;
  let image: ImageLookup | null = null;

  // The WebGL renderer does NOT support `allowTransparency`. When the user
  // has the ambient canvas enabled at mount time we skip WebGL so the
  // particles behind the terminal stay visible. (Toggling ambient on later
  // is fine — it'll still render, just dimmer because of WebGL's opaque bg.
  // A page refresh after enabling ambient gives the best result.)
  const skipWebglForTransparency = effective.ambientCanvas;
  if (effective.gpu && !skipWebglForTransparency) {
    try {
      const webgl = new WebglAddon();
      // Auto-dispose on context loss → falls back to DOM renderer.
      const lossDisposable = webgl.onContextLoss(() => {
        try { webgl.dispose(); } catch { /* already disposed */ }
      });
      term.loadAddon(webgl);
      webglDisposer = () => {
        try { lossDisposable.dispose(); } catch { /* ignore */ }
        try { webgl.dispose(); } catch { /* ignore */ }
      };
    } catch (err) {
      console.warn('[terminal] WebGL addon failed to load, falling back to DOM renderer', err);
    }
  }

  if (effective.inlineImages) {
    try {
      const imageAddon = new ImageAddon({
        enableSizeReports: true,
        sixelSupport: true,
        iipSupport: true,
      });
      term.loadAddon(imageAddon);
      image = imageAddon as unknown as ImageLookup;
    } catch (err) {
      console.warn('[terminal] Image addon failed to load', err);
    }
  }

  if (effective.webLinks) {
    try {
      term.loadAddon(new WebLinksAddon());
    } catch (err) {
      console.warn('[terminal] WebLinks addon failed to load', err);
    }
  }

  if (effective.search) {
    try {
      search = new SearchAddon();
      term.loadAddon(search);
    } catch (err) {
      console.warn('[terminal] Search addon failed to load', err);
      search = null;
    }
  }

  return { search, webglDisposer, image };
}

/**
 * Convert a mouse event on the terminal element to absolute buffer cell
 * coordinates suitable for `ImageAddon.getImageAtBufferCell(x, y)`.
 * Returns null if the click is outside the rendered grid.
 */
export function pixelToBufferCell(
  term: Terminal,
  event: { clientX: number; clientY: number },
): { x: number; y: number } | null {
  const screen = term.element?.querySelector('.xterm-screen') as HTMLElement | null;
  if (!screen) return null;
  const rect = screen.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  if (px < 0 || py < 0 || px > rect.width || py > rect.height) return null;
  const cellW = rect.width / term.cols;
  const cellH = rect.height / term.rows;
  if (cellW <= 0 || cellH <= 0) return null;
  const col = Math.floor(px / cellW);
  const viewportRow = Math.floor(py / cellH);
  const absLine = term.buffer.active.viewportY + viewportRow;
  return { x: col, y: absLine };
}
