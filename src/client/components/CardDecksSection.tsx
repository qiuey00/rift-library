import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import type { Board } from '../../shared/api/common';
import type { CardDecks } from '../../shared/api/deck-checks';
import { api } from '../api';
import { Panel } from './Panel';
import { StatePill } from './StatePill';

const boardWord: Record<Board, string> = {
  commander: 'Commander',
  main: 'Main board',
  maybe: 'Maybe board',
};

async function fetchCardDecks(oracleId: string): Promise<CardDecks> {
  const res = await api.cards[':oracleId'].decks.$get({ param: { oracleId } });
  if (!res.ok) {
    throw new Error("Couldn't load the decks using this card.");
  }
  return res.json();
}

/** The card page's list of decks that use a card, with its demand warning when Jeff owns too few. */
export function CardDecksSection({ oracleId }: { oracleId: string }) {
  const query = useQuery({
    queryKey: ['cards', oracleId, 'decks'],
    queryFn: () => fetchCardDecks(oracleId),
  });

  return (
    <Panel role="region" className="flex flex-col gap-1.5 p-5" aria-labelledby="card-decks-title">
      <h2 id="card-decks-title" className="mb-1 font-bold text-base">
        Decks using it
      </h2>
      {query.data?.demand && (
        <div
          role="note"
          className="mb-1 flex items-start gap-2.5 rounded-lg bg-status-other-decks-soft px-3.5 py-3 text-status-other-decks"
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-px size-4.5 flex-none"
            strokeWidth={2.2}
          />
          <strong>{query.data.demand.message}</strong>
        </div>
      )}
      {query.isPending && <p className="text-muted-foreground">Loading decks…</p>}
      {query.isError && <p className="text-status-missing">{query.error.message}</p>}
      {query.data && query.data.decks.length === 0 && (
        <p className="text-muted-foreground">No deck uses this card.</p>
      )}
      {query.data && query.data.decks.length > 0 && (
        <ul className="flex flex-col">
          {query.data.decks.map((deck) => (
            <li
              key={`${deck.id}-${deck.board}`}
              className="flex items-center justify-between gap-3 border-border border-t py-2"
            >
              <span className="flex min-w-0 flex-col">
                <Link to={`/decks/${deck.id}`} className="truncate font-semibold text-primary">
                  {deck.name}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {boardWord[deck.board]} · {deck.quantity}{' '}
                  {deck.quantity === 1 ? 'copy' : 'copies'}
                </span>
              </span>
              <StatePill state={deck.state} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
