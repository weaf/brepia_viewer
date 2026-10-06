import { Link, useNavigate, useLocation } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useMutation, useQuery } from '@tanstack/react-query';
import { GoogleIcon } from '@/components/icons/CompanyIcons';
import { useEffect } from 'react';
import { validateRedirectUrl } from '@/lib/utils';
import { getRegistrationSettings } from '@/services/accountAdminService';
import { ActivityIndicator, BrepiaBrand } from '@/components/brand';

function getAppRedirectUrl(path: string) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${basePath}${path}`;
}

export function SignUpView() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, user, isLoading: authLoading } = useAuth();
  const {
    data: registration,
    isLoading: policyLoading,
    isError: policyFailed,
    isFetching: policyFetching,
    refetch: refetchRegistration,
  } = useQuery({
    queryKey: ['registration-settings'],
    queryFn: getRegistrationSettings,
  });

  const searchParams = new URLSearchParams(location.searchStr);
  const redirectPath = validateRedirectUrl(
    searchParams.get('redirect'),
    '/app',
  );

  useEffect(() => {
    if (!authLoading && session && user) {
      void navigate({
        ...(() => {
          const url = new URL(redirectPath, window.location.origin);
          return {
            to: url.pathname,
            search: Object.fromEntries(url.searchParams.entries()),
            hash: url.hash ? url.hash.slice(1) : undefined,
          };
        })(),
        replace: true,
      });
    }
  }, [session, user, authLoading, navigate, redirectPath]);

  useEffect(() => {
    if (
      !policyLoading &&
      registration &&
      !registration.bootstrapAvailable &&
      !registration.allowRegistration
    ) {
      navigate({ to: '/signin', replace: true });
    }
  }, [policyLoading, registration, navigate]);

  const { mutate: signInWithGoogle, isPending: isSigningInWithGoogle } =
    useMutation({
      mutationFn: async () => {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: getAppRedirectUrl(redirectPath) },
        });
        if (error) throw error;
      },
      onError: (error) =>
        toast({
          title: 'Whoopsies',
          description:
            error instanceof Error ? error.message : 'Something went wrong',
          variant: 'destructive',
        }),
    });

  const bootstrap = registration?.bootstrapAvailable === true;
  const emailAllowed =
    !bootstrap &&
    registration?.allowRegistration === true &&
    (registration.identityPolicy === 'email' ||
      registration.identityPolicy === 'email_or_social');
  const socialAllowed =
    !bootstrap &&
    registration?.allowRegistration === true &&
    (registration.identityPolicy === 'social' ||
      registration.identityPolicy === 'email_or_social') &&
    registration.allowedSocialProviders.includes('google');

  if (policyLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark">
        <ActivityIndicator label="Loading registration policy" size="lg" />
      </div>
    );
  }

  if (policyFailed || !registration) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
        <div className="w-full max-w-md rounded-lg bg-adam-bg-secondary-dark p-8 text-center shadow-md">
          <h1 className="text-xl font-semibold text-adam-text-primary">
            Registration unavailable
          </h1>
          <p className="mt-3 text-sm text-adam-text-secondary">
            Brepia could not load the registration policy from the server.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Button
              type="button"
              className="w-full"
              disabled={policyFetching}
              onClick={() => void refetchRegistration()}
            >
              {policyFetching ? (
                <>
                  <ActivityIndicator
                    label="Retrying registration policy"
                    size="sm"
                    className="mr-2"
                  />
                  Retrying...
                </>
              ) : (
                'Try again'
              )}
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link to="/signin">Back to sign in</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!registration.bootstrapAvailable && !registration.allowRegistration) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark">
        <ActivityIndicator label="Checking registration access" size="lg" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
      <div className="w-full max-w-md">
        <div className="rounded-lg bg-adam-bg-secondary-dark p-8 shadow-md">
          <div className="mb-4 flex flex-col items-center justify-center gap-3">
            <BrepiaBrand showByNoty />
            <h1 className="text-xl font-semibold text-adam-text-primary">
              {bootstrap ? 'Create administrator account' : 'Create account'}
            </h1>
          </div>

          {bootstrap ? (
            <div className="space-y-5 text-center">
              <p className="text-sm text-adam-text-secondary">
                No account exists yet. Create the first administrator using a
                username or email address and a password.
              </p>
              <Button asChild className="w-full p-6">
                <Link to="/signup-email">Create first administrator</Link>
              </Button>
              <Link
                to="/signin"
                className="inline-block text-sm text-adam-blue hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              {socialAllowed && (
                <div className="w-full py-2">
                  <Button
                    onClick={() => signInWithGoogle()}
                    className="flex w-full items-center gap-2 p-6 md:hover:bg-adam-blue/10"
                    disabled={isSigningInWithGoogle}
                  >
                    <GoogleIcon className="w-4" />
                    <span>Continue with Google</span>
                  </Button>
                </div>
              )}

              {emailAllowed && (
                <div className="pt-4 text-center text-sm text-adam-text-secondary">
                  <Link
                    to="/signup-email"
                    className="text-adam-text-primary hover:underline"
                  >
                    Sign up with email
                  </Link>
                </div>
              )}

              {!emailAllowed && !socialAllowed && (
                <p className="py-4 text-center text-sm text-adam-text-secondary">
                  No configured registration provider is currently available.
                </p>
              )}

              {registration.requireAdminApproval && (
                <p className="mt-4 text-center text-xs text-adam-text-secondary">
                  New accounts require administrator approval before Brepia can
                  be used.
                </p>
              )}
              <div className="pt-4 text-center text-sm">
                <Link to="/signin" className="text-adam-blue hover:underline">
                  Already have an account? Sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
