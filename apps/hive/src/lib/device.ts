/**
 * True on touch-first devices (phones, tablets). Detected by input type rather
 * than width: a phone in landscape or "desktop site" mode reports a wide
 * viewport, and a narrow desktop window is still a desktop.
 */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
