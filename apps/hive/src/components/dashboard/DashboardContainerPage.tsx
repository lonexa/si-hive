import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import DashboardPage from './DashboardPage';
import CalendarTab from './CalendarTab';
import { useAuth } from '@/auth/AuthProvider';

const TABS: ReadonlyArray<{ value: string; label: string; badge?: string; feature?: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'calendar', label: 'Calendar' },
];

export default function DashboardContainerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasAccess } = useAuth();
  const tabs = TABS.filter((t) => !t.feature || hasAccess(t.feature));
  const requested = searchParams.get('tab') || 'overview';
  const activeTab = tabs.some((t) => t.value === requested) ? requested : 'overview';

  const handleTabChange = (value: string) => {
    if (value === 'overview') {
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
            <TabsTrigger key={tab.value} value={tab.value} data-track={`dashboard.tab.${tab.value}`} data-track-category="nav">
              <span className="flex items-center gap-1.5">
                {tab.label}
                {tab.badge && (
                  <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-violet-600 dark:text-violet-400">
                    {tab.badge}
                  </span>
                )}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <DashboardPage />
        </TabsContent>
        <TabsContent value="calendar" className="mt-4">
          <CalendarTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
