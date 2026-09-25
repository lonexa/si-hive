export type HiveRole = 'admin' | 'full';

/**
 * Maps each feature key to the roles that can access it.
 * Used by the sidebar, router, server-side role checks, and feature override UI.
 */
export const FEATURE_ROLES: Record<string, HiveRole[]> = {
  // Available to everyone
  'dashboard': ['admin', 'full'],
  'sessions': ['admin', 'full'],
  'personas': ['admin', 'full'],
  'ai-studio': ['admin', 'full'],
  'knowledge': ['admin', 'full'],
  'settings': ['admin', 'full'],
  'updates': ['admin', 'full'],
  'session-replay': ['admin', 'full'],
  'security': ['admin', 'full'],
  'pr-review': ['admin', 'full'],
  'calendar': ['admin', 'full'],
  'dependencies': ['admin', 'full'],
  'sharing': ['admin', 'full'],
  'analytics': ['admin', 'full'],
  'projects': ['admin', 'full'],
  'chat': ['admin', 'full'],
  'messages': ['admin', 'full'],
  'gmail': ['admin', 'full'],
  'todo': ['admin', 'full'],
  'workflows': ['admin', 'full'],
  'team-dashboard': ['admin', 'full'],
  'search': ['admin', 'full'],
  'peer-review': ['admin', 'full'],
  'work': ['admin', 'full'],
  'pull-requests': ['admin', 'full'],
  'main-feed': ['admin', 'full'],

  // Admin only
  // System settings that affect every user (login providers, …)
  'admin-settings': ['admin'],
  'user-management': ['admin'],
  'skill-requirements': ['admin'],
  // Creating a second provider login writes junctions into the user's provider
  // config dir — admin-gated. Picking an already-configured account at launch
  // time is NOT gated; that lives in the launch dialog for everyone.
  'ai-accounts': ['admin'],
  // Incognito suppresses every shared write for a project or session, which
  // also removes it from team analytics — admin-gated while it settles in.
  'incognito': ['admin'],
};

/**
 * Check if a role has access to a feature.
 */
export function roleHasAccess(role: HiveRole, feature: string): boolean {
  const allowed = FEATURE_ROLES[feature];
  if (!allowed) return true; // Unknown features are accessible by default
  return allowed.includes(role);
}

/**
 * Returns features that the given role does NOT have access to.
 * These are the only features that can be granted as per-user overrides.
 */
export function getGrantableFeatures(role: HiveRole): string[] {
  return Object.entries(FEATURE_ROLES)
    .filter(([, roles]) => !roles.includes(role))
    .map(([feature]) => feature);
}

/**
 * Human-readable label for a feature key.
 */
export const FEATURE_LABELS: Record<string, string> = {
  'dashboard': 'Dashboard',
  'sessions': 'Sessions',
  'personas': 'Personas',
  'ai-studio': 'AI Studio',
  'knowledge': 'Knowledge',
  'settings': 'Settings',
  'updates': 'Updates',
  'session-replay': 'Session Replay',
  'security': 'Security',
  'pr-review': 'PR Review',
  'calendar': 'Calendar',
  'dependencies': 'Dependencies',
  'sharing': 'Sharing',
  'analytics': 'Analytics',
  'projects': 'Projects',
  'chat': 'Chat',
  'messages': 'Messages',
  'gmail': 'Gmail',
  'todo': 'Todo',
  'workflows': 'Workflows',
  'team-dashboard': 'Team Dashboard',
  'search': 'Search',
  'peer-review': 'Peer Review',
  'work': 'Work',
  'pull-requests': 'Pull Requests',
  'main-feed': 'What Landed',
  'user-management': 'User Management',
  'admin-settings': 'System Settings',
  'skill-requirements': 'Skill Requirements',
  'ai-accounts': 'AI Accounts',
  'incognito': 'Incognito Sessions',
};
