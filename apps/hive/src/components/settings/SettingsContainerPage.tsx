import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import SettingsPage from './SettingsPage';
import SchedulesPage from '@/components/schedules/SchedulesPage';
import NotificationsTab from './NotificationsTab';
import NavigationTab from './NavigationTab';
import AuditTab from './AuditTab';
import PermissionsAuditTab from './PermissionsAuditTab';
import SecretsTab from './SecretsTab';
import StorageTab from './StorageTab';
import IntegrationsTab from './IntegrationsTab';
import AiTab from './AiTab';
import AuthenticationTab from './AuthenticationTab';
import ModulesTab from './ModulesTab';
import { useAuth } from '@/auth/AuthProvider';

// Explicitly typed rather than `as const`: with a const-asserted array the
// entries that omit `feature` have no such property, so `tab.feature` below
// doesn't type-check. Only `value`/`label` are read, so the literal types
// bought us nothing.
const ALL_TABS: ReadonlyArray<{ value: string; label: string; feature?: string }> = [
  { value: 'general', label: 'General' },
  { value: 'navigation', label: 'Navigation' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'schedules', label: 'Schedules' },
  { value: 'modules', label: 'Modules' },
  { value: 'ai', label: 'AI' },
  { value: 'integrations', label: 'Integrations' },
  { value: 'storage', label: 'Storage' },
  { value: 'authentication', label: 'Authentication', feature: 'admin-settings' },
  { value: 'security', label: 'Security', feature: 'security' },
  { value: 'audit', label: 'Audit Trail', feature: 'security' },
  { value: 'permissions', label: 'Permissions', feature: 'security' },
];

export default function SettingsContainerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasAccess } = useAuth();

  const tabs = useMemo(
    () => ALL_TABS.filter((tab) => !tab.feature || hasAccess(tab.feature)),
    [hasAccess],
  );

  const activeTab = searchParams.get('tab') || 'general';

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              data-track={`settings.tab.${tab.value}`}
              data-track-category="nav"
            >{tab.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general" className="mt-4">
          <SettingsPage />
        </TabsContent>
        <TabsContent value="navigation" className="mt-4">
          <NavigationTab />
        </TabsContent>
        <TabsContent value="notifications" className="mt-4">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="schedules" className="mt-4">
          <SchedulesPage />
        </TabsContent>
        <TabsContent value="modules" className="mt-4">
          <ModulesTab />
        </TabsContent>
        <TabsContent value="ai" className="mt-4">
          <AiTab />
        </TabsContent>
        <TabsContent value="integrations" className="mt-4">
          <IntegrationsTab />
        </TabsContent>
        <TabsContent value="storage" className="mt-4">
          <StorageTab />
        </TabsContent>
        {hasAccess('admin-settings') && (
          <TabsContent value="authentication" className="mt-4">
            <AuthenticationTab />
          </TabsContent>
        )}
        {hasAccess('security') && (
          <TabsContent value="security" className="mt-4">
            <SecretsTab />
          </TabsContent>
        )}
        {hasAccess('security') && (
          <TabsContent value="audit" className="mt-4">
            <AuditTab />
          </TabsContent>
        )}
        {hasAccess('security') && (
          <TabsContent value="permissions" className="mt-4">
            <PermissionsAuditTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
