/**
 * Optional feature modules (Settings → Modules).
 *
 * Core Hive (sessions, terminals, projects, AI Studio, chat, schedules,
 * settings) is always on. Everything else is a module the user can turn off,
 * and some need something configured first (login, a tracker, …).
 *
 * A module declares:
 *   - `featureKeys`  — frontend feature keys (nav items, routes) it owns;
 *                      the client hides them when the module is off
 *   - `routePrefixes` — API prefixes it serves; the server answers 404 for
 *                      them when the module is off
 *   - `requires`     — prerequisites; unmet ones keep the module inactive
 *
 * To add a module: add an entry here (and its migrations to
 * storage/migrations-index.ts, its route dispatch to index.ts, its pages to
 * the router). See docs/extending/modules.md.
 */
import type { HiveConfig } from '../types.js';
import { isAuthEnabled } from '../auth/settings.js';
import { listConnections } from '../integrations/registry.js';
import { isLlmConfigured } from '../ai/llm.js';

export type ModuleRequirement = 'auth' | 'git' | 'tracker' | 'gitOrTracker' | 'llm' | 'googleOAuth';

export interface HiveModule {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  requires?: ModuleRequirement[];
  featureKeys: string[];
  routePrefixes: string[];
}

export const MODULES: HiveModule[] = [
  {
    id: 'delivery',
    name: 'Delivery',
    description: 'Tickets, pull requests with AI review, what landed, and CI failures — from your connected git host and tracker.',
    defaultEnabled: true,
    requires: ['gitOrTracker'],
    featureKeys: ['work', 'pull-requests', 'main-feed'],
    routePrefixes: ['/api/work/', '/api/pulls', '/api/delivery/'],
  },
  {
    id: 'knowledge',
    name: 'Knowledge',
    description: 'Knowledge base, snippets, decisions and plans.',
    defaultEnabled: true,
    featureKeys: ['knowledge', 'sharing'],
    routePrefixes: ['/api/kb/', '/api/sharing/'],
  },
  {
    id: 'planning',
    name: 'Planning',
    description: 'Todo list and personas.',
    defaultEnabled: true,
    featureKeys: ['todo', 'personas'],
    routePrefixes: ['/api/todo/', '/api/personas'],
  },
  {
    id: 'workflows',
    name: 'Workflows',
    description: 'Scheduled scrape / browser / API / monitor automations with Slack, webhook and email notifications.',
    defaultEnabled: true,
    featureKeys: ['workflows'],
    routePrefixes: ['/api/workflows', '/api/workflow-', '/api/connectors', '/api/distributions'],
  },
  {
    id: 'search',
    name: 'Search',
    description: 'Search across knowledge, tickets, sessions and people, plus "Ask SI Hive" answers.',
    defaultEnabled: true,
    featureKeys: ['search'],
    routePrefixes: ['/api/search'],
  },
  {
    id: 'team',
    name: 'Team',
    description: 'Messaging, the "Now" board, session handoff, peer review, user admin and team usage. Needs login so SI Hive knows who is who.',
    defaultEnabled: true,
    requires: ['auth'],
    featureKeys: ['team-dashboard', 'messages', 'peer-review', 'user-management', 'skill-requirements'],
    routePrefixes: ['/api/messaging/', '/api/now/', '/api/handoff', '/api/reviews', '/api/team/', '/api/admin/users', '/api/admin/adoption', '/api/admin/usage/', '/api/admin/skill-requirements'],
  },
  {
    id: 'google',
    name: 'Google Workspace',
    description: 'Gmail inbox and Calendar using your own Google OAuth client.',
    defaultEnabled: false,
    featureKeys: ['gmail'],
    routePrefixes: ['/api/gmail/', '/api/calendar/'],
  },
  {
    id: 'peers',
    name: 'Peer Hives',
    description: 'Hand a session, with its code and uncommitted changes, to another SI Hive (e.g. an always-on server) and bring it back.',
    // Inert until a peer is paired: every /api/peer/ call needs a token issued here.
    defaultEnabled: true,
    featureKeys: ['peers'],
    routePrefixes: ['/api/peers', '/api/peer/', '/api/peer-handoffs/'],
  },
];

const byId = new Map(MODULES.map((m) => [m.id, m]));

function requirementMet(config: HiveConfig, r: ModuleRequirement): boolean {
  switch (r) {
    case 'auth': return isAuthEnabled(config);
    case 'git': return listConnections(config, 'git').length > 0;
    case 'tracker': return listConnections(config, 'tracker').length > 0;
    case 'gitOrTracker': return listConnections(config).length > 0;
    case 'llm': return isLlmConfigured(config);
    case 'googleOAuth': return !!(config.google as { clientId?: string } | undefined)?.clientId;
  }
}

export const REQUIREMENT_LABELS: Record<ModuleRequirement, string> = {
  auth: 'Login turned on (Settings → Authentication)',
  git: 'A git host connected (Settings → Integrations)',
  tracker: 'A ticket tracker connected (Settings → Integrations)',
  gitOrTracker: 'A git host or ticket tracker connected (Settings → Integrations)',
  llm: 'An AI backend (Settings → AI)',
  googleOAuth: 'A Google OAuth client',
};

export interface ModuleStatus {
  id: string;
  name: string;
  description: string;
  /** User switch (defaults to the module's default). */
  enabled: boolean;
  /** Enabled AND all requirements met. */
  active: boolean;
  missing: string[];
  featureKeys: string[];
}

export function moduleStatus(config: HiveConfig, m: HiveModule): ModuleStatus {
  const prefs = (config.modules as Record<string, boolean> | undefined) ?? {};
  const enabled = prefs[m.id] ?? m.defaultEnabled;
  const missing = (m.requires ?? []).filter((r) => !requirementMet(config, r)).map((r) => REQUIREMENT_LABELS[r]);
  return { id: m.id, name: m.name, description: m.description, enabled, active: enabled && missing.length === 0, missing, featureKeys: m.featureKeys };
}

export function listModuleStatus(config: HiveConfig): ModuleStatus[] {
  return MODULES.map((m) => moduleStatus(config, m));
}

export function isModuleActive(config: HiveConfig, id: string): boolean {
  const m = byId.get(id);
  return m ? moduleStatus(config, m).active : false;
}

/** The inactive module serving an API path, if any (so the server can 404 it). */
export function inactiveModuleForPath(config: HiveConfig, pathname: string): HiveModule | null {
  for (const m of MODULES) {
    if (m.routePrefixes.some((p) => pathname.startsWith(p)) && !moduleStatus(config, m).active) return m;
  }
  return null;
}

export function setModuleEnabled(config: HiveConfig, id: string, enabled: boolean): boolean {
  if (!byId.has(id)) return false;
  config.modules = { ...((config.modules as Record<string, boolean> | undefined) ?? {}), [id]: enabled };
  return true;
}
