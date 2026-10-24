/**
 * Browsers only expose some APIs in secure contexts (https:// or localhost).
 * When SI Hive is opened over plain http:// on another host name (e.g. a
 * phone over a private VPN), they are missing — fill in what the app needs.
 * Imported first from main.tsx so it runs before any other module.
 */
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  // RFC 4122 v4 from getRandomValues, which is available in insecure contexts.
  crypto.randomUUID = function randomUUID() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } as Crypto['randomUUID'];
}

if (typeof navigator !== 'undefined' && !navigator.clipboard) {
  // writeText via the legacy execCommand('copy'), which still works in insecure
  // contexts while handling a user gesture. Reads have no fallback: callers
  // that paste must let the browser's native paste event through instead.
  const unavailable = () => Promise.reject(new DOMException('Clipboard API needs a secure context', 'NotAllowedError'));
  const clipboard = {
    writeText(text: string): Promise<void> {
      const active = document.activeElement as HTMLElement | null;
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* reported below */ }
      ta.remove();
      active?.focus?.();
      return ok ? Promise.resolve() : unavailable();
    },
    readText: unavailable,
    read: unavailable,
    write: unavailable,
  };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

export {};
