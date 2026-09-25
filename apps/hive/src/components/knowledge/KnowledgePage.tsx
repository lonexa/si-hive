import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import KnowledgeBasePage from '@/components/kb/KnowledgeBasePage';
import PlansPage from '@/components/insights/PlansPage';
import SnippetsTab from '@/components/knowledge/SnippetsTab';
import DecisionsTab from '@/components/knowledge/DecisionsTab';

const TABS = [
  { value: 'kb', label: 'KB' },
  { value: 'snippets', label: 'Snippets' },
  { value: 'decisions', label: 'Decisions' },
  { value: 'plans', label: 'Plans' },
] as const;

export default function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'kb';

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} data-track={`knowledge.tab.${tab.value}`} data-track-category="nav">{tab.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="kb" className="mt-4">
          <KnowledgeBasePage />
        </TabsContent>
        <TabsContent value="snippets" className="mt-4">
          <SnippetsTab />
        </TabsContent>
        <TabsContent value="decisions" className="mt-4">
          <DecisionsTab />
        </TabsContent>
        <TabsContent value="plans" className="mt-4">
          <PlansPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
