import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import MessagesWidget from '@/components/messages/MessagesWidget';
import IncomingBanner from '@/components/messages/IncomingBanner';
import AttentionPanel from '@/components/shared/AttentionPanel';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import { useNowPublisher } from '@/hooks/useNowPublisher';
import { useAuth } from '@/auth/AuthProvider';

export default function AppLayout() {
  useActivityTracker();
  const { isAuthenticated, hasAccess } = useAuth();
  // Presence is a Team-module feature (needs login).
  useNowPublisher(isAuthenticated && hasAccess('team-dashboard'));

  return (
    // h-dvh, not h-screen: on phones 100vh includes the area behind the
    // browser's address bar, which pushed the bottom of the page off screen.
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-2 md:p-6">
          <Outlet />
        </main>
      </div>
      <IncomingBanner />
      <MessagesWidget />
      <AttentionPanel />
    </div>
  );
}
