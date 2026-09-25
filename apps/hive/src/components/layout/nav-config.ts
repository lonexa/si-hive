import {
  LayoutDashboard, Monitor, Settings, FolderOpen, BarChart3, BookOpen,
  Sparkles, UserCircle2, Download,
  Mail, CheckSquare, Users, Zap, Shield, MessageCircle,
  GraduationCap, TrendingUp, Search, ClipboardCheck,
  ClipboardList, GitPullRequest, GitMerge,
  type LucideIcon, KeyRound
} from 'lucide-react';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  /** Feature key checked against hasAccess(); undefined = always visible. */
  feature?: string;
  /** Exact-match active state (only the dashboard root needs this). */
  end?: boolean;
}

export interface NavSection {
  id: string;
  /** null label = headerless group rendered at the very top (Home). */
  label: string | null;
  items: NavItem[];
}

/**
 * Grouped sidebar navigation. Replaces the old flat 21-item list with
 * workflow-oriented sections. The `feature` keys are unchanged from the
 * previous flat list so role gating (hasAccess) keeps working identically.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'home',
    label: null,
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', end: true, feature: 'dashboard' },
      { to: '/search', icon: Search, label: 'Search', feature: 'search' },
      { to: '/todo', icon: CheckSquare, label: 'Todo', feature: 'todo' },
      { to: '/chat', icon: MessageCircle, label: 'Chat', feature: 'chat' },
      { to: '/gmail', icon: Mail, label: 'Gmail', feature: 'gmail' },
    ],
  },
  {
    id: 'agents',
    label: 'Agents & Sessions',
    items: [
      { to: '/sessions', icon: Monitor, label: 'Sessions', feature: 'sessions' },
      { to: '/personas', icon: UserCircle2, label: 'Personas', feature: 'personas' },
      { to: '/ai-studio', icon: Sparkles, label: 'AI Studio', feature: 'ai-studio' },
      { to: '/workflows', icon: Zap, label: 'Workflows', feature: 'workflows' },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    items: [
      { to: '/projects', icon: FolderOpen, label: 'Projects', feature: 'projects' },
      { to: '/knowledge', icon: BookOpen, label: 'Knowledge', feature: 'knowledge' },
    ],
  },
  {
    id: 'delivery',
    label: 'Delivery',
    items: [
      { to: '/work', icon: ClipboardList, label: 'Work', feature: 'work' },
      { to: '/pulls', icon: GitPullRequest, label: 'Pull Requests', feature: 'pull-requests' },
      { to: '/main-feed', icon: GitMerge, label: 'What Landed', feature: 'main-feed' },
      { to: '/reviews', icon: ClipboardCheck, label: 'Peer Review', feature: 'peer-review' },
    ],
  },
  {
    id: 'team',
    label: 'Team & Insights',
    items: [
      { to: '/team', icon: Users, label: 'Team', feature: 'team-dashboard' },
      { to: '/analytics', icon: BarChart3, label: 'Analytics', feature: 'analytics' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin & System',
    items: [
      { to: '/admin/users', icon: Shield, label: 'Users', feature: 'user-management' },
      { to: '/admin/adoption', icon: TrendingUp, label: 'SI Hive Usage', feature: 'user-management' },
      { to: '/admin/skill-requirements', icon: GraduationCap, label: 'Skill Requirements', feature: 'skill-requirements' },
      { to: '/admin/ai-accounts', icon: KeyRound, label: 'AI Accounts', feature: 'ai-accounts' },
      { to: '/updates', icon: Download, label: 'Updates', feature: 'updates' },
      { to: '/settings', icon: Settings, label: 'Settings', feature: 'settings' },
    ],
  },
];

/** All items flattened, for lookups (home-page picker, favorites, breadcrumbs). */
export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export function findNavItem(route: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((i) => i.to === route);
}

export type PersonaId = 'developer' | 'manager' | 'pm';

export interface PersonaPreset {
  id: PersonaId;
  label: string;
  description: string;
  homeRoute: string;
  /** Section ids that start expanded; all others start collapsed. */
  expanded: string[];
}

/**
 * Persona presets seed a sensible starting layout. They only set the home
 * route and which sections start expanded — the user can override everything
 * afterwards (which flips persona to 'custom').
 */
export const PERSONA_PRESETS: Record<PersonaId, PersonaPreset> = {
  developer: {
    id: 'developer',
    label: 'Developer',
    description: 'Sessions, code, and delivery up front.',
    homeRoute: '/dashboard',
    expanded: ['home', 'agents', 'build', 'delivery'],
  },
  manager: {
    id: 'manager',
    label: 'Manager',
    description: 'Team and delivery oversight first.',
    homeRoute: '/team',
    expanded: ['home', 'team', 'delivery'],
  },
  pm: {
    id: 'pm',
    label: 'PM / Architect',
    description: 'Work items, knowledge, and team insight.',
    homeRoute: '/work',
    expanded: ['home', 'delivery', 'build', 'team'],
  },
};

/** Section ids that should be collapsed for a given persona preset. */
export function collapsedForPersona(persona: PersonaId): string[] {
  const preset = PERSONA_PRESETS[persona];
  return NAV_SECTIONS.filter((s) => s.label !== null && !preset.expanded.includes(s.id)).map(
    (s) => s.id,
  );
}

/**
 * Reorder a list of keyed objects by a saved order of keys. Unknown/new keys
 * are appended in their original order so adding a nav item later never hides it.
 */
export function applyOrder<T>(list: T[], order: string[] | undefined, keyOf: (item: T) => string): T[] {
  if (!order || order.length === 0) return list;
  const rank = new Map(order.map((k, i) => [k, i]));
  return [...list].sort((a, b) => {
    const ra = rank.has(keyOf(a)) ? rank.get(keyOf(a))! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(keyOf(b)) ? rank.get(keyOf(b))! : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return list.indexOf(a) - list.indexOf(b);
  });
}
