import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ActivityIndicator, BrepiaBrand } from '@/components/brand';

export function UpdatePasswordView() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { toast } = useToast();
  const { updatePassword } = useAuth();
  const navigate = useNavigate();

  const { mutate: handleUpdatePassword, isPending: isUpdatingPassword } =
    useMutation({
      mutationFn: updatePassword,
      onSuccess: () => {
        toast({
          title: 'Success',
          description: 'Password updated successfully',
        });
        navigate({ to: '/app' });
      },
      onError: () => {
        toast({
          title: 'Error',
          description: 'Failed to update password',
          variant: 'destructive',
        });
      },
    });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({
        title: 'Error',
        description: 'Passwords do not match',
        variant: 'destructive',
      });
      return;
    }
    handleUpdatePassword(password);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
      <div className="w-full max-w-md">
        <div className="rounded-lg bg-adam-bg-secondary-dark p-8 shadow-md">
          <div className="mb-4 flex flex-col items-center justify-center gap-3">
            <BrepiaBrand showByNoty />
            <h1 className="text-2xl font-semibold text-adam-text-primary">
              Update Password
            </h1>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-adam-text-primary">
                New Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-adam-neutral-700 bg-adam-bg-dark text-adam-text-primary placeholder:text-adam-text-secondary"
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
                placeholder="Confirm your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="border-adam-neutral-700 bg-adam-bg-dark text-adam-text-primary placeholder:text-adam-text-secondary"
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isUpdatingPassword}
            >
              {isUpdatingPassword ? (
                <>
                  <ActivityIndicator
                    label="Updating password"
                    size="sm"
                    className="mr-2"
                  />
                  Updating password...
                </>
              ) : (
                'Update Password'
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
