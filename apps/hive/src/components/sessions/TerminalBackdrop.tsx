import { useEffect, useRef, type MutableRefObject } from 'react';
import { getScene, type SceneId } from './scenes/registry';
import type { BackdropActivity } from './scenes/types';
import type { TerminalTheme } from './themes';

/**
 * Global dimmer for the whole backdrop layer. Scenes render at full
 * strength; this scales the composited result down so terminal text stays
 * comfortably readable on top of it. Lower = dimmer.
 */
const BACKDROP_OPACITY = 0.16;

interface BackdropProps {
  /** Live activity signal — mutated outside React, read by scenes per frame. */
  activityRef: MutableRefObject<BackdropActivity>;
  /** Which scene to render behind the terminal. */
  sceneId: SceneId;
  /** Active theme — drives every scene's palette. */
  themePreset: TerminalTheme;
}

/**
 * Host for terminal backdrop scenes. Owns the dimmed mount node and the
 * scene lifecycle: it builds the chosen scene, hands it a live theme getter
 * + activity ref, and rebuilds only when the scene id changes. Theme
 * changes are picked up live (via the theme ref) without a teardown.
 */
export default function TerminalBackdrop({ activityRef, sceneId, themePreset }: BackdropProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Mutable theme ref so a running scene sees the latest colors without
  // having to be rebuilt every time the user switches themes.
  const themeRef = useRef(themePreset);
  themeRef.current = themePreset;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = getScene(sceneId).build({
      mount,
      activityRef,
      getTheme: () => themeRef.current,
      reducedMotion,
    });
    return () => scene.dispose();
  }, [sceneId, activityRef]);

  return (
    <div
      ref={mountRef}
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      style={{ opacity: BACKDROP_OPACITY }}
      aria-hidden="true"
    />
  );
}
