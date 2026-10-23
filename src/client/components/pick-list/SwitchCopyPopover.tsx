import { Check, Repeat2 } from 'lucide-react';
import { useState } from 'react';
import type { StackRow } from '../../../shared/api/common';
import { cn } from '../../lib/utils';
import { LocationTile } from '../LocationTile';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { CopyLabel, TagChip } from '../walk-list';
import { walkCopy } from './walk-copy';

/**
 * Switch copy on a pick-list line: the suggested copy and every alternative with where it
 * is. Picking one changes which copy stack the tick pulls from.
 */
export function SwitchCopyPopover({
  cardName,
  quantity,
  copies,
  chosenStackId,
  onChoose,
}: {
  cardName: string;
  /** How many the line pulls; a stack holding fewer can't fill it. */
  quantity: number;
  /** The suggested copy first, then the alternatives. */
  copies: StackRow[];
  chosenStackId: number;
  onChoose: (stack: StackRow) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Switch copy of ${cardName}`}>
          <Repeat2 aria-hidden="true" />
          Switch copy
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-1.5">
        <div role="menu" aria-label={`Copies of ${cardName}`} className="flex flex-col">
          {copies.map((stack) => {
            const chosen = stack.stackId === chosenStackId;
            const tooFew = stack.quantity < quantity;
            return (
              <button
                key={stack.stackId}
                type="button"
                role="menuitemradio"
                aria-checked={chosen}
                disabled={tooFew}
                onClick={() => {
                  onChoose(stack);
                  setOpen(false);
                }}
                className={cn(
                  'grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50 disabled:hover:bg-transparent',
                )}
              >
                <Check
                  aria-hidden="true"
                  className={cn('mt-0.5 size-4 text-primary', !chosen && 'invisible')}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-semibold">
                    <LocationTile type={stack.location.type} color={stack.location.color} />
                    <span className="truncate">{stack.location.path}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                    <CopyLabel copy={walkCopy(stack)} />
                    {stack.location.forTrade && (
                      <TagChip tag={{ text: 'From trade binder', tone: 'trade' }} />
                    )}
                  </span>
                  {tooFew && (
                    <span className="text-[13px] text-muted-foreground">
                      Only {stack.quantity} here
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
