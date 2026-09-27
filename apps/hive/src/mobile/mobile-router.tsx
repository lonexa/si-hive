import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import RequireRole from '@/auth/RequireRole';
import RequireFeature from '@/auth/RequireFeature';
import { registerRouter } from '@/lib/app-navigate';
import MobileLayout, { type MobileRouteHandle } from './MobileLayout';
import { Compat } from './components';

// Phone-specific pages.
const MobileHomePage = lazy(() => import('./MobileHomePage'));
const MobileSessionsPage = lazy(() => import('./MobileSessionsPage'));
const MobileProjectsPage = lazy(() => import('./MobileProjectsPage'));
const MobileNewSessionPage = lazy(() => import('./MobileNewSessionPage'));
const MobileMorePage = lazy(() => import('./MobileMorePage'));
const MobileChatPage = lazy(() => import('./MobileChatPage'));
const MobileSettingsPage = lazy(() => import('./MobileSectionPages').then((m) => ({ default: m.MobileSettingsPage })));
const MobileAIStudioPage = lazy(() => import('./MobileSectionPages').then((m) => ({ default: m.MobileAIStudioPage })));

// Desktop pages that already reflow well at phone width; the mobile layout
// and stylesheet (mobile.css) take care of their tab strips, tables and dialogs.
const SessionDetailPage = lazy(() => import('@/components/sessions/SessionDetailPage'));
const TeamDetail = lazy(() => import('@/components/teams/TeamDetail'));
const ClaudeMdEditorPage = lazy(() => import('@/components/projects/ClaudeMdEditorPage'));
const AnalyticsPage = lazy(() => import('@/components/analytics/AnalyticsPage'));
const KnowledgePage = lazy(() => import('@/components/knowledge/KnowledgePage'));
const PersonasPage = lazy(() => import('@/components/personas/PersonasPage'));
const UpdatePage = lazy(() => import('@/components/updates/UpdatePage'));
const GmailPage = lazy(() => import('@/components/gmail/GmailPage'));
const TodoPage = lazy(() => import('@/components/todo/TodoPage'));
const WorkflowStudioPage = lazy(() => import('@/components/workflows/WorkflowStudioPage'));
const TeamPage = lazy(() => import('@/components/team/TeamPage'));
const SearchPage = lazy(() => import('@/components/search/SearchPage'));
const ReviewsPage = lazy(() => import('@/components/reviews/ReviewsPage'));
const WorkPage = lazy(() => import('@/components/delivery/WorkPage'));
const PullRequestsPage = lazy(() => import('@/components/delivery/PullRequestsPage'));
const MainFeedPage = lazy(() => import('@/components/delivery/MainFeedPage'));
const UserManagementPage = lazy(() => import('@/components/admin/UserManagementPage'));
const SkillRequirementsPage = lazy(() => import('@/components/admin/SkillRequirementsPage'));
const AiAccountsPage = lazy(() => import('@/components/admin/AiAccountsPage'));
const UsagePage = lazy(() => import('@/components/admin/UsagePage'));

function PageLoader() {
  return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Loading…</div>;
}

function S({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

/** A desktop page, adapted for the phone by mobile.css. */
function D({ children }: { children: ReactNode }) {
  return <S><Compat>{children}</Compat></S>;
}

function F({ feature, children }: { feature: string; children: ReactNode }) {
  return <D><RequireFeature feature={feature}>{children}</RequireFeature></D>;
}

function Admin({ feature, children }: { feature?: string; children: ReactNode }) {
  return (
    <D>
      <RequireRole roles={['admin']}>
        {feature ? <RequireFeature feature={feature}>{children}</RequireFeature> : children}
      </RequireRole>
    </D>
  );
}

const fullBleed: MobileRouteHandle = { fullBleed: true };

export const mobileRouter = createBrowserRouter([
  {
    path: '/',
    element: <MobileLayout />,
    children: [
      { index: true, element: <S><MobileHomePage /></S> },
      { path: 'dashboard', element: <S><MobileHomePage /></S> },
      { path: 'more', element: <S><MobileMorePage /></S> },
      { path: 'new', element: <S><MobileNewSessionPage /></S> },

      { path: 'sessions', element: <S><MobileSessionsPage /></S> },
      { path: 'sessions/:sessionId', element: <S><SessionDetailPage /></S>, handle: fullBleed },
      { path: 'projects', element: <S><MobileProjectsPage /></S> },
      { path: 'projects/:projectPath/claude-md', element: <D><ClaudeMdEditorPage /></D> },
      { path: 'chat', element: <S><MobileChatPage /></S>, handle: fullBleed },
      { path: 'settings', element: <S><MobileSettingsPage /></S> },
      { path: 'ai-studio', element: <S><MobileAIStudioPage /></S> },

      { path: 'teams/:name', element: <D><TeamDetail /></D> },
      { path: 'personas', element: <F feature="personas"><PersonasPage /></F> },
      { path: 'knowledge', element: <F feature="knowledge"><KnowledgePage /></F> },
      { path: 'updates', element: <D><UpdatePage /></D> },
      { path: 'analytics', element: <D><AnalyticsPage /></D> },
      { path: 'gmail', element: <F feature="gmail"><GmailPage /></F> },
      { path: 'todo', element: <F feature="todo"><TodoPage /></F> },
      { path: 'workflows', element: <F feature="workflows"><WorkflowStudioPage /></F> },
      { path: 'team', element: <F feature="team-dashboard"><TeamPage /></F> },
      { path: 'search', element: <F feature="search"><SearchPage /></F> },
      { path: 'reviews', element: <F feature="peer-review"><ReviewsPage /></F> },
      { path: 'work', element: <F feature="work"><WorkPage /></F> },
      { path: 'pulls', element: <F feature="pull-requests"><PullRequestsPage /></F> },
      { path: 'main-feed', element: <F feature="main-feed"><MainFeedPage /></F> },

      { path: 'admin/users', element: <Admin feature="user-management"><UserManagementPage /></Admin> },
      { path: 'admin/skill-requirements', element: <Admin feature="skill-requirements"><SkillRequirementsPage /></Admin> },
      { path: 'admin/ai-accounts', element: <Admin><AiAccountsPage /></Admin> },
      { path: 'admin/adoption', element: <Admin feature="user-management"><UsagePage /></Admin> },

      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

registerRouter(mobileRouter);
