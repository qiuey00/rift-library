import { Check, Circle, type LucideIcon } from 'lucide-react';
import type { DeckState } from '../../shared/api/common';
import { cn } from '../lib/utils';
import { HalfCircleIcon } from './icons';

export const deckStateLook: Record<DeckState, { word: string; icon: LucideIcon; color: string }> = {
  not_assembled: { word: 'Not assembled', icon: Circle, color: 'text-muted-foreground' },
  partly_assembled: { word: 'Partly assembled', icon: HalfCircleIcon, color: 'text-primary' },
  assembled: { word: 'Assembled', icon: Check, color: 'text-status-in-box' },
};

/** A deck's state as a small white pill: icon and word. */
export function StatePill({ state, className }: { state: DeckState; className?: string }) {
  const { word, icon: Icon, color } = deckStateLook[state];
  return (
    <span
      data-state={state}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-0.5 font-bold text-xs',
        color,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
      {word}
    </span>
  );
}
