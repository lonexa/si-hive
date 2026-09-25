import { API_BASE } from '@/lib/api-config';

/**
 * Stream the /api/updates/apply SSE response to completion and reload the
 * page when the server reports success. Used by both the manual Update page
 * and the admin force-update WebSocket handler.
 *
 * Returns true when the SSE stream completes with a success result, false
 * otherwise. Reload is invoked here so callers don't have to coordinate.
 */
export async function runUpdate(
  onProgress?: (step: string, detail: string) => void,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/updates/apply`, { method: 'POST' });
    if (!res.ok || !res.body) return false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let success = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
          if (data.type === 'progress' && onProgress) {
            onProgress(String(data.step ?? ''), String(data.detail ?? ''));
          }
          if (data.type === 'result') {
            success = !!data.success;
          }
        } catch { /* skip malformed SSE lines */ }
      }
    }

    if (success) {
      // Match UpdatePage's behavior: give the new process time to come up.
      setTimeout(() => window.location.reload(), 5000);
    }
    return success;
  } catch {
    return false;
  }
}
