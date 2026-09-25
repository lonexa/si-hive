export type HiveRole = 'admin' | 'full';

export interface AuthUser {
  oid: string;
  email: string;
  displayName: string;
  role: HiveRole;
}

/** A sign-in option offered by the server (Settings → Authentication). */
export interface LoginProvider {
  id: string;
  /** google | entra | github | oidc | local */
  type: string;
  label: string;
  icon: string;
}

export interface AuthConfig {
  configured: boolean;
  providers: LoginProvider[];
}

export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authConfigured: boolean;
  providers: LoginProvider[];
  /** Redirect to a provider's sign-in page. */
  login: (keepLoggedIn?: boolean, providerId?: string) => void;
  /** Username/password sign-in; resolves with an error message on failure. */
  loginWithPassword: (username: string, password: string, keepLoggedIn?: boolean) => Promise<string | null>;
  logout: () => Promise<void>;
  hasAccess: (feature: string) => boolean;
  setRoleOverride: (role: HiveRole | null) => Promise<void>;
}
