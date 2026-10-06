import { useQuery } from '@tanstack/react-query';
import { getInstanceIdentity } from '@/services/instanceIdentityService';

export function InstanceLegalLinks() {
  const { data } = useQuery({
    queryKey: ['instance-identity'],
    queryFn: getInstanceIdentity,
    staleTime: 60_000,
  });

  if (!data?.legalPagesEnabled) return null;

  const links = [
    data.termsUrl ? { label: 'Terms of Service', href: data.termsUrl } : null,
    data.privacyUrl ? { label: 'Privacy Policy', href: data.privacyUrl } : null,
  ].filter((link): link is { label: string; href: string } => Boolean(link));

  if (links.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-xs text-adam-neutral-300">
      {links.map((link, index) => (
        <div key={link.label} className="flex items-center gap-3">
          {index > 0 && (
            <span aria-hidden className="text-adam-neutral-700">
              •
            </span>
          )}
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-adam-neutral-50"
          >
            {link.label}
          </a>
        </div>
      ))}
    </div>
  );
}
