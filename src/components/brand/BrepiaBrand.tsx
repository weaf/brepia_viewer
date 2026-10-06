import { cn } from '@/lib/utils';
import { BrepiaMark, type BrepiaMarkTone } from './BrepiaMark';

type BrepiaBrandProps = {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
  tone?: BrepiaMarkTone;
  showByNoty?: boolean;
};

/** Shared Brepia symbol + wordmark lockup for product-facing UI surfaces. */
export function BrepiaBrand({
  className,
  markClassName,
  wordmarkClassName,
  tone = 'accent',
  showByNoty = false,
}: BrepiaBrandProps) {
  return (
    <div className={cn('inline-flex items-center gap-3', className)}>
      <BrepiaMark tone={tone} className={cn('h-8 w-8', markClassName)} />
      <div className="flex min-w-0 flex-col">
        <span
          className={cn(
            'whitespace-nowrap text-base font-semibold uppercase leading-none tracking-[0.18em] text-adam-text-primary',
            wordmarkClassName,
          )}
        >
          Brepia
        </span>
        {showByNoty && (
          <span className="mt-1 whitespace-nowrap text-[10px] font-medium tracking-[0.16em] text-adam-text-tertiary">
            by Noty
          </span>
        )}
      </div>
    </div>
  );
}
