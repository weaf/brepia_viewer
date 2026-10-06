import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogContent,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNavigate } from '@tanstack/react-router';
import { supabase, ssoProvider } from '@/lib/supabase';
import * as Sentry from '@sentry/react';
import { useToast } from '@/hooks/use-toast';
import { useMutation } from '@tanstack/react-query';
import posthog from 'posthog-js';
import { apiJson } from '@/services/api';

export const DeleteAccountDialog = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [confirmText, setConfirmText] = useState('');
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const { mutate: deleteUser, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      posthog.capture('delete_account_called');
      await apiJson('delete-user', {
        method: 'POST',
      });
    },
    onSuccess: async () => {
      // In SSO mode root is the app's only auth surface, so the deletion
      // flow lands there. Navigate BEFORE the session dies: this dialog
      // lives on a guarded route, and the AuthGuard would otherwise fire
      // the provider redirect and sign the just-deleted user back in.
      if (ssoProvider) {
        await navigate({ to: '/app' });
      }
      // Sign out locally and redirect after deletion
      supabase.auth.signOut();
    },
    onError: (error) => {
      Sentry.captureException(error);
      toast({
        title: 'Delete failed',
        description:
          'We could not delete your account. Please try again or contact support.',
        variant: 'destructive',
      });
    },
  });

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent className="max-w-md rounded-3xl">
        <div className="flex flex-col gap-16">
          <AlertDialogHeader className="text-center sm:text-center">
            <AlertDialogTitle className="w-full">
              Are you sure?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <div className="space-y-4">
            <p>Deleting your account means:</p>
            <div className="rounded-lg bg-adam-neutral-950 p-4 text-adam-neutral-100">
              <ul className="list-disc space-y-2 pl-5 text-sm">
                <li>
                  Deleting your account is permanent and cannot be undone.
                </li>
                <li>
                  Your data will be deleted within 30 days, except we may retain
                  a limited set of data for longer where required or permitted
                  by law.
                </li>
              </ul>
            </div>
          </div>
          <div className="space-y-2">
            <p>
              Type <span className="font-semibold text-red-500">DELETE</span> to
              confirm
            </p>
            <Input
              className="rounded-none border-x-0 border-b border-t-0 border-adam-neutral-200 shadow-none ring-0 focus:border-adam-neutral-200 focus:ring-0"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
            />
          </div>
          <div className="grid w-full grid-cols-2 gap-5">
            <Button
              variant="secondary"
              className="w-full rounded-full"
              onClick={() => {
                setIsOpen(false);
                setConfirmText('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="w-full rounded-full"
              disabled={confirmText !== 'DELETE' || isDeleting}
              onClick={() => deleteUser()}
            >
              DELETE
            </Button>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};
