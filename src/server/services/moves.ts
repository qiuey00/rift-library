import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ActionResult } from '../../shared/api/common';
import type { AddCopiesBody, MoveContentsBody, MoveCopiesBody } from '../../shared/api/copies';
import type { Db } from '../db/database';
import { cards, copyStacks, decks, locations, printings } from '../db/schema';
import { AppError } from '../errors';
import { descendantIds, treeOrder } from '../queries/locations';
import {
  addCopies,
  createBatch,
  moveCopies,
  printingExists,
  StaleCopyError,
  setProxy,
} from './copies';

// The copies area's actions: each one database transaction answering with an `ActionResult`.

/** A live location, or a 404. */
function liveLocation(db: Db, id: number) {
  const location = db
    .select({ id: locations.id, name: locations.name, type: locations.type })
    .from(locations)
    .where(and(eq(locations.id, id), isNull(locations.deletedAt)))
    .get();
  if (!location) {
    throw new AppError(404, 'location_not_found', 'That location no longer exists');
  }
  return location;
}

/** The deck whose deck box this is, if any. */
function deckOfBox(db: Db, locationId: number): number | undefined {
  return db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.deckBoxId, locationId), isNull(decks.deletedAt)))
    .get()?.id;
}

function cardName(db: Db, scryfallId: string): string {
  return (
    db
      .select({ name: cards.name })
      .from(printings)
      .innerJoin(cards, eq(cards.oracleId, printings.oracleId))
      .where(eq(printings.scryfallId, scryfallId))
      .get()?.name ?? 'card'
  );
}

/**
 * "Arcane Signet" for one copy, "3 Arcane Signet" for copies of one card, "12 cards"
 * otherwise.
 */
export function describeCopies(db: Db, moved: { scryfallId: string; quantity: number }[]): string {
  const total = moved.reduce((sum, m) => sum + m.quantity, 0);
  const names = new Set(moved.map((m) => cardName(db, m.scryfallId)));
  if (names.size === 1) {
    const [name] = names;
    return total === 1 ? name : `${total} ${name}`;
  }
  return `${total} cards`;
}

type StackMove = { stack: typeof copyStacks.$inferSelect; quantity: number };

/** Moves each stack's copies to the location in one batch of kind `move`. */
function moveInBatch(db: Db, moving: StackMove[], toLocationId: number) {
  const toDeck = deckOfBox(db, toLocationId);
  const batchId = createBatch(db, 'move', { deckId: toDeck });
  for (const { stack, quantity } of moving) {
    const deckId = toDeck ?? deckOfBox(db, stack.locationId);
    moveCopies(db, stack.id, quantity, toLocationId, { reason: 'moved', batchId, deckId });
  }
  return batchId;
}

/** POST /api/moves. Stacks already in the location stay put. */
export function moveStacks(db: Db, body: MoveCopiesBody): ActionResult {
  return db.transaction((tx) => {
    const to = liveLocation(tx, body.toLocationId);
    const ids = body.moves.map((m) => m.stackId);
    const stacks = new Map(
      tx
        .select()
        .from(copyStacks)
        .where(inArray(copyStacks.id, ids))
        .all()
        .map((stack) => [stack.id, stack]),
    );
    const moving: StackMove[] = [];
    for (const { stackId, quantity } of body.moves) {
      const stack = stacks.get(stackId);
      if (!stack || stack.quantity < quantity) throw new StaleCopyError();
      if (stack.locationId !== to.id) moving.push({ stack, quantity });
    }
    if (moving.length === 0) {
      throw new AppError(400, 'already_there', `These copies are already in ${to.name}`);
    }
    const batchId = moveInBatch(tx, moving, to.id);
    const what = describeCopies(
      tx,
      moving.map((m) => ({ scryfallId: m.stack.scryfallId, quantity: m.quantity })),
    );
    return { message: `Moved ${what} to ${to.name}`, batchId };
  });
}

/** POST /api/locations/:id/move-contents. Stacks already in the destination stay put. */
export function moveContents(db: Db, fromLocationId: number, body: MoveContentsBody): ActionResult {
  return db.transaction((tx) => {
    const from = liveLocation(tx, fromLocationId);
    const to = liveLocation(tx, body.toLocationId);
    const order = new Map(treeOrder(tx).map((id, index) => [id, index]));
    const sourceIds = [from.id, ...(body.includeChildren ? descendantIds(tx, from.id) : [])];
    const moving = tx
      .select()
      .from(copyStacks)
      .where(inArray(copyStacks.locationId, sourceIds))
      .all()
      .filter((stack) => stack.locationId !== to.id)
      .sort(
        (a, b) => (order.get(a.locationId) ?? 0) - (order.get(b.locationId) ?? 0) || a.id - b.id,
      )
      .map((stack) => ({ stack, quantity: stack.quantity }));
    if (moving.length === 0) {
      throw new AppError(400, 'nothing_to_move', `${from.name} has no cards to move`);
    }
    const batchId = moveInBatch(tx, moving, to.id);
    const what = describeCopies(
      tx,
      moving.map((m) => ({ scryfallId: m.stack.scryfallId, quantity: m.quantity })),
    );
    return { message: `Moved ${what} from ${from.name} to ${to.name}`, batchId };
  });
}

/** POST /api/stacks/proxy. Nothing to undo, so no batch. */
export function markProxy(db: Db, stackIds: number[], isProxy: boolean): ActionResult {
  const changed = setProxy(db, stackIds, isProxy);
  const stacks = changed === 1 ? '1 stack' : `${changed} stacks`;
  return {
    message: `Marked ${stacks} as ${isProxy ? (changed === 1 ? 'a proxy' : 'proxies') : 'real'}`,
    batchId: null,
  };
}

/** POST /api/stacks/add. */
export function addToCollection(db: Db, body: AddCopiesBody): ActionResult {
  return db.transaction((tx) => {
    const location = liveLocation(tx, body.locationId);
    if (!printingExists(tx, body.scryfallId)) {
      throw new AppError(404, 'printing_not_found', 'That printing is not in the card data');
    }
    const batchId = createBatch(tx, 'add');
    addCopies(tx, { ...body, reason: 'added', batchId, deckId: deckOfBox(tx, location.id) });
    const name = cardName(tx, body.scryfallId);
    return { message: `Added ${body.quantity} ${name} to ${location.name}`, batchId };
  });
}
