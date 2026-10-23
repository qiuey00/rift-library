import { useQuery } from '@tanstack/react-query';
import { History, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { CardCounts, CardDetailsResponse } from '../../shared/api/cards';
import type { Finish, PrintingSummary } from '../../shared/api/common';
import { AddToBuyListDialog } from '../components/AddToBuyListDialog';
import { CardCopiesSection } from '../components/CardCopiesSection';
import { CardDecksSection } from '../components/CardDecksSection';
import { ManaCost } from '../components/ManaCost';
import { Panel } from '../components/Panel';
import { Button } from '../components/ui/button';
import { ApiError, cardDetailsQuery } from '../lib/cards';
import { cn } from '../lib/utils';

const finishWords: Record<Finish, string> = {
  nonfoil: 'Nonfoil',
  foil: 'Foil',
  etched: 'Etched',
};

/** Keyrune colors the four usual rarities; other rarities keep the plain symbol. */
const rarityClasses = new Set(['common', 'uncommon', 'rare', 'mythic']);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One card: its printings, Jeff's copies and the decks that use it (`/cards/:oracleId`). */
export function Card() {
  const oracleId = useParams().oracleId ?? '';
  const details = useQuery(cardDetailsQuery(oracleId));

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-8 pt-8 pb-12">
      {details.data ? (
        <CardTop details={details.data} />
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
          <CardCopiesSection oracleId={oracleId} />
          <CardDecksSection oracleId={oracleId} />
        </>
      )}
    </div>
  );
}

function CardTop({ details }: { details: CardDetailsResponse }) {
  const { card, printings, counts } = details;
  const [buyListOpen, setBuyListOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-start gap-7">
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <h1 className="font-serif text-[48px] leading-none">{card.name}</h1>
            <ManaCost cost={card.manaCost} className="text-lg" />
            <span className="text-base text-muted-foreground">{card.typeLine}</span>
          </div>
          <Counts counts={counts} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setBuyListOpen(true)}>
              <ShoppingCart aria-hidden="true" />
              Add to buy list
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/history?card=${card.oracleId}`}>
                <History aria-hidden="true" />
                History
              </Link>
            </Button>
          </div>
        </header>
        <Printings printings={printings} />
      </div>

      <figure className="flex-[0_0_312px]">
        {card.imageNormal ? (
          // Scryfall's image rules: show the whole card, never cropped or covered.
          <img
            src={card.imageNormal}
            alt={card.name}
            width={488}
            height={680}
            className="aspect-[488/680] h-auto w-full rounded-[4.75%/3.5%] object-contain"
          />
        ) : (
          <div className="flex aspect-[488/680] w-full items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
            No image
          </div>
        )}
      </figure>

      <AddToBuyListDialog
        open={buyListOpen}
        onOpenChange={setBuyListOpen}
        oracleId={card.oracleId}
      />
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

function Printings({ printings }: { printings: PrintingSummary[] }) {
  return (
    <Panel>
      <h2 className="border-border border-b px-4 py-3.5 font-bold text-[17px]">
        Printings <span className="font-normal text-muted-foreground">{printings.length}</span>
      </h2>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-muted-foreground text-xs uppercase tracking-[0.04em]">
            <th className="px-4 py-2.5 font-semibold">Set</th>
            <th className="px-2 py-2.5 font-semibold">Number</th>
            <th className="px-4 py-2.5 font-semibold">Finishes</th>
          </tr>
        </thead>
        <tbody>
          {printings.map((p) => (
            <tr key={p.scryfallId} className="border-[#eceef2] border-t">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2.5">
                  <i
                    aria-hidden="true"
                    className={cn(
                      'ss ss-fw text-lg',
                      `ss-${p.setCode}`,
                      rarityClasses.has(p.rarity) && `ss-${p.rarity}`,
                    )}
                  />
                  <span className="font-semibold">{p.setName}</span>
                  <span className="text-muted-foreground text-xs uppercase">{p.setCode}</span>
                </span>
              </td>
              <td className="px-2 py-2.5 tabular-nums">#{p.collectorNumber}</td>
              <td className="px-4 py-2.5">{p.finishes.map((f) => finishWords[f]).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
