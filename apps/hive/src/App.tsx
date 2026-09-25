import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { router } from './router';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useNotifications } from '@/hooks/useNotifications';
import { useMessagesPoll } from '@/hooks/useMessagesPoll';
import { useTheme } from '@/hooks/useTheme';
import { useErrorReporter } from '@/hooks/useErrorReporter';
import { TrackingRoot } from '@/components/TrackingRoot';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import LoginPage from '@/auth/LoginPage';
import SetupWizard from '@/components/setup/SetupWizard';
import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api-config';

function Initializers() {
  useWebSocket();
  useNotifications();
  useMessagesPoll();
  useTheme();
  useErrorReporter();
  return null;
}

/** Whether the first-run wizard should show (admins only, until finished or skipped). */
function useSetupPending(enabled: boolean): [boolean | null, () => void] {
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) { setPending(false); return; }
    fetch(`${API_BASE}/api/setup`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { completed: true }))
      .then((s: { completed: boolean }) => setPending(!s.completed))
      .catch(() => setPending(false));
  }, [enabled]);
  const done = useCallback(() => setPending(false), []);
  return [pending, done];
}

function AuthGate() {
  const { isAuthenticated, isLoading, authConfigured, user } = useAuth();
  const [setupPending, finishSetup] = useSetupPending(!isLoading && (!authConfigured || isAuthenticated) && user?.role === 'admin');

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  // If auth is configured and user is not authenticated, show login
  if (authConfigured && !isAuthenticated) {
    return <LoginPage />;
  }

  if (setupPending) {
    return <SetupWizard onDone={finishSetup} />;
  }

  // Authenticated (or auth not configured) — show the app
  return (
    <>
      <Initializers />
      <ThemedToaster />
      <TrackingRoot>
        <RouterProvider router={router} />
      </TrackingRoot>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function ThemedToaster() {
  const theme = useTheme();
  return (
    <Toaster
      theme={theme}
      position="top-right"
      closeButton
      toastOptions={{
        style: {
          background: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
          color: 'hsl(var(--foreground))',
        },
      }}
    />
  );
}
