/**
 * Navigation from outside React components (notification clicks). The app
 * renders either the desktop or the mobile router; whichever is active
 * registers itself here.
 */
interface NavigableRouter {
  navigate: (to: string) => unknown;
}

let active: NavigableRouter | null = null;

export function registerRouter(router: NavigableRouter): void {
  active = router;
}

export function appNavigate(to: string): void {
  if (active) void active.navigate(to);
  else window.location.assign(to);
}
