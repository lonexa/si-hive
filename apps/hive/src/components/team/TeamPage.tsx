import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@hive/shared/components/ui/tabs';
import NowTab from './NowTab';
import AiUsageTab from './AiUsageTab';

export default function TeamPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'now';

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="now" data-track="team.tab.now" data-track-category="nav">Now</TabsTrigger>
          <TabsTrigger value="ai-usage" data-track="team.tab.ai_usage" data-track-category="nav">AI Usage</TabsTrigger>
        </TabsList>
        <TabsContent value="now" className="mt-4">
          <NowTab />
        </TabsContent>
        <TabsContent value="ai-usage" className="mt-4">
          <AiUsageTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
