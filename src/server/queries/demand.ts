import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { CardDeck, DemandWarning } from '../../shared/api/deck-checks';
import type { DeckRef } from '../../shared/api/decks';
import type { Db } from '../db/database';
import { cards, copyStacks, deckSlots, decks, printings } from '../db/schema';
import { loadCards } from './deck-checks';
import { BOARD_ORDER, deckList } from './decks';

// Deck demand: a card that more decks want than Jeff owns. Demand is the card's slot
// quantities on every board of every live deck but the maybe board; runes never count (D-15). Owned is every copy stack of the card, any printing, proxies included.

/** The demand warnings for these cards, by card id. Cards that aren't short are left out. */
export function demandWarnings(db: Db, cardIds: number[]): Map<number, DemandWarning> {
  const warnings = new Map<number, DemandWarning>();
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return warnings;

  const wanted = new Map<number, { demand: number; decks: Map<number, DeckRef> }>();
  for (const row of db
    .select({
      cardId: deckSlots.cardId,
      quantity: deckSlots.quantity,
      deckId: decks.id,
      deckName: decks.name,
    })
    .from(deckSlots)
    .innerJoin(decks, eq(decks.id, deckSlots.deckId))
    .innerJoin(cards, eq(cards.id, deckSlots.cardId))
    .where(
      and(
        inArray(deckSlots.cardId, ids),
        ne(deckSlots.board, 'maybe'),
        isNull(decks.deletedAt),
        ne(cards.type, 'rune'),
      ),
    )
    .orderBy(decks.id)
    .all()) {
    const entry = wanted.get(row.cardId) ?? { demand: 0, decks: new Map() };
    entry.demand += row.quantity;
    entry.decks.set(row.deckId, { id: row.deckId, name: row.deckName });
    wanted.set(row.cardId, entry);
  }
  if (wanted.size === 0) return warnings;

  const owned = new Map<number, number>();
  for (const stack of db
    .select({ cardId: printings.cardId, quantity: copyStacks.quantity })
    .from(copyStacks)
    .innerJoin(printings, eq(printings.riftcodexId, copyStacks.printingId))
    .where(inArray(printings.cardId, [...wanted.keys()]))
    .all()) {
    owned.set(stack.cardId, (owned.get(stack.cardId) ?? 0) + stack.quantity);
  }

  const short = [...wanted].filter(([cardId, { demand }]) => demand > (owned.get(cardId) ?? 0));
  const cardsById = loadCards(
    db,
    short.map(([cardId]) => cardId),
  );
  for (const [cardId, { demand, decks: wanting }] of short) {
    const card = cardsById.get(cardId);
    if (!card) continue;
    const have = owned.get(cardId) ?? 0;
    const deckList = [...wanting.values()];
    warnings.set(cardId, {
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

/** Such as "3 decks want Ember Volley, you own 2". */
function demandMessage(name: string, deckCount: number, demand: number, owned: number) {
  const who = deckCount === 1 ? '1 deck wants' : `${deckCount} decks want`;
  const what = demand === deckCount ? name : `${demand} copies of ${name}`;
  return `${who} ${what}, you own ${owned}`;
}

/** The live decks with a slot of this card, one row per board, decks by id. */
export function cardDecks(db: Db, cardId: number): CardDeck[] {
  const rows = db
    .select({
      id: decks.id,
      name: decks.name,
      board: deckSlots.board,
      quantity: deckSlots.quantity,
    })
    .from(deckSlots)
    .innerJoin(decks, eq(decks.id, deckSlots.deckId))
    .where(and(eq(deckSlots.cardId, cardId), isNull(decks.deletedAt)))
    .all();
  const states = new Map(deckList(db).map((deck) => [deck.id, deck.state]));
  return rows
    .sort((a, b) => a.id - b.id || BOARD_ORDER[a.board] - BOARD_ORDER[b.board])
    .map((row) => ({ ...row, state: states.get(row.id) ?? 'not_assembled' }));
}
