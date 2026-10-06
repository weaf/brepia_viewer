import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useAppearance } from '@/contexts/AppearanceContext';
import { DeleteAccountDialog } from '@/components/auth/DeleteAccountDialog';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import * as Sentry from '@sentry/react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useProfile, useUpdateProfile } from '@/services/profileService';
import { AvatarUpdateDialog } from '@/components/auth/AvatarUpdateDialog';
import { accountUrl, ssoManaged } from '@/lib/supabase';
import { AiSettingsSection } from '@/components/settings/AiSettingsSection';
import { AdminSettingsSection } from '@/components/settings/AdminSettingsSection';
import { DebugSettingsSection } from '@/components/settings/DebugSettingsSection';
import { InstanceLegalLinks } from '@/components/settings/InstanceLegalLinks';
import { ActivityIndicator } from '@/components/brand';
import { getAccountAccess } from '@/services/accountAdminService';

const lifecycleDiagnosticsEnabled =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_LIFECYCLE_DEBUG === '1';

type SettingsTab = 'account' | 'ai' | 'administration' | 'debug';

const appearanceOptions = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const;

export default function SettingsView() {
  const { user, resetPassword } = useAuth();
  const { appearance, setAppearance } = useAppearance();
  const { data: profile } = useProfile();
  const { data: access } = useQuery({
    queryKey: ['account-access'],
    queryFn: getAccountAccess,
  });
  const { mutate: updateProfile, isPending: isUpdateLoading } =
    useUpdateProfile();
  const { toast } = useToast();
  const [newName, setNewName] = useState(profile?.full_name || '');
  const [editingName, setEditingName] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  useEffect(() => {
    setNewName(profile?.full_name || '');
  }, [profile?.full_name]);

  const handleUpdateName = () => {
    updateProfile(
      { full_name: newName },
      {
        onSuccess: () => {
          setEditingName(false);
          setNewName(profile?.full_name || '');
          toast({
            title: 'Success',
            description: 'Your name has been updated',
          });
        },
        onError: (e) => {
          Sentry.captureException(e);
          toast({
            title: 'Error',
            description: 'Failed to update name',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleUpdateNotifications = async (notificationsEnabled: boolean) => {
    updateProfile(
      { notifications_enabled: notificationsEnabled },
      {
        onSuccess: () =>
          toast({
            title: 'Success',
            description: 'Your notifications have been updated',
          }),
        onError: (e) => {
          Sentry.captureException(e);
          toast({
            title: 'Error',
            description: 'Failed to update notifications',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const { mutate: handleResetPassword, isPending: isResetLoading } =
    useMutation({
      mutationFn: async () => {
        if (!user?.email) throw new Error('User email not found');
        await resetPassword(user.email);
      },
      onSuccess: () =>
        toast({
          title: 'Success',
          description:
            'Password reset instructions have been sent to your email',
        }),
      onError: () =>
        toast({
          title: 'Error',
          description: 'Failed to reset password',
          variant: 'destructive',
        }),
    });

  const localAccount = user?.email?.endsWith('@brepia.invalid') ?? false;
  const isAdmin = access?.role === 'admin';
  const settingsWidth = activeTab === 'account' ? 'max-w-2xl' : 'max-w-5xl';

  return (
    <div className="flex min-h-full w-full min-w-0 items-start justify-center overflow-x-hidden bg-adam-background-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className={`w-full min-w-0 ${settingsWidth}`}>
        <header className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-medium tracking-tight text-adam-neutral-50">
            Settings
          </h1>
          <p className="mt-1 text-sm text-adam-neutral-200">
            Manage your account and preferences.
          </p>
        </header>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SettingsTab)}
          className="w-full min-w-0"
        >
          <div className="sticky top-0 z-20 -mx-2 mb-4 min-w-0 bg-adam-background-1/95 px-2 py-2 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 sm:w-max">
              <TabsTrigger
                value="account"
                className="min-h-10 motion-reduce:transition-none"
              >
                Account
              </TabsTrigger>
              <TabsTrigger
                value="ai"
                className="min-h-10 motion-reduce:transition-none"
              >
                AI
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger
                  value="administration"
                  className="min-h-10 motion-reduce:transition-none"
                >
                  Administration
                </TabsTrigger>
              )}
              {lifecycleDiagnosticsEnabled && (
                <TabsTrigger
                  value="debug"
                  className="min-h-10 motion-reduce:transition-none"
                >
                  Debug
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <TabsContent
            value="account"
            className="mt-0 flex min-w-0 flex-col gap-4"
          >
            <section className="rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-4 sm:p-6">
              <h2 className="mb-5 text-sm font-medium text-adam-neutral-50">
                Account
              </h2>

              {ssoManaged ? (
                <div className="flex flex-col gap-5">
                  <div className="flex items-center gap-3">
                    <AvatarUpdateDialog className="h-10 w-10" />
                    <div className="min-w-0">
                      <div className="truncate text-sm text-adam-neutral-50">
                        {profile?.full_name || user?.email}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-adam-neutral-200">
                        {user?.email}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t border-adam-neutral-800 pt-5">
                    <div className="min-w-0">
                      <div className="text-sm text-adam-neutral-50">
                        Manage account
                      </div>
                      <div className="mt-0.5 text-xs leading-relaxed text-adam-neutral-200">
                        Update your name, email, password, and account details
                        in your account. Brepia avatar icons remain local to
                        this application.
                      </div>
                    </div>
                    <a
                      href={accountUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0"
                    >
                      <Button
                        variant="dark"
                        className="min-h-10 rounded-full font-light"
                      >
                        Manage account
                      </Button>
                    </a>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-adam-neutral-800">
                  <div className="flex items-center justify-between gap-4 pb-5">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <AvatarUpdateDialog />
                      {editingName ? (
                        <Input
                          ref={nameInputRef}
                          value={newName}
                          className="h-10 w-full max-w-xs"
                          onChange={(e) => setNewName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleUpdateName();
                            }
                          }}
                        />
                      ) : (
                        <div className="min-w-0 truncate text-sm text-adam-neutral-50">
                          {profile?.full_name || user?.email}
                        </div>
                      )}
                    </div>
                    {editingName ? (
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <Button
                          onClick={() => handleUpdateName()}
                          variant="light"
                          disabled={isUpdateLoading}
                          className="min-h-10 rounded-full font-light"
                        >
                          {isUpdateLoading ? (
                            <ActivityIndicator label="Saving name" size="sm" />
                          ) : (
                            'Save'
                          )}
                        </Button>
                        <Button
                          onClick={() => {
                            setEditingName(false);
                            setNewName(profile?.full_name || '');
                          }}
                          variant="dark"
                          className="min-h-10 rounded-full font-light"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        onClick={() => setEditingName(true)}
                        variant="dark"
                        className="min-h-10 flex-shrink-0 rounded-full font-light"
                      >
                        Edit
                      </Button>
                    )}
                  </div>

                  <div className="py-5">
                    <div className="text-sm text-adam-neutral-50">
                      {localAccount ? 'Account type' : 'Email'}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-adam-neutral-200">
                      {localAccount
                        ? 'Local username/password account'
                        : user?.email}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-5">
                    <div className="min-w-0">
                      <div className="text-sm text-adam-neutral-50">
                        Password
                      </div>
                      <div className="mt-0.5 text-xs leading-relaxed text-adam-neutral-200">
                        {localAccount
                          ? 'Password is managed by an administrator'
                          : 'Send a reset link to your email'}
                      </div>
                    </div>
                    {!localAccount && (
                      <Button
                        onClick={() => handleResetPassword()}
                        disabled={isResetLoading}
                        variant="dark"
                        className="min-h-10 flex-shrink-0 rounded-full font-light"
                      >
                        {isResetLoading ? (
                          <ActivityIndicator
                            label="Sending password reset"
                            size="sm"
                          />
                        ) : (
                          'Reset Password'
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-4 sm:p-6">
              <h2 className="mb-5 text-sm font-medium text-adam-neutral-50">
                Notifications
              </h2>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div
                    id="notification-responses-label"
                    className="text-sm text-adam-neutral-50"
                  >
                    Responses
                  </div>
                  <div
                    id="notification-responses-description"
                    className="mt-0.5 text-xs leading-relaxed text-adam-neutral-200"
                  >
                    Get notified when Brepia finishes a long-running request.
                  </div>
                </div>
                <Switch
                  className="mt-0.5 motion-reduce:transition-none"
                  checked={profile?.notifications_enabled ?? false}
                  onCheckedChange={handleUpdateNotifications}
                  aria-labelledby="notification-responses-label"
                  aria-describedby="notification-responses-description"
                />
              </div>
            </section>

            <section className="rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-4 sm:p-6">
              <h2 className="text-sm font-medium text-adam-neutral-50">
                Appearance
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-adam-neutral-200">
                Choose how Brepia looks on this device. This does not change the
                3D viewer background brightness.
              </p>
              <div
                className="mt-4 grid grid-cols-3 gap-2"
                role="group"
                aria-label="Application appearance"
              >
                {appearanceOptions.map((option) => {
                  const Icon = option.icon;
                  const selected = appearance === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setAppearance(option.value)}
                      className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue focus-visible:ring-offset-2 focus-visible:ring-offset-adam-background-2 motion-reduce:transition-none ${
                        selected
                          ? 'border-adam-blue bg-adam-neutral-900 text-adam-neutral-50'
                          : 'border-adam-neutral-800 bg-adam-background-1 text-adam-neutral-200 hover:text-adam-neutral-50'
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-adam-neutral-300">
                System follows your operating system and updates automatically.
              </p>
            </section>

            {!ssoManaged && (
              <section className="rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-4 sm:p-6">
                <h2 className="mb-5 text-sm font-medium text-adam-neutral-50">
                  Data and privacy
                </h2>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-adam-neutral-50">
                      Delete account
                    </div>
                    <div className="mt-0.5 text-xs leading-relaxed text-adam-neutral-200">
                      Permanently delete your account and all associated data.
                    </div>
                  </div>
                  <DeleteAccountDialog>
                    <Button
                      className="min-h-10 flex-shrink-0 rounded-full font-light"
                      variant="destructive"
                    >
                      Delete
                    </Button>
                  </DeleteAccountDialog>
                </div>
              </section>
            )}

            <InstanceLegalLinks />
          </TabsContent>

          <TabsContent value="ai" className="mt-0 min-w-0">
            <AiSettingsSection />
          </TabsContent>

          {isAdmin && (
            <TabsContent
              value="administration"
              className="mt-0 flex min-w-0 flex-col gap-4"
            >
              <AdminSettingsSection />
            </TabsContent>
          )}

          {lifecycleDiagnosticsEnabled && (
            <TabsContent value="debug" className="mt-0 min-w-0">
              <DebugSettingsSection />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}
