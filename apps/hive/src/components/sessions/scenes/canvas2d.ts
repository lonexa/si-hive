/**
 * Shared scaffold for 2D-canvas backdrop scenes.
 *
 * Handles the boring, identical parts so each scene file is just its own
 * animation: canvas creation, devicePixelRatio scaling, resize observation,
 * tab-visibility pausing, reduced-motion (renders one static frame), and the
 * RAF loop with per-frame activity-boost computation.
 *
 * Scene-specific state lives in the caller's closure; this just drives the
 * optional init(w,h) (on mount + every resize) and the per-frame frame().
 */

import type { SceneContext, SceneInstance, FrameInfo } from './types';
import { computeBoosts } from './activity';

export interface CanvasScene {
  /**
   * Called once on mount and again on every resize — (re)build any
   * size-dependent state here (grids, building silhouettes, …).
   */
  init?: (w: number, h: number) => void;
  /** Per-frame draw. The scene is responsible for clearing/fading itself. */
  frame: (c: CanvasRenderingContext2D, f: FrameInfo) => void;
}

export function runCanvasScene(ctx: SceneContext, scene: CanvasScene): SceneInstance {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  ctx.mount.appendChild(canvas);
  const c2d = canvas.getContext('2d');
  if (!c2d) {
    return { dispose() { try { ctx.mount.removeChild(canvas); } catch { /* ignore */ } } };
  }

  let w = 1;
  let h = 1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, ctx.mount.clientWidth);
    h = Math.max(1, ctx.mount.clientHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    // Draw in CSS pixels; the transform absorbs the DPR scale.
    c2d!.setTransform(dpr, 0, 0, dpr, 0, 0);
    scene.init?.(w, h);
  }

  let raf = 0;
  let last = 0;

  function renderFrame(now: number) {
    const dt = last ? Math.min(0.08, (now - last) / 1000) : 0;
    last = now;
    const boosts = computeBoosts(ctx.activityRef.current, now);
    const f: FrameInfo = { dt, now, w, h, boosts, theme: ctx.getTheme() };
    scene.frame(c2d!, f);
  }

  function loop(now: number) {
    if (document.visibilityState === 'hidden') {
      last = now; // avoid a huge dt jump when the tab comes back
      raf = requestAnimationFrame(loop);
      return;
    }
    renderFrame(now);
    raf = requestAnimationFrame(loop);
  }

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(ctx.mount);

  if (ctx.reducedMotion) {
    // One calm frame, then hold — no animation.
    renderFrame(performance.now());
  } else {
    raf = requestAnimationFrame(loop);
  }

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      try { ctx.mount.removeChild(canvas); } catch { /* ignore */ }
    },
  };
}

// --- Small color helpers (theme colors are #rgb / #rrggbb hex) -------------

/** Parse a #rgb / #rrggbb hex string into [r,g,b] 0..255. Falls back to mid-gray. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return [128, 128, 128];
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `rgba()` string from a hex color + alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Linear blend between two hex colors, t in 0..1, returned as `rgb()`. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}
