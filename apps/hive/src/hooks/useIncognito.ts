import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import {
  getIncognitoState,
  isIncognitoProject,
  isIncognitoSessionId,
  loadIncognitoState,
  setProjectIncognito,
  setSessionIncognito,
  subscribeIncognito,
  type IncognitoState,
} from '@/lib/incognito';

/**
 * Shared incognito state + toggles.
 *
 * `canToggle` reflects the admin-gated `incognito` feature — every caller
 * should hide its button when false rather than letting the POST 403.
 */
export function useIncognito() {
  const { hasAccess } = useAuth();
  const [state, setState] = useState<IncognitoState>(getIncognitoState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Result of the last project toggle — what was purged, or why it wasn't. */
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeIncognito(setState);
    void loadIncognitoState();
    return unsubscribe;
  }, []);

  const toggleProject = useCallback(async (path: string, enabled: boolean) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setProjectIncognito(path, enabled);
      // Turning a project on also clears what it had already logged to shared
      // SQL. Say so — silence would leave the user unsure whether the old
      // sessions are gone, and a failed purge has to be visible.
      if (result.warning) setNotice(result.warning);
      else if (result.purgedRows) setNotice(`Removed ${result.purgedRows} already-logged session${result.purgedRows === 1 ? '' : 's'} from team analytics`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleSession = useCallback(async (id: string, enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setSessionIncognito(id, enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    state,
    busy,
    error,
    notice,
    canToggle: hasAccess('incognito'),
    isProjectIncognito: useCallback((path?: string | null) => isIncognitoProject(path, state), [state]),
    isSessionIncognito: useCallback((id?: string | null) => isIncognitoSessionId(id, state), [state]),
    toggleProject,
    toggleSession,
  };
}
