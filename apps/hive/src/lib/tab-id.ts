/**
 * Per-tab unique identifier.
 *
 * Stored in sessionStorage so it:
 * - Survives same-tab navigation (away from /sessions and back)
 * - Does NOT leak across browser tabs
 * - Resets when the tab is closed and reopened
 *
 * Used to namespace terminal IDs and grid state so multiple browser tabs
 * don't interfere with each other's PTY sessions.
 */
let cachedTabId: string | null = null;

export function getTabId(): string {
  if (cachedTabId) return cachedTabId;
  let tabId = sessionStorage.getItem('hive-tab-id');
  if (!tabId) {
    tabId = crypto.randomUUID().slice(0, 8);
    sessionStorage.setItem('hive-tab-id', tabId);
  }
  cachedTabId = tabId;
  return tabId;
}
