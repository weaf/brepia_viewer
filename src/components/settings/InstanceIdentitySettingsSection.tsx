import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { getAccountAccess } from '@/services/accountAdminService';
import {
  DEFAULT_INSTANCE_IDENTITY,
  getInstanceIdentity,
  saveInstanceIdentity,
  type InstanceIdentity,
} from '@/services/instanceIdentityService';

export function InstanceIdentitySettingsSection({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const { data: access } = useQuery({
    queryKey: ['account-access'],
    queryFn: getAccountAccess,
  });
  const { data, isLoading, isError } = useQuery({
    queryKey: ['instance-identity'],
    queryFn: getInstanceIdentity,
    enabled: access?.role === 'admin',
  });

  if (access?.role !== 'admin') return null;

  return (
    <section
      className={
        embedded
          ? 'min-w-0'
          : 'rounded-xl border border-adam-neutral-800 bg-adam-background-2 p-6'
      }
    >
      <div className="mb-5">
        <h2 className="text-sm font-medium text-adam-neutral-50">
          Instance identity
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-adam-neutral-200">
          Optional public identity for this Brepia installation. A fresh
          open-source installation exposes no operator, contact, community,
          social or legal-service links until an administrator configures them.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <ActivityIndicator label="Loading instance identity" />
        </div>
      ) : isError ? (
        <div className="border-adam-red-400/30 bg-adam-red-400/5 text-adam-red-300 rounded-lg border p-4 text-sm">
          Could not load instance identity settings. Make sure the latest
          Supabase migration has been applied.
        </div>
      ) : (
        <InstanceIdentityForm initial={data ?? DEFAULT_INSTANCE_IDENTITY} />
      )}
    </section>
  );
}

function InstanceIdentityForm({ initial }: { initial: InstanceIdentity }) {
  const [settings, setSettings] = useState(initial);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => setSettings(initial), [initial]);

  const mutation = useMutation({
    mutationFn: () => saveInstanceIdentity(settings),
    onSuccess: async (saved) => {
      setSettings(saved);
      queryClient.setQueryData(['instance-identity'], saved);
      await queryClient.invalidateQueries({ queryKey: ['instance-identity'] });
      toast({ title: 'Instance identity saved' });
    },
    onError: (error) =>
      toast({
        title: 'Could not save instance identity',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      }),
  });

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Operator / organization"
          description="Optional name of whoever operates this installation."
        >
          <Input
            value={settings.operatorName ?? ''}
            maxLength={200}
            placeholder="Example AB"
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                operatorName: event.target.value || null,
              }))
            }
          />
        </Field>

        <Field
          label="Public contact email"
          description="Shown only on public instance/legal information surfaces."
        >
          <Input
            type="email"
            value={settings.contactEmail ?? ''}
            placeholder="contact@example.com"
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                contactEmail: event.target.value || null,
              }))
            }
          />
        </Field>
      </div>

      <div className="space-y-4 border-t border-adam-neutral-800 pt-5">
        <SettingSwitch
          title="Show community link"
          description="Expose a generic community/forum link in Brepia navigation. No link is shown by default."
          checked={settings.showCommunityLink}
          onCheckedChange={(showCommunityLink) =>
            setSettings((current) => ({ ...current, showCommunityLink }))
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Community label"
            description="For example Community, Forum or Matrix."
          >
            <Input
              value={settings.communityLabel}
              maxLength={40}
              disabled={!settings.showCommunityLink}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  communityLabel: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Community URL" description="HTTP or HTTPS URL.">
            <Input
              type="url"
              value={settings.communityUrl ?? ''}
              placeholder="https://..."
              disabled={!settings.showCommunityLink}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  communityUrl: event.target.value || null,
                }))
              }
            />
          </Field>
        </div>
      </div>

      <div className="space-y-4 border-t border-adam-neutral-800 pt-5">
        <div>
          <div className="text-sm text-adam-neutral-50">Social links</div>
          <div className="mt-0.5 text-xs leading-relaxed text-adam-neutral-200">
            Optional deployment-owned social links. A configured link appears in
            Brepia navigation; leaving it blank keeps it hidden.
          </div>
        </div>
        <Field
          label="Discord URL"
          description="Optional Discord server or invite URL."
        >
          <Input
            type="url"
            value={settings.discordUrl ?? ''}
            placeholder="https://discord.gg/..."
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                discordUrl: event.target.value || null,
              }))
            }
          />
        </Field>
      </div>

      <div className="space-y-4 border-t border-adam-neutral-800 pt-5">
        <SettingSwitch
          title="Show legal links"
          description="Expose operator-provided Terms and/or Privacy links. Brepia does not ship hosted-service terms by default."
          checked={settings.legalPagesEnabled}
          onCheckedChange={(legalPagesEnabled) =>
            setSettings((current) => ({ ...current, legalPagesEnabled }))
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Terms URL"
            description="Optional external Terms of Service document."
          >
            <Input
              type="url"
              value={settings.termsUrl ?? ''}
              placeholder="https://..."
              disabled={!settings.legalPagesEnabled}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  termsUrl: event.target.value || null,
                }))
              }
            />
          </Field>
          <Field
            label="Privacy URL"
            description="Optional external privacy document."
          >
            <Input
              type="url"
              value={settings.privacyUrl ?? ''}
              placeholder="https://..."
              disabled={!settings.legalPagesEnabled}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  privacyUrl: event.target.value || null,
                }))
              }
            />
          </Field>
        </div>
      </div>

      <div className="flex justify-end border-t border-adam-neutral-800 pt-5">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && (
            <ActivityIndicator
              className="mr-2"
              label="Saving instance identity"
              size="sm"
            />
          )}
          Save instance identity
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {description && (
        <p className="mb-2 mt-1 text-xs leading-relaxed text-adam-neutral-300">
          {description}
        </p>
      )}
      {children}
    </div>
  );
}

function SettingSwitch({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-adam-neutral-50">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-adam-neutral-200">
          {description}
        </div>
      </div>
      <Switch
        className="mt-0.5 shrink-0"
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
