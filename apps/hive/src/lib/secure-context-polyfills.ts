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

export {};
