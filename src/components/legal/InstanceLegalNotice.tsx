import { BrepiaBrand } from '@/components/brand';

type LegalKind = 'terms' | 'privacy';

const COPY: Record<LegalKind, { title: string; description: string }> = {
  terms: {
    title: 'Terms of Service',
    description:
      'Brepia Viewer is distributed as open-source software and does not ship hosted-service terms for every installation.',
  },
  privacy: {
    title: 'Privacy Information',
    description:
      'Brepia Viewer is distributed as open-source software and does not define a single privacy controller for every installation.',
  },
};

export function InstanceLegalNotice({ kind }: { kind: LegalKind }) {
  const copy = COPY[kind];

  return (
    <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
      <div className="w-full max-w-2xl rounded-xl border border-adam-neutral-800 bg-adam-bg-secondary-dark p-8 shadow-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrepiaBrand showByNoty className="mb-5" />
          <h1 className="text-3xl font-semibold text-adam-text-primary">
            {copy.title}
          </h1>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-adam-text-secondary">
          <p>{copy.description}</p>
          <div className="rounded-lg border border-adam-neutral-700 bg-adam-background-1 p-5">
            No {kind === 'terms' ? 'Terms of Service' : 'Privacy Policy'} has
            been published through this Brepia Viewer installation.
          </div>
          <p className="text-xs text-adam-neutral-400">
            Project licensing and source-code terms are separate from any
            operator-specific terms for a deployed instance.
          </p>
        </div>
      </div>
    </div>
  );
}
