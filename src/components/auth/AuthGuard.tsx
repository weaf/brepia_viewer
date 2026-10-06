import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { ssoProvider } from '@/lib/supabase';
import { signInWithSsoProvider } from '@/lib/ssoAuth';
import { getAccountAccess } from '@/services/accountAdminService';
import { ActivityIndicator } from '@/components/brand';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { session, user, isLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const hasFiredSsoRedirect = useRef(false);
  const hasFiredPasswordRedirect = useRef(false);

  const { data: access, isLoading: isAccessLoading } = useQuery({
    queryKey: ['account-access', user?.id],
    queryFn: getAccountAccess,
    enabled: Boolean(session && user),
    staleTime: 15_000,
    retry: 1,
  });

  useEffect(() => {
    if (isLoading) return;

    if (session || user) {
      // A later sign-out from the same mounted guard must be allowed to start a
      // fresh redirect, but a single unauthenticated transition may only fire
      // once. TanStack can briefly keep this guard mounted while navigating to
      // /signin; without this latch the changing location would recursively
      // become signin?redirect=/signin?redirect=... .
      hasFiredSsoRedirect.current = false;
      hasFiredPasswordRedirect.current = false;
      return;
    }

    const currentPath = location.pathname + location.searchStr;

    if (ssoProvider) {
      if (hasFiredSsoRedirect.current) return;
      hasFiredSsoRedirect.current = true;

      signInWithSsoProvider(currentPath).catch((error) => {
        toast({
          title: 'Whoopsies',
          description:
            error instanceof Error ? error.message : 'Something went wrong',
          variant: 'destructive',
        });
        navigate({ to: '/', replace: true });
      });
      return;
    }

    if (hasFiredPasswordRedirect.current) return;
    hasFiredPasswordRedirect.current = true;

    // /signin is not a guarded route, but the old guarded tree can remain
    // mounted for one render during router transition. Never capture an auth
    // surface itself as the post-login destination.
    const redirectablePath =
      currentPath !== '/' &&
      location.pathname !== '/signin' &&
      location.pathname !== '/signup' &&
      location.pathname !== '/reset-password'
        ? currentPath
        : undefined;
    const search = redirectablePath ? { redirect: redirectablePath } : {};
    navigate({ to: '/signin', search, replace: true });
  }, [
    session,
    user,
    navigate,
    isLoading,
    location.pathname,
    location.searchStr,
  ]);

  if (isLoading || (session && user && isAccessLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ActivityIndicator label="Loading Brepia" size="lg" />
      </div>
    );
  }

  if (!session || !user) {
    if (ssoProvider) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <ActivityIndicator label="Redirecting to sign in" size="lg" />
        </div>
      );
    }
    return null;
  }

  if (access?.status === 'pending' || access?.status === 'disabled') {
    const pending = access.status === 'pending';
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-background-1 px-4">
        <div className="w-full max-w-md rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-8 text-center">
          <h1 className="text-xl font-medium text-adam-neutral-50">
            {pending ? 'Account awaiting approval' : 'Account disabled'}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-adam-neutral-200">
            {pending
              ? 'An administrator must approve this account before Brepia can be used.'
              : 'This account has been disabled by an administrator.'}
          </p>
          <Button
            variant="dark"
            className="mt-6 rounded-full"
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  // If the access endpoint is unavailable, protected APIs still enforce the
  // active-account rule. Avoid rendering the application until status is known.
  if (!access) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-background-1 px-4">
        <div className="w-full max-w-md rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-8 text-center">
          <h1 className="text-xl font-medium text-adam-neutral-50">
            Account access unavailable
          </h1>
          <p className="mt-3 text-sm text-adam-neutral-200">
            Brepia could not verify the account status. Check the local Supabase
            service and try again.
          </p>
          <Button
            variant="dark"
            className="mt-6 rounded-full"
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
