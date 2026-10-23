import { and, eq, isNull } from 'drizzle-orm';
import type { ProxyRequest, ProxyResult, PullRequest, PullResult } from '../../shared/api/pulls';
import type { Db } from '../db/database';
import {
  cards,
  copyStacks,
  deckSlots,
  decks,
  locations,
  movementBatches,
  printings,
} from '../db/schema';
import { AppError } from '../errors';
import { addCopies, createBatch, moveCopies, StaleCopyError } from './copies';

// Ticking a pick-list or swap-list line: each action is one database transaction.

/** A live deck with its deck box's name, or a 404. */
function liveDeck(db: Db, deckId: number) {
  const deck = db
    .select({ id: decks.id, name: decks.name, deckBoxId: decks.deckBoxId, boxName: locations.name })
    .from(decks)
    .innerJoin(locations, eq(locations.id, decks.deckBoxId))
    .where(and(eq(decks.id, deckId), isNull(decks.deletedAt)))
    .get();
  if (!deck) throw new AppError(404, 'deck_not_found', 'That deck no longer exists');
  return deck;
}

/** One of the deck's slots, or a 404. */
function deckSlot(db: Db, deckId: number, slotId: number) {
  const slot = db
    .select()
    .from(deckSlots)
    .where(and(eq(deckSlots.id, slotId), eq(deckSlots.deckId, deckId)))
    .get();
  if (!slot) throw new AppError(404, 'slot_not_found', 'That card is no longer in this deck');
  return slot;
}

/** The printing's card, or undefined when the printing is not in the card data. */
function printingCard(db: Db, printingId: string) {
  return db
    .select({ oracleId: cards.oracleId, name: cards.name, lang: printings.lang })
    .from(printings)
    .innerJoin(cards, eq(cards.oracleId, printings.oracleId))
    .where(eq(printings.printingId, printingId))
    .get();
}

/** The 400 for a copy or printing of a different card than the slot's. */
function wrongCard(db: Db, oracleId: string, what: 'copy' | 'printing'): AppError {
  const name = db
    .select({ name: cards.name })
    .from(cards)
    .where(eq(cards.oracleId, oracleId))
    .get()?.name;
  return new AppError(400, 'wrong_card', `That ${what} is not ${name ?? 'this card'}`);
}

/**
 * The batch passed back by the screen, which must belong to this deck, or a new one of the
 * given kind.
 */
function joinOrCreateBatch(
  db: Db,
  deckId: number,
  kind: 'pick_list' | 'swap',
  batchId: number | undefined,
): number {
  if (batchId === undefined) return createBatch(db, kind, { deckId });
  const batch = db
    .select({ deckId: movementBatches.deckId })
    .from(movementBatches)
    .where(eq(movementBatches.id, batchId))
    .get();
  if (batch?.deckId !== deckId) {
    throw new AppError(400, 'batch_not_found', 'That list was for another deck, start it again');
  }
  return batchId;
}

const named = (quantity: number, name: string) => (quantity === 1 ? name : `${quantity} ${name}`);

/** POST /api/decks/:id/pulls. */
export function pullCopies(db: Db, deckId: number, body: PullRequest): PullResult {
  return db.transaction((tx) => {
    const deck = liveDeck(tx, deckId);
    const slot = deckSlot(tx, deckId, body.slotId);
    const stack = tx.select().from(copyStacks).where(eq(copyStacks.id, body.stackId)).get();
    if (!stack || stack.quantity < body.quantity) throw new StaleCopyError();
    const card = printingCard(tx, stack.printingId);
    if (card?.oracleId !== slot.oracleId) throw wrongCard(tx, slot.oracleId, 'copy');
    if (stack.locationId === deck.deckBoxId) {
      throw new AppError(400, 'already_there', `That copy is already in ${deck.boxName}`);
    }

    const otherDeck =
      tx
        .select({ id: decks.id, name: decks.name })
        .from(decks)
        .where(and(eq(decks.deckBoxId, stack.locationId), isNull(decks.deletedAt)))
        .get() ?? null;

    const reason = body.reason ?? 'assembled';
    const kind = reason === 'swapped_in' ? 'swap' : 'pick_list';
    const batchId = joinOrCreateBatch(tx, deckId, kind, body.batchId);
    const { movementId } = moveCopies(tx, stack.id, body.quantity, deck.deckBoxId, {
      reason,
      deckId,
      slotId: slot.id,
      pickedBefore: slot.pickedPrintingId,
      batchId,
    });
    tx.update(deckSlots)
      .set({ pickedPrintingId: stack.printingId })
      .where(eq(deckSlots.id, slot.id))
      .run();

    let message = `Pulled ${named(body.quantity, card.name)} into ${deck.boxName}`;
    if (otherDeck) message += `. ${otherDeck.name} is now partly assembled.`;
    return { message, batchId, movementId, otherDeck };
  });
}

/** POST /api/decks/:id/proxies. A proxy has no came-from location, so it goes to "to sort". */
export function addProxy(db: Db, deckId: number, body: ProxyRequest): ProxyResult {
  return db.transaction((tx) => {
    const deck = liveDeck(tx, deckId);
    const slot = deckSlot(tx, deckId, body.slotId);
    const card = printingCard(tx, body.printingId);
    if (!card) {
      throw new AppError(404, 'printing_not_found', 'That printing is not in the card data');
    }
    if (card.oracleId !== slot.oracleId) throw wrongCard(tx, slot.oracleId, 'printing');

    const batchId = joinOrCreateBatch(tx, deckId, 'pick_list', body.batchId);
    const { movementId } = addCopies(tx, {
      printingId: body.printingId,
      quantity: body.quantity,
      locationId: deck.deckBoxId,
      finish: 'nonfoil',
      condition: 'near_mint',
      language: card.lang,
      misprint: false,
      altered: false,
      isProxy: true,
      reason: 'added',
      deckId,
      slotId: slot.id,
      batchId,
    });
    tx.update(deckSlots)
      .set({ pickedPrintingId: body.printingId })
      .where(eq(deckSlots.id, slot.id))
      .run();

    const what = body.quantity === 1 ? 'a proxy' : `${body.quantity} proxies`;
    return { message: `Added ${what} of ${card.name} to ${deck.boxName}`, batchId, movementId };
  });
}
