import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import InsightsPage from '@/components/insights/InsightsPage';
import TimeTab from '@/components/analytics/TimeTab';

const TABS = [
  { value: 'usage', label: 'Usage' },
  { value: 'time', label: 'Time' },
] as const;

export default function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'usage';

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
              data-track={`analytics.tab.${tab.value}`}
              data-track-category="nav"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="usage" className="mt-4">
          <InsightsPage />
        </TabsContent>
        <TabsContent value="time" className="mt-4">
          <TimeTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
