import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';

import { cn } from '@/lib/utils';

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer relative inline-flex h-10 w-[52px] shrink-0 cursor-pointer items-center rounded-full bg-transparent before:pointer-events-none before:absolute before:left-0 before:top-1/2 before:h-6 before:w-full before:-translate-y-1/2 before:rounded-full before:transition-colors before:duration-200 before:ease-in-out before:[box-shadow:inset_0_0_12px_0_rgba(0,0,0,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:before:bg-adam-blue data-[state=unchecked]:before:bg-adam-neutral-500 data-[state=checked]:hover:before:bg-[#0088CC] data-[state=unchecked]:hover:before:bg-adam-neutral-300 motion-reduce:before:transition-none',
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none absolute left-[2px] top-1/2 z-10 block h-5 w-5 -translate-y-1/2 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ease-in-out data-[state=checked]:translate-x-[28px] data-[state=unchecked]:translate-x-0 motion-reduce:transition-none',
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
