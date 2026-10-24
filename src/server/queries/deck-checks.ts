import { inArray } from 'drizzle-orm';
import type { Board, CardSummary } from '../../shared/api/common';
import type { DeckCheck } from '../../shared/api/deck-checks';
import type { Db } from '../db/database';
import { cards } from '../db/schema';
import { cardImages, cardSummary } from './card-summaries';

// Riftbound deck checks over a list of slots, so they work for a saved deck and an unsaved
// list alike. Each rule passes or warns, and a warning never blocks anything. The maybe board
// is never checked.

type CardRow = typeof cards.$inferSelect;

/** A card the checks read, with how the API shows it. */
export type CheckCard = { row: CardRow; summary: CardSummary };

/** One card on one board, as the checks take it. */
export type CheckSlot = { cardId: number; board: Board; quantity: number };

/** The cards with these ids, with their images. */
export function loadCards(db: Db, cardIds: number[]): Map<number, CheckCard> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return new Map();
  const images = cardImages(db, ids);
  return new Map(
    db
      .select()
      .from(cards)
      .where(inArray(cards.id, ids))
      .all()
      .map((row) => [row.id, { row, summary: cardSummary(row, images.get(row.id)) }]),
  );
}

/** A check per deck rule for a list of slots (DECK-6), in `DeckCheckCode` order. */
// STUB until #16: Riftbound's deck checks aren't written yet, so there are no checks.
export function checkList(_db: Db, _slots: CheckSlot[]): DeckCheck[] {
  return [];
}
