import { count, getTableColumns, notInArray, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '../db/database';
import {
  buyListItems,
  cardDataStatus,
  cards,
  copyStacks,
  deckSlots,
  printings,
} from '../db/schema';
import type { CardGroup } from './records';

// Writes synced cards and printings into the database in one transaction, so the app never
// shows a half-synced list. A sync adds and updates rows; it removes a printing Riftcodex no
// longer lists only when nothing in the collection, a deck or the buy list points at it.

/** Updates these columns from the new row; everything else, such as prices, is kept. */
function fromNew(columns: Record<string, SQLiteColumn>) {
  return Object.fromEntries(
    Object.entries(columns).map(([key, column]) => [key, sql.raw(`excluded."${column.name}"`)]),
  );
}

const { id: _cardId, ...cardColumns } = getTableColumns(cards);
const {
  riftcodexId: _riftcodexId,
  finishes: _finishes,
  priceNormal: _priceNormal,
  priceFoil: _priceFoil,
  ...printingColumns
} = getTableColumns(printings);

export interface WriteResult {
  cardCount: number;
  printingCount: number;
  /** Printings Riftcodex no longer lists, kept because something points at them. */
  keptPrintings: number;
  /** The id of each card written, by name key. */
  cardIds: Map<string, number>;
}

/**
 * Writes every group: cards matched by name key, printings by Riftcodex id. With `full` (a
 * whole sync), printings missing from the groups are removed unless a copy stack, slot or buy
 * list item points at them, cards left with no printings go the same way, and the status row
 * records `syncedAt`. Without it (a lookup of a few names), nothing is removed.
 */
export function writeCardData(
  db: Db,
  groups: CardGroup[],
  { full, syncedAt }: { full: boolean; syncedAt?: string },
): WriteResult {
  return db.transaction((tx) => {
    const seen: string[] = [];
    const cardIds = new Map<string, number>();
    for (const group of groups) {
      const { id: cardId } = tx
        .insert(cards)
        .values(group.card)
        .onConflictDoUpdate({ target: cards.nameKey, set: fromNew(cardColumns) })
        .returning({ id: cards.id })
        .get();
      cardIds.set(group.card.nameKey, cardId);
      for (const printing of group.printings) {
        tx.insert(printings)
          .values({ ...printing, cardId })
          .onConflictDoUpdate({ target: printings.riftcodexId, set: fromNew(printingColumns) })
          .run();
        seen.push(printing.riftcodexId);
      }
    }

    let keptPrintings = 0;
    if (full) {
      const referenced = sql`(
        SELECT ${copyStacks.printingId} FROM ${copyStacks}
        UNION SELECT ${deckSlots.pickedPrintingId} FROM ${deckSlots} WHERE ${deckSlots.pickedPrintingId} IS NOT NULL
        UNION SELECT ${buyListItems.printingId} FROM ${buyListItems} WHERE ${buyListItems.printingId} IS NOT NULL
      )`;
      const dropped = notInArray(printings.riftcodexId, seen.length > 0 ? seen : ['']);
      tx.delete(printings)
        .where(sql`${dropped} AND ${printings.riftcodexId} NOT IN ${referenced}`)
        .run();
      keptPrintings = tx.select({ n: count() }).from(printings).where(dropped).get()?.n ?? 0;
      tx.delete(cards)
        .where(
          sql`${cards.id} NOT IN (SELECT ${printings.cardId} FROM ${printings})
            AND ${cards.id} NOT IN (SELECT ${deckSlots.cardId} FROM ${deckSlots})
            AND ${cards.id} NOT IN (SELECT ${buyListItems.cardId} FROM ${buyListItems})`,
        )
        .run();
    }

    const cardCount = tx.select({ n: count() }).from(cards).get()?.n ?? 0;
    const printingCount = tx.select({ n: count() }).from(printings).get()?.n ?? 0;
    const status = { cardCount, printingCount, ...(syncedAt ? { cardsSyncedAt: syncedAt } : {}) };
    tx.insert(cardDataStatus)
      .values({ id: 1, ...status })
      .onConflictDoUpdate({ target: cardDataStatus.id, set: status })
      .run();
    return { cardCount, printingCount, keptPrintings, cardIds };
  });
}
