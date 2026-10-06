import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { ActivityIndicator } from '@/components/brand';
import { AdminModelsSettings } from '@/components/settings/AdminModelsSettings';
import { InstanceIdentitySettingsSection } from '@/components/settings/InstanceIdentitySettingsSection';
import {
  createLocalUser,
  deleteAdminUser,
  getAccountAccess,
  getAdminUsers,
  getRegistrationSettings,
  saveRegistrationSettings,
  updateAdminUser,
  type AdminUser,
  type RegistrationSettings,
} from '@/services/accountAdminService';

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return 'Something went wrong';
  return error.message.replace(/_/g, ' ');
}

export function AdminSettingsSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: access } = useQuery({
    queryKey: ['account-access'],
    queryFn: getAccountAccess,
  });

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: getAdminUsers,
    enabled: access?.role === 'admin',
  });

  const { data: registration } = useQuery({
    queryKey: ['registration-settings'],
    queryFn: getRegistrationSettings,
    enabled: access?.role === 'admin',
  });

  const refreshUsers = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  if (access?.role !== 'admin') return null;

  return (
    <section className="rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-6">
      <div className="mb-5">
        <h2 className="text-sm font-medium text-adam-neutral-50">
          Administration
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-adam-neutral-200">
          Manage local accounts, registration, stored conversation models, and
          this Brepia instance identity.
        </p>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="registration">Registration</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="instance-identity">Instance identity</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-5">
          <UsersTab
            users={users}
            loading={usersLoading}
            refreshUsers={refreshUsers}
            toast={toast}
          />
        </TabsContent>

        <TabsContent value="registration" className="mt-5">
          {registration ? (
            <RegistrationTab initial={registration} toast={toast} />
          ) : (
            <div className="flex justify-center py-8">
              <ActivityIndicator label="Loading registration settings" />
            </div>
          )}
        </TabsContent>

        <TabsContent value="models" className="mt-5">
          <AdminModelsSettings />
        </TabsContent>

        <TabsContent value="instance-identity" className="mt-5">
          <InstanceIdentitySettingsSection embedded />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function UsersTab({
  users,
  loading,
  refreshUsers,
  toast,
}: {
  users: AdminUser[];
  loading: boolean;
  refreshUsers: () => Promise<unknown>;
  toast: ReturnType<typeof useToast>['toast'];
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createLocalUser,
    onSuccess: async () => {
      setUsername('');
      setPassword('');
      setFullName('');
      setContactEmail('');
      await refreshUsers();
      toast({ title: 'User created' });
    },
    onError: (error) =>
      toast({
        title: 'Could not create user',
        description: errorMessage(error),
        variant: 'destructive',
      }),
  });

  const statusMutation = useMutation({
    mutationFn: ({
      userId,
      status,
    }: {
      userId: string;
      status: 'active' | 'disabled';
    }) => updateAdminUser({ userId, status }),
    onSuccess: async () => {
      await refreshUsers();
      toast({ title: 'User updated' });
    },
    onError: (error) =>
      toast({
        title: 'Could not update user',
        description: errorMessage(error),
        variant: 'destructive',
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAdminUser,
    onSuccess: async () => {
      await refreshUsers();
      toast({ title: 'User deleted' });
    },
    onError: (error) =>
      toast({
        title: 'Could not delete user',
        description: errorMessage(error),
        variant: 'destructive',
      }),
  });

  return (
    <div className="space-y-6">
      <form
        className="space-y-4 rounded-lg border border-adam-neutral-800 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate({
            username,
            password,
            fullName: fullName || undefined,
            contactEmail: contactEmail || undefined,
          });
        }}
      >
        <div>
          <div className="text-sm font-medium text-adam-neutral-50">
            Add local user
          </div>
          <div className="mt-1 text-xs text-adam-neutral-200">
            Local users sign in with a username and password. Email is optional.
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username">
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              minLength={3}
              maxLength={32}
              autoComplete="off"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Display name">
            <Input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </Field>
          <Field label="Email (optional)">
            <Input
              type="email"
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? (
            <ActivityIndicator label="Creating user" size="sm" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Add user
        </Button>
      </form>

      <div className="space-y-3">
        <div className="text-sm font-medium text-adam-neutral-50">Users</div>
        {loading ? (
          <div className="flex justify-center py-6">
            <ActivityIndicator label="Loading users" />
          </div>
        ) : (
          users.map((user) => (
            <div
              key={user.userId}
              className="rounded-lg border border-adam-neutral-800 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-adam-neutral-50">
                    {user.fullName || user.username || user.email || 'User'}
                  </div>
                  <div className="mt-1 text-xs text-adam-neutral-200">
                    {user.username ? `@${user.username}` : user.email}
                    {' · '}
                    {user.role}
                    {' · '}
                    {user.status}
                  </div>
                  {user.providers.length > 0 && (
                    <div className="mt-1 text-xs text-adam-neutral-300">
                      Identities: {user.providers.join(', ')}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {user.status === 'pending' && (
                    <Button
                      size="sm"
                      onClick={() =>
                        statusMutation.mutate({
                          userId: user.userId,
                          status: 'active',
                        })
                      }
                    >
                      Approve
                    </Button>
                  )}
                  {user.status === 'active' && (
                    <Button
                      size="sm"
                      variant="dark"
                      onClick={() =>
                        statusMutation.mutate({
                          userId: user.userId,
                          status: 'disabled',
                        })
                      }
                    >
                      Disable
                    </Button>
                  )}
                  {user.status === 'disabled' && (
                    <Button
                      size="sm"
                      variant="dark"
                      onClick={() =>
                        statusMutation.mutate({
                          userId: user.userId,
                          status: 'active',
                        })
                      }
                    >
                      Enable
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="dark"
                    onClick={() =>
                      setEditingId(
                        editingId === user.userId ? null : user.userId,
                      )
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    aria-label="Delete user"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete ${user.fullName || user.username || user.email || 'this user'} and all associated data?`,
                        )
                      ) {
                        deleteMutation.mutate(user.userId);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {editingId === user.userId && (
                <UserEditor
                  user={user}
                  onDone={async () => {
                    setEditingId(null);
                    await refreshUsers();
                  }}
                  toast={toast}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function UserEditor({
  user,
  onDone,
  toast,
}: {
  user: AdminUser;
  onDone: () => Promise<unknown>;
  toast: ReturnType<typeof useToast>['toast'];
}) {
  const [username, setUsername] = useState(user.username ?? '');
  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [contactEmail, setContactEmail] = useState(user.contactEmail ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>(user.role);

  const mutation = useMutation({
    mutationFn: () =>
      updateAdminUser({
        userId: user.userId,
        ...(user.localAccount ? { username } : {}),
        fullName,
        contactEmail: contactEmail || null,
        role,
        ...(password ? { password } : {}),
      }),
    onSuccess: async () => {
      await onDone();
      toast({ title: 'User updated' });
    },
    onError: (error) =>
      toast({
        title: 'Could not update user',
        description: errorMessage(error),
        variant: 'destructive',
      }),
  });

  return (
    <form
      className="mt-4 grid gap-3 border-t border-adam-neutral-800 pt-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      {user.localAccount && (
        <Field label="Username">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
      )}
      <Field label="Display name">
        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <Field label="Email (optional)">
        <Input
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
        />
      </Field>
      <Field label="Role">
        <select
          className="h-10 w-full rounded-md border border-adam-neutral-700 bg-adam-background-1 px-3 text-sm text-adam-neutral-50"
          value={role}
          onChange={(event) => setRole(event.target.value as 'admin' | 'user')}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </Field>
      <Field label="New password">
        <Input
          type="password"
          value={password}
          minLength={6}
          placeholder="Leave blank to keep current"
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && (
            <ActivityIndicator label="Saving user changes" size="sm" />
          )}
          Save changes
        </Button>
      </div>
    </form>
  );
}

function RegistrationTab({
  initial,
  toast,
}: {
  initial: RegistrationSettings;
  toast: ReturnType<typeof useToast>['toast'];
}) {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState(initial);

  useEffect(() => setSettings(initial), [initial]);

  const mutation = useMutation({
    mutationFn: () =>
      saveRegistrationSettings({
        allowRegistration: settings.allowRegistration,
        requireAdminApproval: settings.requireAdminApproval,
        identityPolicy: settings.identityPolicy,
        allowedSocialProviders: settings.allowedSocialProviders,
      }),
    onSuccess: async (saved) => {
      setSettings(saved);
      await queryClient.invalidateQueries({
        queryKey: ['registration-settings'],
      });
      toast({ title: 'Registration settings saved' });
    },
    onError: (error) =>
      toast({
        title: 'Could not save registration settings',
        description: errorMessage(error),
        variant: 'destructive',
      }),
  });

  const socialEnabled =
    settings.identityPolicy === 'social' ||
    settings.identityPolicy === 'email_or_social';

  return (
    <div className="space-y-5">
      <SettingSwitch
        title="Allow self registration"
        description="When disabled, only an administrator can create users. A completely empty installation can still create its first administrator."
        checked={settings.allowRegistration}
        onCheckedChange={(allowRegistration) =>
          setSettings((current) => ({ ...current, allowRegistration }))
        }
      />

      <SettingSwitch
        title="Require admin approval"
        description="New registrations remain pending until an administrator approves them."
        checked={settings.requireAdminApproval}
        disabled={!settings.allowRegistration}
        onCheckedChange={(requireAdminApproval) =>
          setSettings((current) => ({ ...current, requireAdminApproval }))
        }
      />

      <div className="border-t border-adam-neutral-800 pt-5">
        <Label htmlFor="registration-identity">Registration identity</Label>
        <p className="mt-1 text-xs text-adam-neutral-200">
          Choose whether new registrations need email, a social identity, or
          either one.
        </p>
        <select
          id="registration-identity"
          className="mt-3 h-10 w-full rounded-md border border-adam-neutral-700 bg-adam-background-1 px-3 text-sm text-adam-neutral-50"
          value={settings.identityPolicy}
          disabled={!settings.allowRegistration}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              identityPolicy: event.target
                .value as RegistrationSettings['identityPolicy'],
            }))
          }
        >
          <option value="email">Email only</option>
          <option value="social">Social identity required</option>
          <option value="email_or_social">Email or social identity</option>
        </select>
      </div>

      {socialEnabled && (
        <div className="border-t border-adam-neutral-800 pt-5">
          <div className="text-sm text-adam-neutral-50">Allowed providers</div>
          <p className="mt-1 text-xs text-adam-neutral-200">
            A provider must also be configured in Supabase before it can be used
            for sign-in.
          </p>
          <ProviderToggle
            label="Google"
            provider="google"
            settings={settings}
            setSettings={setSettings}
          />
          <ProviderToggle
            label="GitHub"
            provider="github"
            settings={settings}
            setSettings={setSettings}
          />
        </div>
      )}

      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending && (
          <ActivityIndicator label="Saving registration policy" size="sm" />
        )}
        Save registration policy
      </Button>
    </div>
  );
}

function ProviderToggle({
  label,
  provider,
  settings,
  setSettings,
}: {
  label: string;
  provider: string;
  settings: RegistrationSettings;
  setSettings: React.Dispatch<React.SetStateAction<RegistrationSettings>>;
}) {
  const checked = settings.allowedSocialProviders.includes(provider);
  return (
    <div className="mt-3 flex items-center justify-between gap-4">
      <span className="text-sm text-adam-neutral-100">{label}</span>
      <Switch
        checked={checked}
        disabled={!settings.allowRegistration}
        onCheckedChange={(enabled) =>
          setSettings((current) => ({
            ...current,
            allowedSocialProviders: enabled
              ? Array.from(
                  new Set([...current.allowedSocialProviders, provider]),
                )
              : current.allowedSocialProviders.filter(
                  (candidate) => candidate !== provider,
                ),
          }))
        }
      />
    </div>
  );
}

function SettingSwitch({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm text-adam-neutral-50">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-adam-neutral-200">
          {description}
        </div>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs text-adam-neutral-200">{label}</span>
      {children}
    </label>
  );
}
