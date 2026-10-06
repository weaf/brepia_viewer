import { cn } from '@/lib/utils';

type ActivityIndicatorProps = {
  className?: string;
  dotClassName?: string;
  label?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
};

const dotSize = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
};

/**
 * Shared indeterminate activity state for Brepia.
 *
 * Use descriptive labels when the operation is known. Determinate progress
 * bars/percentages should remain determinate instead of being replaced by this.
 */
export function ActivityIndicator({
  className,
  dotClassName,
  label = 'Working',
  showLabel = false,
  size = 'md',
}: ActivityIndicatorProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-2', className)}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={showLabel ? undefined : label}
    >
      <span
        aria-hidden="true"
        className={cn(
          'animate-pulse rounded-full bg-adam-blue motion-reduce:animate-none',
          dotSize[size],
          dotClassName,
        )}
      />
      {showLabel && <span>{label}</span>}
    </span>
  );
}
