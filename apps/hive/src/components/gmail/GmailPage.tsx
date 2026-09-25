import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@hive/shared/components/ui/tabs';
import { Badge } from '@hive/shared/components/ui/badge';
import { useGmailStore } from '@/stores/gmail-store';
import { API_BASE } from '@/lib/api-config';
import ConnectPrompt from './ConnectPrompt';
import InboxTab from './InboxTab';
import EmailDetail from './EmailDetail';
import CalendarTab from './CalendarTab';

export default function GmailPage() {
  const {
    connected,
    setConnected,
    selectedMessage,
    unreadCount,
    error,
  } = useGmailStore();

  const [checking, setChecking] = useState(true);
  const [activeTab, setActiveTab] = useState('inbox');

  useEffect(() => {
    async function checkStatus() {
      setChecking(true);
      try {
        const res = await fetch(`${API_BASE}/api/gmail/status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setConnected(data.connected === true);
      } catch {
        setConnected(false);
      } finally {
        setChecking(false);
      }
    }
    checkStatus();
  }, [setConnected]);

  if (checking) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!connected) {
    return <ConnectPrompt />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="inbox" className="relative" data-track="gmail.tab.inbox" data-track-category="nav">
            Inbox
            {unreadCount > 0 && (
              <Badge
                variant="default"
                className="ml-1.5 text-[10px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="calendar" data-track="gmail.tab.calendar" data-track-category="nav">Calendar</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox">
          {selectedMessage ? <EmailDetail /> : <InboxTab />}
        </TabsContent>

        <TabsContent value="calendar">
          <CalendarTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
