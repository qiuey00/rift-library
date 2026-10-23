import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';

/** A white panel with the app's border and 12px corners: the box screen content sits in. */
export function Panel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel"
      className={cn('rounded-xl border border-border bg-card text-card-foreground', className)}
      {...props}
    />
  );
}
