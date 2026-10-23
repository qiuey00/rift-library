import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { CardDetailsResponse, CardSearchResponse } from '../../../shared/api/cards';
import type { CardSummary } from '../../../shared/api/common';
import type { UnknownRow } from '../../../shared/api/manabox';
import { api } from '../../api';
import { cn } from '../../lib/utils';
import { printingLabel } from '../AddToBuyListDialog';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { ImportError, type RowFix } from './draft';

async function answer<T>(response: { ok: boolean; json(): Promise<unknown> }): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new ImportError('request_failed', message ?? 'Something went wrong. Try again.');
  }
  return body as T;
}

/** Waits until `value` has stopped changing for `delay` ms. */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** Fixes an unknown row: search for its card, then pick the printing Jeff has. */
export function FixRowDialog({
  row,
  onClose,
  onPick,
}: {
  row: UnknownRow | null;
  onClose: () => void;
  onPick: (fix: RowFix) => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-popover sm:max-w-xl">
        {/* Mounted only while open, so each row starts with its own name. */}
        {row && <FixRow row={row} onPick={onPick} />}
      </DialogContent>
    </Dialog>
  );
}

function FixRow({ row, onPick }: { row: UnknownRow; onPick: (fix: RowFix) => void }) {
  const [card, setCard] = useState<CardSummary | null>(null);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Fix row {row.row}</DialogTitle>
        <DialogDescription>
          The file says {row.quantity} × {row.name} ({row.setCode.toUpperCase()} #
          {row.collectorNumber}).{' '}
          {card ? 'Pick the printing you have.' : 'Search for the card this row means.'}
        </DialogDescription>
      </DialogHeader>
      {card ? (
        <PrintingList row={row} card={card} onBack={() => setCard(null)} onPick={onPick} />
      ) : (
        <CardResults initialQuery={row.name} onPick={setCard} />
      )}
    </>
  );
}

function CardResults({
  initialQuery,
  onPick,
}: {
  initialQuery: string;
  onPick: (card: CardSummary) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const q = useDebounced(query.trim(), 250);
  const search = useQuery({
    queryKey: ['cards', 'search', q],
    queryFn: async () => answer<CardSearchResponse>(await api.cards.search.$get({ query: { q } })),
    enabled: q !== '',
  });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex h-10 items-center gap-2 rounded-lg border border-input bg-card px-3 focus-within:border-ring">
        <Search aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="sr-only">Card name</span>
        <input
          type="search"
          // biome-ignore lint/a11y/noAutofocus: the dialog opens to type a name
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Card name"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </label>
      {search.error ? (
        <p className="text-[13px] text-destructive">{search.error.message}</p>
      ) : search.data && search.data.results.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No cards match “{q}”.</p>
      ) : (
        <ul aria-label="Cards" className="flex max-h-[360px] flex-col gap-1 overflow-y-auto">
          {(search.data?.results ?? []).map((card) => (
            <li key={card.oracleId}>
              <PickButton image={card.imageSmall} onClick={() => onPick(card)}>
                <span className="font-semibold">{card.name}</span>
                <span className="text-muted-foreground text-xs">{card.typeLine}</span>
              </PickButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PrintingList({
  row,
  card,
  onBack,
  onPick,
}: {
  row: UnknownRow;
  card: CardSummary;
  onBack: () => void;
  onPick: (fix: RowFix) => void;
}) {
  const details = useQuery({
    queryKey: ['cards', card.oracleId],
    queryFn: async () =>
      answer<CardDetailsResponse>(
        await api.cards[':oracleId'].$get({ param: { oracleId: card.oracleId } }),
      ),
  });
  // The printing the file names, when the card has it, is the likely one.
  const sameSet = (setCode: string, collectorNumber: string) =>
    setCode.toLowerCase() === row.setCode.toLowerCase() && collectorNumber === row.collectorNumber;

  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" size="sm" className="w-fit" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
        {card.name}
      </Button>
      {details.isPending ? (
        <p className="text-[13px] text-muted-foreground">Loading printings…</p>
      ) : details.isError ? (
        <p className="text-[13px] text-destructive">{details.error.message}</p>
      ) : (
        <ul aria-label="Printings" className="flex max-h-[360px] flex-col gap-1 overflow-y-auto">
          {details.data.printings.map((printing) => (
            <li key={printing.scryfallId}>
              <PickButton
                image={printing.imageSmall}
                highlighted={sameSet(printing.setCode, printing.collectorNumber)}
                onClick={() =>
                  onPick({
                    scryfallId: printing.scryfallId,
                    label: `${card.name}, ${printingLabel(printing)}`,
                  })
                }
              >
                <span className="font-semibold">{printingLabel(printing)}</span>
                <span className="text-muted-foreground text-xs">
                  {printing.lang.toUpperCase()} · {printing.rarity} · {printing.finishes.join(', ')}
                </span>
              </PickButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PickButton({
  image,
  highlighted = false,
  onClick,
  children,
}: {
  image: string | null;
  highlighted?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
        highlighted && 'bg-[#f3f6fe]',
      )}
    >
      {image ? (
        <img src={image} alt="" className="h-[42px] w-[30px] shrink-0 rounded-[5%] bg-[#15161a]" />
      ) : (
        <span aria-hidden="true" className="h-[42px] w-[30px] shrink-0 rounded-[5%] bg-[#15161a]" />
      )}
      <span className="flex min-w-0 flex-col">{children}</span>
    </button>
  );
}
