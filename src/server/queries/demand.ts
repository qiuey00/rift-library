import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Board } from '../../shared/api/common';
import type { CardDeck, DemandWarning } from '../../shared/api/deck-checks';
import type { DeckRef } from '../../shared/api/decks';
import type { Db } from '../db/database';
import { cards, copyStacks, deckSlots, decks, printings } from '../db/schema';
import { loadCards } from './deck-checks';
import { deckList } from './decks';

// Deck demand: a card that more decks want than Jeff owns. Demand is the card's slot
// quantities on the commander and main boards of every live deck; maybe boards and basic
// lands never count. Owned is every copy stack of the card, any printing, proxies included.

/** The demand warnings for these cards, by oracle id. Cards that aren't short are left out. */
export function demandWarnings(db: Db, oracleIds: string[]): Map<string, DemandWarning> {
  const warnings = new Map<string, DemandWarning>();
  const ids = [...new Set(oracleIds)];
  if (ids.length === 0) return warnings;

  const wanted = new Map<string, { demand: number; decks: Map<number, DeckRef> }>();
  for (const row of db
    .select({
      oracleId: deckSlots.oracleId,
      quantity: deckSlots.quantity,
      deckId: decks.id,
      deckName: decks.name,
    })
    .from(deckSlots)
    .innerJoin(decks, eq(decks.id, deckSlots.deckId))
    .innerJoin(cards, eq(cards.oracleId, deckSlots.oracleId))
    .where(
      and(
        inArray(deckSlots.oracleId, ids),
        ne(deckSlots.board, 'maybe'),
        isNull(decks.deletedAt),
        eq(cards.isBasicLand, false),
      ),
    )
    .orderBy(decks.id)
    .all()) {
    const entry = wanted.get(row.oracleId) ?? { demand: 0, decks: new Map() };
    entry.demand += row.quantity;
    entry.decks.set(row.deckId, { id: row.deckId, name: row.deckName });
    wanted.set(row.oracleId, entry);
  }
  if (wanted.size === 0) return warnings;

  const owned = new Map<string, number>();
  for (const stack of db
    .select({ oracleId: printings.oracleId, quantity: copyStacks.quantity })
    .from(copyStacks)
    .innerJoin(printings, eq(printings.scryfallId, copyStacks.scryfallId))
    .where(inArray(printings.oracleId, [...wanted.keys()]))
    .all()) {
    owned.set(stack.oracleId, (owned.get(stack.oracleId) ?? 0) + stack.quantity);
  }

  const short = [...wanted].filter(([oracleId, { demand }]) => demand > (owned.get(oracleId) ?? 0));
  const cardsById = loadCards(
    db,
    short.map(([oracleId]) => oracleId),
  );
  for (const [oracleId, { demand, decks: wanting }] of short) {
    const card = cardsById.get(oracleId);
    if (!card) continue;
    const have = owned.get(oracleId) ?? 0;
    const deckList = [...wanting.values()];
    warnings.set(oracleId, {
      card: card.summary,
      demand,
      owned: have,
      shortage: demand - have,
      decks: deckList,
      message: demandMessage(card.row.name, deckList.length, demand, have),
    });
  }
  return warnings;
}

/** Such as "3 decks want Arcane Signet, you own 2". */
function demandMessage(name: string, deckCount: number, demand: number, owned: number) {
  const who = deckCount === 1 ? '1 deck wants' : `${deckCount} decks want`;
  const what = demand === deckCount ? name : `${demand} copies of ${name}`;
  return `${who} ${what}, you own ${owned}`;
}

/** The live decks with a slot of this card, one row per board, decks by id. */
export function cardDecks(db: Db, oracleId: string): CardDeck[] {
  const rows = db
    .select({
      id: decks.id,
      name: decks.name,
      board: deckSlots.board,
      quantity: deckSlots.quantity,
    })
    .from(deckSlots)
    .innerJoin(decks, eq(decks.id, deckSlots.deckId))
    .where(and(eq(deckSlots.oracleId, oracleId), isNull(decks.deletedAt)))
    .all();
  const states = new Map(deckList(db).map((deck) => [deck.id, deck.state]));
  const order: Record<Board, number> = { commander: 0, main: 1, maybe: 2 };
  return rows
    .sort((a, b) => a.id - b.id || order[a.board] - order[b.board])
    .map((row) => ({ ...row, state: states.get(row.id) ?? 'not_assembled' }));
}
