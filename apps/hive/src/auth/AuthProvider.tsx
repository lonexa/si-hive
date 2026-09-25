import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { API_BASE } from '@/lib/api-config';
import { roleHasAccess } from './feature-roles';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import type { AuthUser, AuthConfig, AuthContextValue, HiveRole, LoginProvider } from './types';

interface AuthUserWithOverride extends AuthUser {
  actualRole?: HiveRole;
  roleOverride?: HiveRole;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  authConfigured: false,
  providers: [],
  login: () => {},
  loginWithPassword: async () => null,
  logout: async () => {},
  hasAccess: () => true,
  setRoleOverride: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserWithOverride | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [providers, setProviders] = useState<LoginProvider[]>([]);
  const [featureOverrides, setFeatureOverrides] = useState<string[]>([]);
  // Feature keys owned by optional modules that are off / not set up.
  const [inactiveFeatures, setInactiveFeatures] = useState<Set<string>>(new Set());

  async function fetchModules() {
    try {
      const res = await fetch(`${API_BASE}/api/modules`, { credentials: 'include' });
      if (!res.ok) return;
      const mods = (await res.json()) as { active: boolean; featureKeys: string[] }[];
      setInactiveFeatures(new Set(mods.filter((m) => !m.active).flatMap((m) => m.featureKeys)));
    } catch {
      // Non-fatal: everything stays visible
    }
  }

  async function fetchMe() {
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json() as AuthUserWithOverride;
      setUser(data);
    }
  }

  async function fetchOverrides() {
    try {
      const res = await fetch(`${API_BASE}/api/auth/my-overrides`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { overrides: string[] };
        setFeatureOverrides(data.overrides || []);
      }
    } catch {
      // Non-fatal: overrides won't load if tables aren't created yet
    }
  }

  // Check auth status on mount
  useEffect(() => {
    (async () => {
      try {
        const configRes = await fetch(`${API_BASE}/api/auth/config`);
        const authConfig = await configRes.json() as AuthConfig;
        setAuthConfigured(authConfig.configured);
        setProviders(authConfig.providers ?? []);

        if (!authConfig.configured) {
          // Login off: the server acts as this machine's local user — load it
          // so per-user features know who "me" is.
          await Promise.all([fetchMe().catch(() => {}), fetchModules()]);
          setIsLoading(false);
          return;
        }

        const statusRes = await fetch(`${API_BASE}/api/auth/status`, {
          credentials: 'include',
        });
        const status = await statusRes.json() as { authenticated: boolean; user?: AuthUserWithOverride };

        if (status.authenticated && status.user) {
          // Fetch full user with override info from /me
          await fetchMe();
          // Also load per-user feature overrides and module status
          await Promise.all([fetchOverrides(), fetchModules()]);
        }
      } catch (err) {
        console.error('[auth] Failed to check auth status:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback((keepLoggedIn = false, providerId?: string) => {
    const keep = keepLoggedIn ? '?keep=true' : '';
    const target = providerId ? `/${encodeURIComponent(providerId)}` : '';
    window.location.href = `${API_BASE}/auth/login${target}${keep}`;
  }, []);

  const loginWithPassword = useCallback(async (username: string, password: string, keepLoggedIn = false) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/local/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, keep: keepLoggedIn }),
      });
      if (!res.ok) return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Sign-in failed';
      window.location.href = '/';
      return null;
    } catch {
      return 'Could not reach the server';
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore
    }
    setUser(null);
    window.location.href = '/';
  }, []);

  const hasAccess = useCallback(
    (feature: string) => {
      if (inactiveFeatures.has(feature)) return false;
      if (!authConfigured) return true;
      if (!user) return false;
      // Check role-based access first
      if (roleHasAccess(user.role, feature)) return true;
      // Then check per-user feature overrides
      return featureOverrides.includes(feature);
    },
    [user, authConfigured, featureOverrides, inactiveFeatures],
  );

  // Once authenticated, ping the server every minute so admins can see
  // which version each user is running and who's currently online.
  useHeartbeat(!!user && authConfigured);

  const setRoleOverride = useCallback(async (role: HiveRole | null) => {
    try {
      await fetch(`${API_BASE}/api/auth/role-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role }),
      });
      // Refresh user data to get new role
      await fetchMe();
      // Force page reload to re-render sidebar/routes
      window.location.reload();
    } catch (err) {
      console.error('[auth] Failed to set role override:', err);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        authConfigured,
        providers,
        login,
        loginWithPassword,
        logout,
        hasAccess,
        setRoleOverride,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
