import { Link } from 'react-router-dom';
import { Blocks } from 'lucide-react';
import { useAuth } from './AuthProvider';

/**
 * Route guard for pages owned by an optional module (or a role-gated
 * feature). Shows how to turn the module on instead of rendering a page whose
 * APIs would 404.
 */
export default function RequireFeature({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { hasAccess, isLoading } = useAuth();
  if (isLoading || hasAccess(feature)) return <>{children}</>;
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-2 text-center text-muted-foreground">
      <Blocks className="h-8 w-8 opacity-50" />
      <p className="text-sm font-medium text-foreground">This page isn't available</p>
      <p className="text-xs max-w-sm">
        Its module is turned off or still needs setup. An admin can enable it in{' '}
        <Link to="/settings?tab=modules" className="text-primary hover:underline">Settings → Modules</Link>.
      </p>
    </div>
  );
}
