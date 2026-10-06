import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from '@tanstack/react-router';
import { ActivityIndicator, BrepiaBrand } from '@/components/brand';

export function ResetPasswordView() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { toast } = useToast();
  const { resetPassword } = useAuth();

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await resetPassword(email);
      setIsSuccess(true);
      toast({
        title: 'Success',
        description: 'Password reset instructions have been sent to your email',
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to send reset instructions',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
      <div className="w-full max-w-md">
        <div className="rounded-lg bg-adam-bg-secondary-dark p-8 shadow-md">
          <div className="mb-4 flex flex-col items-center justify-center gap-3">
            <BrepiaBrand showByNoty />
            <h1 className="text-2xl font-semibold text-adam-text-primary">
              Reset Password
            </h1>
          </div>
          {!isSuccess ? (
            <form onSubmit={handleResetPassword} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-adam-text-primary">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="border-adam-neutral-700 bg-adam-bg-dark text-adam-text-primary placeholder:text-adam-text-secondary"
                />
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <ActivityIndicator
                      label="Sending password reset instructions"
                      size="sm"
                      className="mr-2"
                    />
                    Sending instructions...
                  </>
                ) : (
                  'Send Reset Instructions'
                )}
              </Button>

              <Link
                to="/signin"
                className="flex w-full items-center justify-center text-adam-blue hover:text-adam-blue/80"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                <p className="text-sm">Back to Sign In</p>
              </Link>
            </form>
          ) : (
            <div className="space-y-4 text-center">
              <p className="text-green-600 dark:text-green-400">
                Check your email for password reset instructions.
              </p>
              <Link
                to="/signin"
                className="flex w-full items-center justify-center text-adam-blue hover:text-adam-blue/80"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                <p className="text-sm">Back to Sign In</p>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
