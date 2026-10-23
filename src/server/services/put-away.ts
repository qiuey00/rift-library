import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ReturnRequest, ReturnResult } from '../../shared/api/put-away';
import type { Db } from '../db/database';
import { copyStacks, locations, movementBatches } from '../db/schema';
import { AppError } from '../errors';
import { locationPaths } from '../queries/locations';
import { destinationFor, findLiveDeck } from '../queries/put-away';
import { createBatch, moveCopies, StaleCopyError } from './copies';
import { describeCopies } from './moves';

// Returning copies from a deck box: each to its destination, or where Jeff sent it instead.
// Slots and their picked printings are never touched, so the deck can be built again.

/** The batch a later return of the same list passes back, or a 404. */
function existingBatch(db: Db, batchId: number, deckId: number) {
  const batch = db
    .select({ id: movementBatches.id })
    .from(movementBatches)
    .where(
      and(
        eq(movementBatches.id, batchId),
        eq(movementBatches.deckId, deckId),
        inArray(movementBatches.kind, ['put_away', 'swap']),
      ),
    )
    .get();
  if (!batch) {
    throw new AppError(404, 'batch_not_found', 'This put-away has ended. Open the list again.');
  }
  return batch.id;
}

/** A Send elsewhere destination: a live location that isn't a deck box. */
function sendElsewhereTo(db: Db, id: number) {
  const location = db
    .select({ id: locations.id, type: locations.type })
    .from(locations)
    .where(and(eq(locations.id, id), isNull(locations.deletedAt)))
    .get();
  if (!location) {
    throw new AppError(404, 'location_not_found', 'That location no longer exists');
  }
  if (location.type === 'deck_box') {
    throw new AppError(
      400,
      'deck_box_destination',
      "Cards can't be put away into a deck box. Pick a storage location instead.",
    );
  }
  return location.id;
}

/** POST /api/decks/:id/returns. One transaction: every line moves, or nothing does. */
export function returnCopies(db: Db, deckId: number, body: ReturnRequest): ReturnResult {
  return db.transaction((tx) => {
    const deck = findLiveDeck(tx, deckId);
    if (!deck) {
      throw new AppError(404, 'deck_not_found', 'This deck was deleted or doesn’t exist.');
    }
    const reason = body.reason ?? 'returned';
    const paths = locationPaths(tx);

    // Check every line before moving any, so a stale stack changes nothing.
    const ids = body.lines.map((line) => line.stackId);
    const stacks = new Map(
      tx
        .select()
        .from(copyStacks)
        .where(inArray(copyStacks.id, ids))
        .all()
        .map((stack) => [stack.id, stack]),
    );
    const left = new Map([...stacks].map(([id, stack]) => [id, stack.quantity]));
    const moves = body.lines.map((line) => {
      const stack = stacks.get(line.stackId);
      const remaining = left.get(line.stackId) ?? 0;
      if (!stack || stack.locationId !== deck.deckBoxId || remaining < line.quantity) {
        throw new StaleCopyError();
      }
      left.set(line.stackId, remaining - line.quantity);
      const to =
        line.toLocationId === undefined
          ? destinationFor(tx, stack, paths)
          : sendElsewhereTo(tx, line.toLocationId);
      return { stack, quantity: line.quantity, to };
    });

    const batchId =
      body.batchId === undefined
        ? createBatch(tx, reason === 'swapped_out' ? 'swap' : 'put_away', { deckId: deck.id })
        : existingBatch(tx, body.batchId, deck.id);
    // Moving out of a deck box clears came-from (moveCopies' rule), so a copy sent somewhere
    // new now lives there.
    const movementIds = moves.map(
      ({ stack, quantity, to }) =>
        moveCopies(tx, stack.id, quantity, to, { reason, batchId, deckId: deck.id }).movementId,
    );

    const what = describeCopies(
      tx,
      moves.map((m) => ({ printingId: m.stack.printingId, quantity: m.quantity })),
    );
    const destinations = new Set(moves.map((m) => m.to));
    const [only] = destinations;
    const message =
      destinations.size === 1 && only !== undefined
        ? `Returned ${what} to ${paths.get(only)}`
        : `Returned ${what}`;
    return { message, batchId, movementIds };
  });
}
