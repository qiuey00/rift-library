import { CircleSlash, Ghost, ShoppingCart, Undo2 } from 'lucide-react';
import { useState } from 'react';
import type { MissingLine } from '../../../shared/api/pick-list';
import { cn } from '../../lib/utils';
import { AddToBuyListDialog } from '../AddToBuyListDialog';
import { Panel } from '../Panel';
import { ProxyTag } from '../ProxyTag';
import { Button } from '../ui/button';

/** Where Add proxy has got to for one missing line. */
export type ProxyState = { status: 'adding' | 'added' | 'removing'; movementId?: number };

/**
 * "Missing": slots no copy anywhere can fill. Each line offers Leave gap (nothing is
 * written; the line stays), Add to buy list and Add proxy.
 */
export function MissingSection({
  lines,
  proxies,
  onAddProxy,
  onRemoveProxy,
}: {
  lines: MissingLine[];
  /** Keyed by slot id. */
  proxies: Record<number, ProxyState>;
  onAddProxy: (line: MissingLine) => void;
  onRemoveProxy: (line: MissingLine) => void;
}) {
  const [gaps, setGaps] = useState<Record<number, boolean>>({});
  const [buying, setBuying] = useState<MissingLine | null>(null);
  const cardCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <section
      aria-label="Missing"
      data-slot="walk-group"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-border border-b bg-[#f6f7f9] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <CircleSlash aria-hidden="true" className="size-5 text-status-missing" />
          <h2 className="m-0 font-bold text-base">Missing</h2>
        </div>
        <span className="font-semibold text-[13px] text-muted-foreground">
          You own no copy of {cardCount === 1 ? 'this' : 'these'}
        </span>
      </div>
      <ul className="m-0 list-none py-1">
        {lines.map((line) => {
          const proxy = proxies[line.slotId];
          const gap = gaps[line.slotId] ?? false;
          return (
            <li
              key={line.slotId}
              data-missing-line={line.slotId}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-[#f0f2f5] border-t px-4 py-2.5 first:border-t-0"
            >
              <div
                className={cn(
                  'flex min-w-0 flex-col gap-0.5',
                  (gap || proxy?.status === 'added') && 'opacity-60',
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-semibold text-[15px]">
                    {line.quantity} {line.card.name}
                  </span>
                  {proxy?.status === 'added' && <ProxyTag />}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {proxy?.status === 'added'
                    ? `Proxy added to the deck box`
                    : gap
                      ? 'Leaving a gap'
                      : line.hint
                        ? `Decklist printing: ${line.hint.publicCode}${line.hint.foil ? ' · Foil' : ''}`
                        : 'Missing'}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {proxy?.status === 'added' || proxy?.status === 'removing' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={proxy.status === 'removing'}
                    onClick={() => onRemoveProxy(line)}
                    aria-label={`Remove the proxy of ${line.card.name}`}
                  >
                    <Undo2 aria-hidden="true" />
                    Remove proxy
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-pressed={gap}
                      onClick={() => setGaps({ ...gaps, [line.slotId]: !gap })}
                    >
                      Leave gap
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setBuying(line)}>
                      <ShoppingCart aria-hidden="true" />
                      Add to buy list
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={proxy?.status === 'adding'}
                      onClick={() => onAddProxy(line)}
                    >
                      <Ghost aria-hidden="true" />
                      {proxy?.status === 'adding' ? 'Adding…' : 'Add proxy'}
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {buying && (
        <AddToBuyListDialog
          open
          onOpenChange={(open) => !open && setBuying(null)}
          cardId={buying.card.id}
          quantity={buying.quantity}
        />
      )}
    </section>
  );
}

/** Runes close the list as one line of counts. They aren't tracked, so ticking is only visual. */
export function RunesLine({ runes }: { runes: { name: string; quantity: number }[] }) {
  const [done, setDone] = useState(false);
  const text = runes.map((rune) => `${rune.quantity} ${rune.name}`).join(', ');
  return (
    <Panel role="region" aria-label="Runes" className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-border border-b bg-[#f6f7f9] px-4 py-3">
        <h2 className="m-0 font-bold text-base">Runes</h2>
        <span className="font-semibold text-[13px] text-muted-foreground">
          Add these from your runes. They are not tracked as copies.
        </span>
      </div>
      <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
        <input
          type="checkbox"
          checked={done}
          onChange={() => setDone(!done)}
          className="m-0 size-5 cursor-pointer accent-status-in-box-fill"
        />
        <span className={cn('font-semibold text-[15px]', done && 'line-through opacity-50')}>
          {text}
        </span>
      </label>
    </Panel>
  );
}
