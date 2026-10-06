import { BrepiaMark } from '@/components/brand';

type Props = {
  showLoadingText?: boolean;
  label?: string;
};

const Loader = ({ showLoadingText = false, label = 'Creating' }: Props) => {
  return (
    <div className="flex flex-col items-center justify-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-adam-neutral-700 bg-adam-neutral-900/70">
        <div className="animate-pulse motion-reduce:animate-none">
          <BrepiaMark title="Brepia" className="h-14 w-14" />
        </div>
      </div>
      {showLoadingText && (
        <div
          className="mt-4 inline-flex items-center gap-2 text-base text-adam-text-primary"
          role="status"
          aria-live="polite"
          aria-label={`${label}…`}
        >
          <span>{label}</span>
          <span
            className="inline-flex items-end gap-1 pb-0.5"
            aria-hidden="true"
          >
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-adam-blue [animation-delay:-300ms] motion-reduce:animate-none" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-adam-blue [animation-delay:-150ms] motion-reduce:animate-none" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-adam-blue motion-reduce:animate-none" />
          </span>
        </div>
      )}
    </div>
  );
};

export default Loader;
