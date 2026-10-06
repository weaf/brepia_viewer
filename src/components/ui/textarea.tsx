import * as React from 'react';

import { cn } from '@/lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows, placeholder, ...props }, ref) => {
    const needsWrappedPlaceholderRoom =
      rows === 1 && typeof placeholder === 'string' && placeholder.length > 0;

    return (
      <textarea
        className={cn(
          'flex min-h-[60px] w-full rounded-md bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
          needsWrappedPlaceholderRoom && 'min-h-16 sm:min-h-10',
        )}
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
