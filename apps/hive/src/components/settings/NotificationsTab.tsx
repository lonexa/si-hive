import { useState } from 'react';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { API_BASE } from '@/lib/api-config';

export default function NotificationsTab() {
  const notificationConfig = useDashboardStore((s) => s.notificationConfig);
  const updateNotificationConfig = useDashboardStore((s) => s.updateNotificationConfig);
  const updateAppConfig = useDashboardStore((s) => s.updateAppConfig);

  const [macOS, setMacOS] = useState(notificationConfig.macOS);
  const [browser, setBrowser] = useState(notificationConfig.browser);

  async function patchConfig(updates: Record<string, unknown>) {
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json() as { ok: boolean; notifications?: { macOS: boolean; browser: boolean }; projectsRoot?: string; theme?: 'dark' | 'light' };
        if (data.notifications) updateNotificationConfig(data.notifications);
        updateAppConfig({ projectsRoot: data.projectsRoot, theme: data.theme });
      }
    } catch {
      // Network error
    }
  }

  function handleMacOSChange(checked: boolean) {
    setMacOS(checked);
    void patchConfig({ notifications: { macOS: checked } });
  }

  function handleBrowserChange(checked: boolean) {
    setBrowser(checked);
    void patchConfig({ notifications: { browser: checked } });
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Notification Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure how and when you receive notifications</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Delivery Methods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-sm font-medium text-foreground">Desktop notifications</span>
              <p className="text-xs text-muted-foreground">Native OS alerts (macOS / Windows toast)</p>
            </div>
            <Switch
              checked={macOS}
              onCheckedChange={handleMacOSChange}
              aria-label="Toggle desktop notifications"
            />
          </div>

          <div className="h-px bg-border" />

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-sm font-medium text-foreground">Browser notifications</span>
              <p className="text-xs text-muted-foreground">Web push notifications when tab is open</p>
            </div>
            <Switch
              checked={browser}
              onCheckedChange={handleBrowserChange}
              aria-label="Toggle browser notifications"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event Types</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Fine-grained notification configuration per event type, per project, and per severity level coming soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
