import { useId } from 'react';
import type { SVGProps } from 'react';

import { cn } from '@/lib/utils';

export type BrepiaMarkTone = 'accent' | 'mono';

type BrepiaMarkProps = SVGProps<SVGSVGElement> & {
  tone?: BrepiaMarkTone;
  title?: string;
};

/**
 * Brepia's primary product mark: an open, node-based wireframe solid.
 *
 * Keep this component geometry-only so it can be reused in the sidebar,
 * assistant avatar, auth screens and compact loading treatments. Use
 * `tone="mono"` wherever gradients would reduce legibility.
 */
export function BrepiaMark({
  className,
  tone = 'accent',
  title,
  ...props
}: BrepiaMarkProps) {
  const gradientId = `brepia-mark-${useId().replace(/:/g, '')}`;
  const stroke = tone === 'accent' ? `url(#${gradientId})` : 'currentColor';

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title && <title>{title}</title>}
      {tone === 'accent' && (
        <defs>
          <linearGradient
            id={gradientId}
            x1="10"
            y1="12"
            x2="55"
            y2="55"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#00A6FF" />
            <stop offset="1" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
      )}

      <g
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M32 7 53 19 32 31 11 19 32 7Z" />
        <path d="M11 19v25l21 13V31" />
        <path d="M53 19v16" />
        <path d="M32 57 53 44" />
      </g>

      <g fill={stroke}>
        <circle cx="32" cy="7" r="3" />
        <circle cx="53" cy="19" r="3" />
        <circle cx="11" cy="19" r="3" />
        <circle cx="32" cy="31" r="3" />
        <circle cx="11" cy="44" r="3" />
        <circle cx="32" cy="57" r="3" />
        <circle cx="53" cy="44" r="3" />
      </g>
    </svg>
  );
}
