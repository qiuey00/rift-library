import { useQuery } from '@tanstack/react-query';
import { History, ShoppingCart } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { CardCounts, CardDetailsResponse } from '../../shared/api/cards';
import type { Finish, PrintingSummary } from '../../shared/api/common';
import { AddToBuyListDialog } from '../components/AddToBuyListDialog';
import { CardCopiesSection } from '../components/CardCopiesSection';
import { CardDecksSection } from '../components/CardDecksSection';
import { DomainIcons } from '../components/DomainIcon';
import { Panel } from '../components/Panel';
import { Button } from '../components/ui/button';
import { isPublicCode, typeLine } from '../lib/card-text';
import { ApiError, cardDetailsQuery } from '../lib/cards';
import { cn } from '../lib/utils';

const finishWords: Record<Finish, string> = { normal: 'Normal', foil: 'Foil' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One card: its printings, Jeff's copies and the decks that use it (`/cards/:id`).
 * `?printing=OGN-042` marks the printing with that public code, as a public code search does.
 */
export function Card() {
  const cardId = Number(useParams().id);
  const details = useQuery(cardDetailsQuery(cardId));
  const typedCode = useSearchParams()[0].get('printing');

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-8 pt-8 pb-12">
      {details.data ? (
        <CardTop details={details.data} typedCode={typedCode} />
      ) : details.isError ? (
        <div className="flex flex-col gap-3">
          <h1 className="font-serif text-[44px] leading-[1.05]">
            {details.error instanceof ApiError && details.error.status < 500
              ? 'Card not found'
              : "Couldn't open this card"}
          </h1>
          <Panel className="p-5 text-muted-foreground">
            {details.error instanceof ApiError && details.error.code === 'invalid_request'
              ? "That address isn't a card."
              : details.error.message}
          </Panel>
        </div>
      ) : (
        <p role="status" className="text-muted-foreground">
          Loading the card…
        </p>
      )}
      {details.data && (
        <>
          <CardCopiesSection cardId={cardId} />
          <CardDecksSection cardId={cardId} />
        </>
      )}
    </div>
  );
}

function CardTop({
  details,
  typedCode,
}: {
  details: CardDetailsResponse;
  typedCode: string | null;
}) {
  const { card, printings, counts } = details;
  const [buyListOpen, setBuyListOpen] = useState(false);
  const marked = typedCode ? printings.find((p) => isPublicCode(p.publicCode, typedCode)) : null;
  const imageUrl = marked?.imageUrl ?? card.imageUrl;
  // Battlefields are printed sideways, so they show in landscape.
  const landscape = card.type === 'battlefield';
  const stats: [string, number | null][] = [
    ['Energy', card.energy],
    ['Might', card.might],
    ['Power', card.power],
  ];

  return (
    <div className="flex flex-wrap items-start gap-7">
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <h1 className="font-serif text-[48px] leading-none">{card.name}</h1>
            <DomainIcons domains={card.domains} className="self-center text-xl" />
            <span className="text-base text-muted-foreground">{typeLine(card)}</span>
          </div>
          {stats.some(([, n]) => n !== null) && (
            <dl aria-label="Stats" className="flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
              {stats.map(
                ([label, n]) =>
                  n !== null && (
                    <div key={label} data-stat={label.toLowerCase()} className="flex gap-1.5">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-semibold tabular-nums">{n}</dd>
                    </div>
                  ),
              )}
            </dl>
          )}
          {card.rulesText && (
            <p
              data-testid="rules-text"
              className="max-w-[640px] whitespace-pre-line text-[15px] leading-relaxed"
            >
              {card.rulesText}
            </p>
          )}
          <Counts counts={counts} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setBuyListOpen(true)}>
              <ShoppingCart aria-hidden="true" />
              Add to buy list
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/history?card=${card.id}`}>
                <History aria-hidden="true" />
                History
              </Link>
            </Button>
          </div>
        </header>
        <Printings printings={printings} marked={marked ?? null} />
      </div>

      <figure
        data-orientation={landscape ? 'landscape' : 'portrait'}
        className={landscape ? 'flex-[0_0_436px]' : 'flex-[0_0_312px]'}
      >
        {imageUrl ? (
          // Show the whole card, never cropped or covered.
          <img
            src={imageUrl}
            alt={card.name}
            width={landscape ? 680 : 488}
            height={landscape ? 488 : 680}
            className={cn(
              'h-auto w-full object-contain',
              landscape
                ? 'aspect-[680/488] rounded-[3.5%/4.75%]'
                : 'aspect-[488/680] rounded-[4.75%/3.5%]',
            )}
          />
        ) : (
          <div
            className={cn(
              'flex w-full items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground',
              landscape ? 'aspect-[680/488]' : 'aspect-[488/680]',
            )}
          >
            No image
          </div>
        )}
      </figure>

      <AddToBuyListDialog open={buyListOpen} onOpenChange={setBuyListOpen} cardId={card.id} />
    </div>
  );
}

function Counts({ counts }: { counts: CardCounts }) {
  const owned =
    counts.proxies > 0 ? `Owned, ${plural(counts.proxies, 'proxy', 'proxies')}` : 'Owned';
  const tiles: [string, number, string][] = [
    ['owned', counts.owned, owned],
    ['in-decks', counts.inDecks, 'In deck boxes'],
    ['free', counts.free, 'Free in storage'],
  ];
  return (
    <dl className="flex flex-wrap gap-2.5">
      {tiles.map(([key, n, label]) => (
        <Panel
          key={key}
          data-count={key}
          className="flex min-w-[120px] flex-col-reverse rounded-[10px] px-4 py-2.5"
        >
          <dt className="text-[13px] text-muted-foreground">{label}</dt>
          <dd className="font-bold text-2xl tabular-nums">{n}</dd>
        </Panel>
      ))}
    </dl>
  );
}

/** The small tags a printing can carry, in the order they show. */
const PRINTING_TAGS = [
  ['alternateArt', 'Alternate art'],
  ['overnumbered', 'Overnumbered'],
  ['signature', 'Signature'],
] as const;

function Printings({
  printings,
  marked,
}: {
  printings: PrintingSummary[];
  marked: PrintingSummary | null;
}) {
  const markedRow = useRef<HTMLTableRowElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll once per marked printing
  useEffect(() => markedRow.current?.scrollIntoView({ block: 'nearest' }), [marked?.printingId]);

  return (
    <Panel>
      <h2 className="border-border border-b px-4 py-3.5 font-bold text-[17px]">
        Printings <span className="font-normal text-muted-foreground">{printings.length}</span>
      </h2>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-muted-foreground text-xs uppercase tracking-[0.04em]">
            <th className="px-4 py-2.5 font-semibold">Set</th>
            <th className="px-2 py-2.5 font-semibold">Code</th>
            <th className="px-2 py-2.5 font-semibold">Rarity</th>
            <th className="px-4 py-2.5 font-semibold">Finishes</th>
          </tr>
        </thead>
        <tbody>
          {printings.map((p) => {
            const isMarked = p.printingId === marked?.printingId;
            return (
              <tr
                key={p.printingId}
                ref={isMarked ? markedRow : undefined}
                aria-current={isMarked ? 'true' : undefined}
                className={cn('border-[#eceef2] border-t', isMarked && 'bg-[#eef3fe]')}
              >
                <td className="px-4 py-2.5">
                  <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="font-semibold">{p.setCode}</span>
                    <span className="text-muted-foreground text-xs">{p.setName}</span>
                    {PRINTING_TAGS.map(
                      ([key, label]) =>
                        p[key] && (
                          <span
                            key={key}
                            data-tag={key}
                            className="rounded-full bg-status-free-soft px-2 py-0.5 font-semibold text-[11px] text-status-free"
                          >
                            {label}
                          </span>
                        ),
                    )}
                  </span>
                </td>
                <td className="px-2 py-2.5 tabular-nums">{p.publicCode}</td>
                <td className="px-2 py-2.5 capitalize">{p.rarity}</td>
                <td className="px-4 py-2.5">{p.finishes.map((f) => finishWords[f]).join(', ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
