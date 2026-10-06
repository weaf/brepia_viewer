import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, BrepiaBrand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { getInstanceIdentity } from '@/services/instanceIdentityService';

type LegalKind = 'terms' | 'privacy';

const COPY: Record<
  LegalKind,
  { title: string; documentLabel: string; description: string }
> = {
  terms: {
    title: 'Terms of Service',
    documentLabel: 'Open configured Terms of Service',
    description:
      'Brepia is distributed as open-source software and does not ship hosted-service terms for every installation.',
  },
  privacy: {
    title: 'Privacy Information',
    documentLabel: 'Open configured Privacy Policy',
    description:
      'Brepia is distributed as open-source software and does not define a single privacy controller for every installation.',
  },
};

export function InstanceLegalNotice({ kind }: { kind: LegalKind }) {
  const { data, isLoading } = useQuery({
    queryKey: ['instance-identity'],
    queryFn: getInstanceIdentity,
    staleTime: 60_000,
  });
  const copy = COPY[kind];
  const configuredUrl = kind === 'terms' ? data?.termsUrl : data?.privacyUrl;
  const publishedUrl = data?.legalPagesEnabled ? configuredUrl : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
      <div className="w-full max-w-2xl rounded-xl border border-adam-neutral-800 bg-adam-bg-secondary-dark p-8 shadow-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrepiaBrand showByNoty className="mb-5" />
          <h1 className="text-3xl font-semibold text-adam-text-primary">
            {copy.title}
          </h1>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <ActivityIndicator label="Loading instance information" />
          </div>
        ) : (
          <div className="space-y-6 text-sm leading-relaxed text-adam-text-secondary">
            <p>{copy.description}</p>

            {publishedUrl ? (
              <div className="rounded-lg border border-adam-neutral-700 bg-adam-background-1 p-5">
                <p className="mb-4">
                  The operator of this installation has configured an external
                  document for this purpose.
                </p>
                <a
                  href={publishedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button>{copy.documentLabel}</Button>
                </a>
              </div>
            ) : (
              <div className="rounded-lg border border-adam-neutral-700 bg-adam-background-1 p-5">
                No {kind === 'terms' ? 'Terms of Service' : 'Privacy Policy'}{' '}
                has been published through this Brepia installation.
              </div>
            )}

            {(data?.operatorName || data?.contactEmail) && (
              <div className="border-t border-adam-neutral-800 pt-5">
                <h2 className="mb-2 font-medium text-adam-text-primary">
                  Instance contact
                </h2>
                {data?.operatorName && <p>{data.operatorName}</p>}
                {data?.contactEmail && (
                  <p>
                    <a
                      href={`mailto:${data.contactEmail}`}
                      className="text-adam-blue hover:underline"
                    >
                      {data.contactEmail}
                    </a>
                  </p>
                )}
              </div>
            )}

            <p className="text-xs text-adam-neutral-400">
              Project licensing and source-code terms are separate from any
              operator-specific terms for a deployed instance.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
