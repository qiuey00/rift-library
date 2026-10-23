import type { ReactNode } from 'react';
import { Panel } from './Panel';

/** A screen that isn't built yet: its title and "Coming soon", plus any parts already in place. */
export function ScreenPlaceholder({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-8 pt-8 pb-12">
      <h1 className="font-serif text-[44px] leading-[1.05]">{title}</h1>
      <Panel className="p-5 text-muted-foreground">Coming soon.</Panel>
      {children}
    </div>
  );
}
