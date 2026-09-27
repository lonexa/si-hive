/**
 * True on touch-first devices (phones, tablets). Detected by input type rather
 * than width: a phone in landscape or "desktop site" mode reports a wide
 * viewport, and a narrow desktop window is still a desktop.
 */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/**
 * True for phones, from the user agent. Tablets are left on the desktop UI:
 * they have the room for it, and iPads report a desktop Safari UA anyway.
 */
export function isPhoneUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile) return true;
  return /iPhone|iPod|Android.+Mobile|Windows Phone|IEMobile|BlackBerry|Opera Mini|Mobile.+Firefox/i.test(navigator.userAgent);
}

export type ViewMode = 'mobile' | 'desktop';

const VIEW_MODE_KEY = 'hive-view-mode';

function readViewModeOverride(): ViewMode | null {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    return v === 'mobile' || v === 'desktop' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Which UI to render: the phone UI or the regular desktop one. A `?view=`
 * query param (mobile | desktop | auto) sets a sticky per-browser override;
 * otherwise phones get the mobile UI.
 */
export function getViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'desktop';
  const param = new URLSearchParams(window.location.search).get('view');
  if (param === 'mobile' || param === 'desktop' || param === 'auto') setViewModeOverride(param === 'auto' ? null : param);
  return readViewModeOverride() ?? (isPhoneUserAgent() ? 'mobile' : 'desktop');
}

/** Pin the UI to one mode for this browser (null = pick by device again). */
export function setViewModeOverride(mode: ViewMode | null): void {
  try {
    if (mode) localStorage.setItem(VIEW_MODE_KEY, mode);
    else localStorage.removeItem(VIEW_MODE_KEY);
  } catch { /* storage blocked: the choice just won't stick */ }
}

/** Switch UI mode and reload into it. */
export function switchViewMode(mode: ViewMode): void {
  setViewModeOverride(mode === (isPhoneUserAgent() ? 'mobile' : 'desktop') ? null : mode);
  const url = new URL(window.location.href);
  url.searchParams.delete('view');
  // Pages that only exist in the phone UI.
  if (mode === 'desktop' && (url.pathname === '/more' || url.pathname === '/new')) {
    url.pathname = '/';
    url.search = '';
  }
  window.location.replace(url.toString());
}

/** Resolved once per page load; switching modes reloads the page. */
export const VIEW_MODE: ViewMode = getViewMode();
export const IS_MOBILE_VIEW = VIEW_MODE === 'mobile';
