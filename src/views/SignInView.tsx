import { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from '@tanstack/react-router';
import { ArrowLeft, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '@/components/ui/input-otp';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { AuthError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useMutation, useQuery } from '@tanstack/react-query';
import { GoogleIcon } from '@/components/icons/CompanyIcons';
import { validateRedirectUrl } from '@/lib/utils';
import { getRegistrationSettings } from '@/services/accountAdminService';
import { ActivityIndicator, BrepiaBrand } from '@/components/brand';

function getAppRedirectUrl(path: string) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${basePath}${path}`;
}

function getRedirectNavigationOptions(path: string) {
  const url = new URL(path, window.location.origin);
  const search = Object.fromEntries(url.searchParams.entries());
  return {
    to: url.pathname,
    search,
    hash: url.hash ? url.hash.slice(1) : undefined,
  };
}

function passwordAuthEmail(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  return normalized.includes('@') ? normalized : `${normalized}@brepia.invalid`;
}

export function SignInView() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'password' | 'magiclink'>('password');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    signIn,
    signInWithMagicLink,
    verifyOtp,
    session,
    user,
    isLoading: authLoading,
  } = useAuth();
  const { toast } = useToast();
  const { data: registration } = useQuery({
    queryKey: ['registration-settings'],
    queryFn: getRegistrationSettings,
    staleTime: 30_000,
  });

  const searchParams = new URLSearchParams(location.searchStr);
  const redirectPath = validateRedirectUrl(
    searchParams.get('redirect'),
    '/app',
  );

  useEffect(() => {
    if (!authLoading && session && user) {
      void navigate({
        ...getRedirectNavigationOptions(redirectPath),
        replace: true,
      });
    }
  }, [session, user, authLoading, navigate, redirectPath]);

  const { mutate: signInWithGoogle, isPending: isSigningInWithGoogle } =
    useMutation({
      mutationFn: async () => {
        const redirectTo = getAppRedirectUrl(redirectPath);
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo },
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

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await signIn(passwordAuthEmail(identifier), password);
      navigate(getRedirectNavigationOptions(redirectPath));
    } catch (err) {
      const authError = err as AuthError;
      const message =
        authError.message === 'Invalid login credentials'
          ? 'Invalid username/email or password'
          : 'An error occurred while signing in';
      setError(message);
      toast({
        title: 'Whoopsies',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.includes('@')) {
      const message = 'Enter an email address to use email sign-in.';
      setError(message);
      toast({
        title: 'Email required',
        description: message,
        variant: 'destructive',
      });
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await signInWithMagicLink(identifier.trim());
      setMagicLinkSent(true);
    } catch (err) {
      const authError = err as AuthError;
      setError(authError.message);
      toast({
        title: 'Whoopsies',
        description: authError.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) return;
    setIsVerifying(true);
    setError(null);
    try {
      await verifyOtp(identifier.trim(), otp);
      navigate(getRedirectNavigationOptions(redirectPath));
    } catch (err) {
      const authError = err as AuthError;
      setError(authError.message);
      toast({
        title: 'Whoopsies',
        description: authError.message,
        variant: 'destructive',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  if (magicLinkSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
        <div className="w-full max-w-md">
          <div className="flex flex-col gap-4 rounded-lg bg-adam-bg-secondary-dark p-8 shadow-md">
            <button
              onClick={() => {
                setMagicLinkSent(false);
                setOtp('');
                setError(null);
                setMode('password');
              }}
              className="flex items-center gap-1 text-sm text-adam-text-secondary transition-colors hover:text-adam-text-primary"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-adam-blue/20">
                <Mail className="h-6 w-6 text-adam-blue" />
              </div>
              <h3 className="text-lg font-semibold text-adam-text-primary">
                Check your email
              </h3>
              <p className="text-center text-sm text-adam-text-secondary">
                We sent a sign-in email to{' '}
                <span className="font-medium text-adam-text-primary">
                  {identifier}
                </span>
              </p>
            </div>
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/50 dark:text-red-200">
                {error}
              </div>
            )}
            <div className="relative flex items-center gap-3 py-2">
              <div className="h-px flex-1 bg-adam-neutral-700" />
              <span className="text-xs text-adam-text-secondary">
                or enter code manually
              </span>
              <div className="h-px flex-1 bg-adam-neutral-700" />
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleVerifyOtp();
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={otp}
                  onChange={setOtp}
                  onComplete={() => void handleVerifyOtp()}
                  className="gap-2"
                >
                  <InputOTPGroup className="text-adam-text-primary">
                    {[0, 1, 2].map((index) => (
                      <InputOTPSlot
                        key={index}
                        index={index}
                        className="h-11 w-11 border-adam-neutral-700 bg-adam-bg-dark"
                      />
                    ))}
                  </InputOTPGroup>
                  <InputOTPSeparator className="text-adam-text-secondary" />
                  <InputOTPGroup className="text-adam-text-primary">
                    {[3, 4, 5].map((index) => (
                      <InputOTPSlot
                        key={index}
                        index={index}
                        className="h-11 w-11 border-adam-neutral-700 bg-adam-bg-dark"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={otp.length !== 6 || isVerifying}
              >
                {isVerifying ? (
                  <>
                    <ActivityIndicator
                      label="Verifying sign-in code"
                      size="sm"
                      className="mr-2"
                    />
                    Verifying...
                  </>
                ) : (
                  'Verify Code'
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const signupAvailable =
    registration?.bootstrapAvailable === true ||
    registration?.allowRegistration === true;

  return (
    <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col gap-4 rounded-lg bg-adam-bg-secondary-dark p-8 shadow-md">
          <div className="mb-4 flex flex-col items-center justify-center">
            <BrepiaBrand showByNoty />
          </div>

          <Button
            onClick={() => signInWithGoogle()}
            className="flex w-full items-center gap-2 hover:bg-adam-blue/10"
            disabled={isSigningInWithGoogle}
          >
            {isSigningInWithGoogle ? (
              <ActivityIndicator label="Starting Google sign in" size="sm" />
            ) : (
              <GoogleIcon className="w-4" />
            )}
            <span>
              {isSigningInWithGoogle
                ? 'Connecting to Google...'
                : 'Continue with Google'}
            </span>
          </Button>

          <form
            onSubmit={mode === 'password' ? handleSignIn : handleMagicLink}
            className="space-y-6"
          >
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/50 dark:text-red-200">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="identifier" className="text-adam-text-primary">
                {mode === 'password' ? 'Username or email' : 'Email'}
              </Label>
              <Input
                id="identifier"
                type={mode === 'password' ? 'text' : 'email'}
                placeholder={
                  mode === 'password'
                    ? 'Enter username or email'
                    : 'Enter your email'
                }
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoComplete={mode === 'password' ? 'username' : 'email'}
                className="border-adam-neutral-700 bg-adam-bg-dark px-4 text-adam-text-primary placeholder:text-adam-text-secondary max-[430px]:text-base"
              />
            </div>

            {mode === 'password' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-adam-text-primary">
                    Password
                  </Label>
                  {identifier.includes('@') && (
                    <Link
                      to="/reset-password"
                      className="text-sm text-adam-blue hover:text-adam-blue/80"
                    >
                      Forgot password?
                    </Link>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="border-adam-neutral-700 bg-adam-bg-dark px-4 text-adam-text-primary placeholder:text-adam-text-secondary max-[430px]:text-base"
                />
              </div>
            )}

            <div className="text-center">
              <button
                type="button"
                className="text-sm text-adam-blue hover:text-adam-blue/80"
                onClick={() => {
                  setMode(mode === 'password' ? 'magiclink' : 'password');
                  setError(null);
                }}
              >
                {mode === 'password'
                  ? 'Sign in with email code instead'
                  : 'Sign in with password instead'}
              </button>
            </div>

            <Button type="submit" className="w-full p-6" disabled={isLoading}>
              {isLoading ? (
                <>
                  <ActivityIndicator
                    label={
                      mode === 'password'
                        ? 'Signing in'
                        : 'Sending sign-in email'
                    }
                    size="sm"
                    className="mr-2"
                  />
                  {mode === 'password' ? 'Signing in...' : 'Sending...'}
                </>
              ) : mode === 'password' ? (
                'Sign In'
              ) : (
                'Send Sign-in Email'
              )}
            </Button>

            {signupAvailable && (
              <div className="text-center text-sm text-adam-text-primary">
                {registration?.bootstrapAvailable
                  ? 'No account exists yet. '
                  : "Don't have an account? "}
                <Link to="/signup" className="text-adam-blue hover:underline">
                  {registration?.bootstrapAvailable
                    ? 'Create administrator'
                    : 'Sign up'}
                </Link>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
