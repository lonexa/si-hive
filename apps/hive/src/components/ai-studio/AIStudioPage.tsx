import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import AgentsPage from '@/components/agents/AgentsPage';
import SkillsPage from '@/components/skills/SkillsPage';
import HooksPage from '@/components/hooks/HooksPage';
import PluginsPage from '@/components/plugins/PluginsPage';
import PermissionsPage from '@/components/permissions/PermissionsPage';
import DocsTab from '@/components/ai-studio/DocsTab';
import ScannerTab from '@/components/ai-studio/ScannerTab';

const TABS = [
  { value: 'agents', label: 'Agents' },
  { value: 'skills', label: 'Skills' },
  { value: 'hooks', label: 'Hooks' },
  { value: 'plugins', label: 'Plugins' },
  { value: 'permissions', label: 'Permissions' },
  { value: 'scanner', label: 'Scanner' },
  { value: 'docs', label: 'Docs' },
] as const;

export default function AIStudioPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'agents';

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              data-track={`aistudio.tab.${tab.value}`}
              data-track-category="nav"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="agents" className="mt-4">
          <AgentsPage />
        </TabsContent>
        <TabsContent value="skills" className="mt-4">
          <SkillsPage />
        </TabsContent>
        <TabsContent value="hooks" className="mt-4">
          <HooksPage />
        </TabsContent>
        <TabsContent value="plugins" className="mt-4">
          <PluginsPage />
        </TabsContent>
        <TabsContent value="permissions" className="mt-4">
          <PermissionsPage />
        </TabsContent>
        <TabsContent value="scanner" className="mt-4">
          <ScannerTab />
        </TabsContent>
        <TabsContent value="docs" className="mt-4">
          <DocsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
