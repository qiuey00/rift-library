import { and, eq, isNull } from 'drizzle-orm';
import type { BuyItemChange, NewBuyItem } from '../../shared/api/buy-list';
import type { Db } from '../db/database';
import { buyListItems, cards, printings } from '../db/schema';
import { AppError } from '../errors';

// The one buy list. Only Jeff adds to it, through these actions: nothing else in the app
// writes to buy_list_items, so deck shortages never add cards on their own.

/**
 * Adds cards to the buy list in one transaction. The same card and printing again (no
 * printing counts as its own "any printing") raises that item's quantity, and a new
 * non-empty note replaces the old one. Returns each item's id, in the order given.
 */
export function addToBuyList(db: Db, items: NewBuyItem[]): number[] {
  return db.transaction((tx) => items.map((item) => addOne(tx, item)));
}

function addOne(db: Db, item: NewBuyItem): number {
  const card = db.select().from(cards).where(eq(cards.oracleId, item.oracleId)).get();
  if (!card) {
    throw new AppError(400, 'card_not_found', "That card isn't in the card data.");
  }
  const scryfallId = item.scryfallId ?? null;
  if (scryfallId !== null) {
    const printing = db.select().from(printings).where(eq(printings.scryfallId, scryfallId)).get();
    if (!printing || printing.oracleId !== item.oracleId) {
      throw new AppError(
        400,
        'printing_not_found',
        `That printing isn't a printing of ${card.name}. Pick another, or any printing.`,
      );
    }
  }
  const note = item.note?.trim() ? item.note : undefined;

  const existing = db
    .select()
    .from(buyListItems)
    .where(
      and(
        eq(buyListItems.oracleId, item.oracleId),
        scryfallId === null
          ? isNull(buyListItems.scryfallId)
          : eq(buyListItems.scryfallId, scryfallId),
      ),
    )
    .get();
  if (existing) {
    db.update(buyListItems)
      .set({ quantity: existing.quantity + item.quantity, ...(note ? { note } : {}) })
      .where(eq(buyListItems.id, existing.id))
      .run();
    return existing.id;
  }
  const added = db
    .insert(buyListItems)
    .values({ oracleId: item.oracleId, scryfallId, quantity: item.quantity, note: note ?? '' })
    .returning({ id: buyListItems.id })
    .get();
  return added.id;
}

/** Changes an item's quantity, note or both. An empty note clears it. */
export function changeBuyItem(db: Db, id: number, change: BuyItemChange) {
  db.transaction((tx) => {
    findItem(tx, id);
    tx.update(buyListItems)
      .set({
        ...(change.quantity !== undefined ? { quantity: change.quantity } : {}),
        ...(change.note !== undefined ? { note: change.note } : {}),
      })
      .where(eq(buyListItems.id, id))
      .run();
  });
}

/** Takes an item off the buy list. */
export function removeBuyItem(db: Db, id: number) {
  db.transaction((tx) => {
    findItem(tx, id);
    tx.delete(buyListItems).where(eq(buyListItems.id, id)).run();
  });
}

function findItem(db: Db, id: number) {
  const item = db.select().from(buyListItems).where(eq(buyListItems.id, id)).get();
  if (!item) {
    throw new AppError(
      404,
      'buy_item_not_found',
      'That card is no longer on the buy list. Refresh to see the list as it is now.',
    );
  }
  return item;
}
