import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ProjectsPage from './ProjectsPage';
import GitChangesTab from './GitChangesTab';
import DependenciesTab from './DependenciesTab';
import ProjectSyncTab from './ProjectSyncTab';
import { useAuth } from '@/auth/AuthProvider';

const TABS = [
  { value: 'browse', label: 'Browse' },
  { value: 'git-changes', label: 'Git Changes' },
  { value: 'dependencies', label: 'Dependencies' },
  { value: 'sync', label: 'Sync', feature: 'peers' },
] as ReadonlyArray<{ value: string; label: string; feature?: string }>;

export default function ProjectsContainerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'browse';
  const { hasAccess } = useAuth();
  const tabs = TABS.filter((t) => !t.feature || hasAccess(t.feature));

  const handleTabChange = (value: string) => {
    if (value === 'browse') {
      // Preserve other params like 'new'
      searchParams.delete('tab');
      setSearchParams(searchParams, { replace: true });
    } else {
      setSearchParams({ tab: value }, { replace: true });
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              data-track={`projects.tab.${tab.value}`}
              data-track-category="nav"
            >{tab.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="browse" className="mt-4">
          <ProjectsPage />
        </TabsContent>
        <TabsContent value="git-changes" className="mt-4">
          <GitChangesTab />
        </TabsContent>
        <TabsContent value="dependencies" className="mt-4">
          <DependenciesTab />
        </TabsContent>
        <TabsContent value="sync" className="mt-4">
          <ProjectSyncTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
