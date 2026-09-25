import type { StopHookPayload } from '../types.js';

/**
 * Parse and validate a Stop hook payload from Claude Code.
 *
 * Handles multiple formats:
 * - Direct JSON: { session_id: "..." }
 * - HTTP hook env vars: { SESSION_ID: "..." }
 * - Nested under env key: { env: { SESSION_ID: "..." } }
 *
 * Returns null if the payload is invalid.
 */
export function parseStopHookPayload(body: unknown): StopHookPayload | null {
  if (!body || typeof body !== 'object') return null;

  const obj = body as Record<string, unknown>;

  // Log raw payload for debugging
  console.log(`[stop-hook] Raw payload keys: ${Object.keys(obj).join(', ')}`);

  // Try multiple field name formats for session_id
  const sessionId =
    (typeof obj.session_id === 'string' && obj.session_id) ||
    (typeof obj.SESSION_ID === 'string' && obj.SESSION_ID) ||
    (typeof obj.sessionId === 'string' && obj.sessionId) ||
    // HTTP hooks may nest env vars
    (obj.env && typeof obj.env === 'object' && typeof (obj.env as Record<string, unknown>).SESSION_ID === 'string'
      ? (obj.env as Record<string, unknown>).SESSION_ID as string
      : null);

  if (!sessionId) {
    console.log(`[stop-hook] Could not find session_id in payload: ${JSON.stringify(obj).slice(0, 200)}`);
    return null;
  }

  return {
    session_id: sessionId,
    last_assistant_message: typeof obj.last_assistant_message === 'string' ? obj.last_assistant_message : undefined,
    stop_hook_active: typeof obj.stop_hook_active === 'boolean' ? obj.stop_hook_active : undefined,
    transcript_path: (typeof obj.transcript_path === 'string' ? obj.transcript_path : undefined) ??
      (typeof obj.TRANSCRIPT_PATH === 'string' ? obj.TRANSCRIPT_PATH : undefined),
    cwd: (typeof obj.cwd === 'string' ? obj.cwd : undefined) ??
      (typeof obj.CWD === 'string' ? obj.CWD : undefined),
    permission_mode: typeof obj.permission_mode === 'string' ? obj.permission_mode : undefined,
  };
}
