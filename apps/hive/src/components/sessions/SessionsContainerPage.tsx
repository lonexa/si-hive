import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import SessionsPage from './SessionsPage';
import HistoryPage from '@/components/insights/HistoryPage';
import TemplatesTab from './TemplatesTab';
import PromptsTab from './PromptsTab';
import ReplayTab from './ReplayTab';

const TABS = [
  { value: 'board', label: 'Board' },
  { value: 'templates', label: 'Templates' },
  { value: 'prompts', label: 'Prompts' },
  { value: 'replay', label: 'Replay' },
  { value: 'history', label: 'History' },
] as const;

export default function SessionsContainerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'board';

  const handleTabChange = (value: string) => {
    if (value === 'board') {
      // Keep existing search params but remove tab
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
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              data-track={`sessions.tab.${tab.value}`}
              data-track-category="nav"
            >{tab.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="board" className="mt-4">
          <SessionsPage />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="prompts" className="mt-4">
          <PromptsTab />
        </TabsContent>
        <TabsContent value="replay" className="mt-4">
          <ReplayTab />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
