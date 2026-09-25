import { useCallback, useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { PlanEntry } from '@/stores/types';
import PlanViewer from './PlanViewer';
import TeamItemsSection from '@/components/shared/TeamItemsSection';

import { API_BASE } from '@/lib/api-config';

export default function PlansPage() {
  const [plans, setPlans] = useState<PlanEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlans = useCallback(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/insights/plans`)
      .then((r) => r.json())
      .then(setPlans)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  return (
    <div className="p-6">
      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine">My Plans</TabsTrigger>
          <TabsTrigger value="team">Team Plans</TabsTrigger>
        </TabsList>
        <TabsContent value="mine" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-muted-foreground text-sm">Loading plans...</div>
            </div>
          ) : (
            <PlanViewer plans={plans} />
          )}
        </TabsContent>
        <TabsContent value="team" className="mt-4">
          <TeamItemsSection itemType="plan" onInstall={fetchPlans} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
