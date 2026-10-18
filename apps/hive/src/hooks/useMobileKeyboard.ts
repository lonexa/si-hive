import { useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * Phone browsers open the on-screen keyboard over the page instead of
 * shrinking it (iOS always, Android Chrome by default), so the bottom of a
 * full-height layout, usually the text box, ends up under the keyboard.
 *
 * While the keyboard is up this publishes the visible part of the screen as
 * CSS variables on <html>: --vv-height (visible height) and --vv-top (how far
 * the browser panned the page), plus the class "keyboard-open". Full-height
 * layouts use `top-[var(--vv-top,0px)] h-[var(--vv-height,100dvh)]`, so with
 * no keyboard nothing changes.
 */
export function useKeyboardViewport() {
  useEffect(() => {
    users++;
    if (users === 1) teardown = install();
    return () => {
      users--;
      if (users === 0) { teardown?.(); teardown = null; }
    };
  }, []);
}

let users = 0;
let teardown: (() => void) | null = null;

function install(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  // Tallest visible height seen at this width: the screen without a keyboard.
  let width = vv.width;
  let full = Math.max(vv.height, window.innerHeight);
  let frame = 0;

  const clear = () => {
    root.style.removeProperty('--vv-height');
    root.style.removeProperty('--vv-top');
    root.classList.remove('keyboard-open');
  };

  const update = () => {
    frame = 0;
    // Pinch zoom also shrinks the visible area; that isn't a keyboard.
    if (vv.scale > 1.01) { clear(); return; }
    if (Math.abs(vv.width - width) > 1) { width = vv.width; full = vv.height; }
    full = Math.max(full, vv.height);
    if (full - vv.height < 120) { clear(); return; }
    const wasOpen = root.classList.contains('keyboard-open');
    root.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
    root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    root.classList.add('keyboard-open');
    // The layout just shrank around the focused field: keep it in view.
    const el = document.activeElement;
    if (!wasOpen && el instanceof HTMLElement && el.matches('input, textarea, [contenteditable="true"]')) {
      requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  update();
  return () => {
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    if (frame) cancelAnimationFrame(frame);
    clear();
  };
}

/**
 * Size a textarea to its content, wrapped lines included. Its CSS
 * min-height / max-height set the limits (it scrolls past the max).
 * `deps` re-measure it when something other than its value changes its
 * limits, such as focus.
 */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, deps: unknown[] = []) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
    // Measured once per change; deps are the caller's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, value, ...deps]);
}
