import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import RequireRole from '@/auth/RequireRole';
import RequireFeature from '@/auth/RequireFeature';
import { useAuth } from '@/auth/AuthProvider';
import { useNavStore } from '@/stores/nav-store';
import { findNavItem } from '@/components/layout/nav-config';

// Lazy load pages for code splitting
import { lazy, Suspense } from 'react';

const DashboardContainerPage = lazy(() => import('@/components/dashboard/DashboardContainerPage'));
const TeamDetail = lazy(() => import('@/components/teams/TeamDetail'));
const SessionsContainerPage = lazy(() => import('@/components/sessions/SessionsContainerPage'));
const SessionDetailPage = lazy(() => import('@/components/sessions/SessionDetailPage'));
const ProjectsContainerPage = lazy(() => import('@/components/projects/ProjectsContainerPage'));
const ClaudeMdEditorPage = lazy(() => import('@/components/projects/ClaudeMdEditorPage'));
const AIStudioPage = lazy(() => import('@/components/ai-studio/AIStudioPage'));
const AnalyticsPage = lazy(() => import('@/components/analytics/AnalyticsPage'));
const KnowledgePage = lazy(() => import('@/components/knowledge/KnowledgePage'));
const SettingsContainerPage = lazy(() => import('@/components/settings/SettingsContainerPage'));
const PersonasPage = lazy(() => import('@/components/personas/PersonasPage'));
const UpdatePage = lazy(() => import('@/components/updates/UpdatePage'));

const ChatPage = lazy(() => import('@/components/chat/ChatPage'));
const GmailPage = lazy(() => import('@/components/gmail/GmailPage'));
const TodoPage = lazy(() => import('@/components/todo/TodoPage'));
const WorkflowStudioPage = lazy(() => import('@/components/workflows/WorkflowStudioPage'));
const TeamPage = lazy(() => import('@/components/team/TeamPage'));
const SearchPage = lazy(() => import('@/components/search/SearchPage'));
const ReviewsPage = lazy(() => import('@/components/reviews/ReviewsPage'));
const WorkPage = lazy(() => import('@/components/delivery/WorkPage'));
const PullRequestsPage = lazy(() => import('@/components/delivery/PullRequestsPage'));
const MainFeedPage = lazy(() => import('@/components/delivery/MainFeedPage'));

// Admin pages
const UserManagementPage = lazy(() => import('@/components/admin/UserManagementPage'));
const SkillRequirementsPage = lazy(() => import('@/components/admin/SkillRequirementsPage'));
const AiAccountsPage = lazy(() => import('@/components/admin/AiAccountsPage'));
const UsagePage = lazy(() => import('@/components/admin/UsagePage'));

// eslint-disable-next-line react-refresh/only-export-components
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-muted-foreground text-sm">Loading...</div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

// Honors the user's configured home page. Falls back to the dashboard when no
// custom home is set or the configured route isn't accessible (prevents a
// redirect loop against RequireRole).
// eslint-disable-next-line react-refresh/only-export-components
function HomeRedirect() {
  const homeRoute = useNavStore((s) => s.homeRoute);
  const { hasAccess } = useAuth();
  if (homeRoute && homeRoute !== '/') {
    const item = findNavItem(homeRoute);
    if (!item?.feature || hasAccess(item.feature)) {
      return <Navigate to={homeRoute} replace />;
    }
  }
  return <SuspenseWrapper><DashboardContainerPage /></SuspenseWrapper>;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'dashboard', element: <SuspenseWrapper><DashboardContainerPage /></SuspenseWrapper> },

      // All roles
      { path: 'teams/:name', element: <SuspenseWrapper><TeamDetail /></SuspenseWrapper> },
      { path: 'sessions', element: <SuspenseWrapper><SessionsContainerPage /></SuspenseWrapper> },
      { path: 'sessions/:sessionId', element: <SuspenseWrapper><SessionDetailPage /></SuspenseWrapper> },
      { path: 'personas', element: <SuspenseWrapper><RequireFeature feature="personas"><PersonasPage /></RequireFeature></SuspenseWrapper> },
      { path: 'ai-studio', element: <SuspenseWrapper><AIStudioPage /></SuspenseWrapper> },
      { path: 'knowledge', element: <SuspenseWrapper><RequireFeature feature="knowledge"><KnowledgePage /></RequireFeature></SuspenseWrapper> },
      { path: 'updates', element: <SuspenseWrapper><UpdatePage /></SuspenseWrapper> },
      { path: 'settings', element: <SuspenseWrapper><SettingsContainerPage /></SuspenseWrapper> },

      { path: 'projects', element: <SuspenseWrapper><ProjectsContainerPage /></SuspenseWrapper> },
      { path: 'projects/:projectPath/claude-md', element: <SuspenseWrapper><ClaudeMdEditorPage /></SuspenseWrapper> },
      { path: 'analytics', element: <SuspenseWrapper><AnalyticsPage /></SuspenseWrapper> },

      { path: 'chat', element: <SuspenseWrapper><ChatPage /></SuspenseWrapper> },
      { path: 'gmail', element: <SuspenseWrapper><RequireFeature feature="gmail"><GmailPage /></RequireFeature></SuspenseWrapper> },
      { path: 'todo', element: <SuspenseWrapper><RequireFeature feature="todo"><TodoPage /></RequireFeature></SuspenseWrapper> },
      { path: 'workflows', element: <SuspenseWrapper><RequireFeature feature="workflows"><WorkflowStudioPage /></RequireFeature></SuspenseWrapper> },
      { path: 'team', element: <SuspenseWrapper><RequireFeature feature="team-dashboard"><TeamPage /></RequireFeature></SuspenseWrapper> },
      { path: 'search', element: <SuspenseWrapper><RequireFeature feature="search"><SearchPage /></RequireFeature></SuspenseWrapper> },
      { path: 'reviews', element: <SuspenseWrapper><RequireFeature feature="peer-review"><ReviewsPage /></RequireFeature></SuspenseWrapper> },
      { path: 'work', element: <SuspenseWrapper><RequireFeature feature="work"><WorkPage /></RequireFeature></SuspenseWrapper> },
      { path: 'pulls', element: <SuspenseWrapper><RequireFeature feature="pull-requests"><PullRequestsPage /></RequireFeature></SuspenseWrapper> },
      { path: 'main-feed', element: <SuspenseWrapper><RequireFeature feature="main-feed"><MainFeedPage /></RequireFeature></SuspenseWrapper> },

      // Admin only
      { path: 'admin/users', element: <SuspenseWrapper><RequireRole roles={['admin']}><RequireFeature feature="user-management"><UserManagementPage /></RequireFeature></RequireRole></SuspenseWrapper> },
      { path: 'admin/skill-requirements', element: <SuspenseWrapper><RequireRole roles={['admin']}><RequireFeature feature="skill-requirements"><SkillRequirementsPage /></RequireFeature></RequireRole></SuspenseWrapper> },
      { path: 'admin/ai-accounts', element: <SuspenseWrapper><RequireRole roles={['admin']}><AiAccountsPage /></RequireRole></SuspenseWrapper> },
      { path: 'admin/adoption', element: <SuspenseWrapper><RequireRole roles={['admin']}><RequireFeature feature="user-management"><UsagePage /></RequireFeature></RequireRole></SuspenseWrapper> },
    ],
  },
]);
