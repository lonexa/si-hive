import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import type { HiveRole } from './types';

interface RequireRoleProps {
  roles: HiveRole[];
  children: React.ReactNode;
}

/**
 * Route guard that checks if the current user has one of the required roles.
 * If auth is not configured, allows all access.
 * If user doesn't have the required role, redirects to dashboard.
 */
export default function RequireRole({ roles, children }: RequireRoleProps) {
  const { user, authConfigured, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  // If auth is not configured, allow everything
  if (!authConfigured) return <>{children}</>;

  // If not logged in, this shouldn't happen (AuthProvider handles it)
  if (!user) return <Navigate to="/" replace />;

  // Check role
  if (!roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
