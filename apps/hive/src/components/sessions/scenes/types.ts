/**
 * Shared types for terminal backdrop scenes.
 *
 * A "scene" is a self-contained animated backdrop that lives behind the
 * terminal text. Each scene is renderer-agnostic — it owns whatever it
 * appends into the mount node (a 2D canvas, a WebGL canvas, …) and its own
 * animation loop. The host (TerminalBackdrop.tsx) only picks the scene by
 * id, hands it a SceneContext, and disposes it on unmount / scene change.
 */

import type { TerminalTheme } from '../themes';

/**
 * Live activity signal, updated outside React (no re-render per byte).
 * Fed by TerminalView from PTY output + tool-decoration callbacks.
 */
export interface BackdropActivity {
  /** performance.now() of the last PTY output chunk. */
  lastOutputAt: number;
  /** performance.now() of the last detected tool start. */
  lastToolAt: number;
  /** Most-recent tool name — used to flash the matching accent color. */
  lastToolName: string | null;
}

/** Derived, decayed activity levels a scene reacts to each frame. */
export interface Boosts {
  /** 0..1, decays to 0 ~1.5s after the last PTY output. */
  outputBoost: number;
  /** 0..1, decays to 0 ~1.5s after the last tool start. */
  toolBoost: number;
  /** Milliseconds since the last PTY output. */
  sinceOutput: number;
  /** Milliseconds since the last tool start. */
  sinceTool: number;
  /** Accent hex for the active tool while toolBoost is hot, else null. */
  flashColor: string | null;
}

export interface SceneContext {
  /**
   * Container the scene appends its canvas/DOM into. Already positioned
   * `absolute inset-0` and dimmed by the host — scenes can render at full
   * strength and let the host's opacity keep text readable.
   */
  mount: HTMLDivElement;
  /** Live activity signal (mutated outside React). */
  activityRef: { current: BackdropActivity };
  /**
   * Returns the currently-active theme. May change without a scene rebuild,
   * so read it every frame rather than capturing it once.
   */
  getTheme: () => TerminalTheme;
  /** prefers-reduced-motion — scenes should render a calm static frame. */
  reducedMotion: boolean;
}

export interface SceneInstance {
  /** Tear down: cancel RAF, disconnect observers, remove DOM, free GPU resources. */
  dispose: () => void;
}

export type SceneBuilder = (ctx: SceneContext) => SceneInstance;

/** Per-frame info passed to 2D-canvas scenes by the runCanvasScene scaffold. */
export interface FrameInfo {
  /** Seconds since the previous frame, capped at 0.08. 0 on the first frame. */
  dt: number;
  /** performance.now() timestamp of this frame. */
  now: number;
  /** CSS-pixel width of the canvas. */
  w: number;
  /** CSS-pixel height of the canvas. */
  h: number;
  /** Decayed activity levels for this frame. */
  boosts: Boosts;
  /** Active theme — drives every scene's palette. */
  theme: TerminalTheme;
}
