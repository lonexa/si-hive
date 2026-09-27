import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bell, Blocks, Bot, BookOpen, CalendarClock, Cpu, Database, FileSearch, KeyRound, Link2, ListChecks,
  Navigation, Plug, ScrollText, Settings, ShieldCheck, Sparkles, Webhook, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Compat, LinkRow, RowGroup } from './components';

interface Section {
  value: string;
  label: string;
  detail?: string;
  icon: LucideIcon;
  feature?: string;
  component: LazyExoticComponent<ComponentType>;
}

/**
 * A page whose desktop version is a long row of tabs. On a phone it opens as
 * a list; picking an entry opens that section full width (`?tab=`), and back
 * returns to the list.
 */
function SectionListPage({ sections }: { sections: Section[] }) {
  const [searchParams] = useSearchParams();
  const { hasAccess } = useAuth();
  const allowed = sections.filter((s) => !s.feature || hasAccess(s.feature));
  const current = allowed.find((s) => s.value === searchParams.get('tab'));

  if (current) {
    const Component = current.component;
    return (
      <Suspense fallback={null}>
        <Compat>
          <Component />
        </Compat>
      </Suspense>
    );
  }

  return (
    <RowGroup>
      {allowed.map((s) => (
        <LinkRow key={s.value} to={`?tab=${s.value}`} icon={s.icon} label={s.label} detail={s.detail} />
      ))}
    </RowGroup>
  );
}

const SETTINGS_SECTIONS: Section[] = [
  { value: 'general', label: 'General', detail: 'Appearance, terminal, projects', icon: Settings, component: lazy(() => import('@/components/settings/SettingsPage')) },
  { value: 'navigation', label: 'Navigation', detail: 'Home page, menu order, favorites', icon: Navigation, component: lazy(() => import('@/components/settings/NavigationTab')) },
  { value: 'notifications', label: 'Notifications', icon: Bell, component: lazy(() => import('@/components/settings/NotificationsTab')) },
  { value: 'schedules', label: 'Schedules', detail: 'Recurring AI tasks', icon: CalendarClock, component: lazy(() => import('@/components/schedules/SchedulesPage')) },
  { value: 'modules', label: 'Modules', icon: Blocks, component: lazy(() => import('@/components/settings/ModulesTab')) },
  { value: 'ai', label: 'AI', detail: 'Providers, models, accounts', icon: Cpu, component: lazy(() => import('@/components/settings/AiTab')) },
  { value: 'integrations', label: 'Integrations', detail: 'Git hosts and trackers', icon: Link2, component: lazy(() => import('@/components/settings/IntegrationsTab')) },
  { value: 'storage', label: 'Storage', icon: Database, component: lazy(() => import('@/components/settings/StorageTab')) },
  { value: 'authentication', label: 'Authentication', icon: KeyRound, feature: 'admin-settings', component: lazy(() => import('@/components/settings/AuthenticationTab')) },
  { value: 'security', label: 'Security', detail: 'Secrets', icon: ShieldCheck, feature: 'security', component: lazy(() => import('@/components/settings/SecretsTab')) },
  { value: 'audit', label: 'Audit trail', icon: ScrollText, feature: 'security', component: lazy(() => import('@/components/settings/AuditTab')) },
  { value: 'permissions', label: 'Permissions audit', icon: ListChecks, feature: 'security', component: lazy(() => import('@/components/settings/PermissionsAuditTab')) },
];

const AI_STUDIO_SECTIONS: Section[] = [
  { value: 'agents', label: 'Agents', icon: Bot, component: lazy(() => import('@/components/agents/AgentsPage')) },
  { value: 'skills', label: 'Skills', icon: Sparkles, component: lazy(() => import('@/components/skills/SkillsPage')) },
  { value: 'hooks', label: 'Hooks', icon: Webhook, component: lazy(() => import('@/components/hooks/HooksPage')) },
  { value: 'plugins', label: 'Plugins', icon: Plug, component: lazy(() => import('@/components/plugins/PluginsPage')) },
  { value: 'permissions', label: 'Permissions', icon: ShieldCheck, component: lazy(() => import('@/components/permissions/PermissionsPage')) },
  { value: 'scanner', label: 'Scanner', icon: FileSearch, component: lazy(() => import('@/components/ai-studio/ScannerTab')) },
  { value: 'docs', label: 'Docs', icon: BookOpen, component: lazy(() => import('@/components/ai-studio/DocsTab')) },
];

export function MobileSettingsPage() {
  return <SectionListPage sections={SETTINGS_SECTIONS} />;
}

export function MobileAIStudioPage() {
  return <SectionListPage sections={AI_STUDIO_SECTIONS} />;
}

