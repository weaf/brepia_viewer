import { useState, useEffect } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bootstrapFirstAdmin,
  getRegistrationSettings,
} from '@/services/accountAdminService';
import { ActivityIndicator, BrepiaBrand } from '@/components/brand';

function passwordAuthEmail(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  return normalized.includes('@') ? normalized : `${normalized}@brepia.invalid`;
}

export function SignUpEmailView() {
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { signUp, signIn, session, user, isLoading: authLoading } = useAuth();
  const { data: registration, isLoading: policyLoading } = useQuery({
    queryKey: ['registration-settings'],
    queryFn: getRegistrationSettings,
  });

  useEffect(() => {
    if (!authLoading && session && user)
      navigate({ to: '/app', replace: true });
  }, [session, user, authLoading, navigate]);

  const bootstrap = registration?.bootstrapAvailable === true;
  const emailAllowed =
    registration?.allowRegistration === true &&
    (registration.identityPolicy === 'email' ||
      registration.identityPolicy === 'email_or_social');
  const registrationAllowed = bootstrap || emailAllowed;

  useEffect(() => {
    if (!policyLoading && registration && !registrationAllowed) {
      navigate({ to: '/signin', replace: true });
    }
  }, [policyLoading, registration, registrationAllowed, navigate]);

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!registrationAllowed) return;

    const normalizedIdentifier = identifier.trim().toLowerCase();
    if (!normalizedIdentifier) return;
    if (!bootstrap && !normalizedIdentifier.includes('@')) {
      toast({
        title: 'Email required',
        description: 'Normal self registration requires an email address.',
        variant: 'destructive',
      });
      return;
    }
    if (!bootstrap && !name.trim()) return;
    if (password !== confirmPassword) {
      toast({
        title: 'Whoopsies',
        description: 'Passwords do not match',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      if (bootstrap) {
        await bootstrapFirstAdmin({
          identifier: normalizedIdentifier,
          password,
        });
        await queryClient.invalidateQueries({
          queryKey: ['registration-settings'],
        });
        await signIn(passwordAuthEmail(normalizedIdentifier), password);
        toast({ title: 'Administrator account created' });
        navigate({ to: '/app', replace: true });
        return;
      }

      await signUp(normalizedIdentifier, password, name.trim());
      toast({
        title: 'Verify your email',
        description: registration?.requireAdminApproval
          ? 'Verify your email, then an administrator must approve the account.'
          : 'Please check your email to verify your account before signing in.',
      });
      sessionStorage.setItem('pendingSignupEmail', normalizedIdentifier);
      navigate({ to: '/confirm-email' });
    } catch (error) {
      toast({
        title: bootstrap ? 'Could not create administrator' : 'Whoopsies',
        description:
          error instanceof Error
            ? error.message.replace(/_/g, ' ')
            : 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (policyLoading || !registrationAllowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark">
        <ActivityIndicator label="Loading registration policy" size="lg" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
      <div className="w-full max-w-md">
        <div className="rounded-lg bg-adam-bg-secondary-dark p-8 shadow-md">
          <div className="mb-6 flex flex-col items-center justify-center gap-3">
            <BrepiaBrand showByNoty />
            <h1 className="text-2xl font-semibold text-adam-text-primary">
              {bootstrap ? 'Create Administrator' : 'Create Account'}
            </h1>
          </div>

          <form onSubmit={handleSignUp} className="space-y-6">
            {!bootstrap && (
              <div className="space-y-2">
                <Label htmlFor="name" className="text-adam-text-primary">
                  Full Name
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="border-adam-neutral-700 bg-adam-bg-dark px-4 text-adam-text-primary"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="identifier" className="text-adam-text-primary">
                {bootstrap ? 'Username or email' : 'Email'}
              </Label>
              <Input
                id="identifier"
                type={bootstrap ? 'text' : 'email'}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                minLength={bootstrap ? 3 : undefined}
                autoComplete="username"
                className="border-adam-neutral-700 bg-adam-bg-dark px-4 text-adam-text-primary"
              />
              {bootstrap && (
                <p className="text-xs text-adam-text-secondary">
                  A username creates a local Brepia account. An email address
                  creates a normal email/password account.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-adam-text-primary">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="border-adam-neutral-700 bg-adam-bg-dark px-4 text-adam-text-primary"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="confirmPassword"
                className="text-adam-text-primary"
              >
                Confirm Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="border-adam-neutral-700 bg-adam-bg-dark px-4 text-adam-text-primary"
              />
            </div>

            {!bootstrap && registration?.requireAdminApproval && (
              <p className="text-xs text-adam-text-secondary">
                This installation requires administrator approval for new
                accounts.
              </p>
            )}

            <Button type="submit" className="w-full p-6" disabled={isLoading}>
              {isLoading ? (
                <>
                  <ActivityIndicator
                    label={
                      bootstrap
                        ? 'Creating administrator account'
                        : 'Creating account'
                    }
                    size="sm"
                    className="mr-2"
                  />
                  {bootstrap
                    ? 'Creating administrator...'
                    : 'Creating account...'}
                </>
              ) : bootstrap ? (
                'Create Administrator'
              ) : (
                'Create Account'
              )}
            </Button>

            <div className="text-center text-sm text-adam-text-primary">
              <Link to="/signin" className="text-adam-blue hover:underline">
                Back to sign in
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
