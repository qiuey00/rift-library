import { and, desc, eq, gte, isNull, type SQL } from 'drizzle-orm';
import type { ActionResult } from '../../shared/api/common';
import type { Db } from '../db/database';
import {
  cards,
  copyStacks,
  deckSlots,
  decks,
  locations,
  movementBatches,
  movements,
  printings,
} from '../db/schema';
import { AppError } from '../errors';
import { addCopies, createBatch, moveCopies, removeCopies } from './copies';

// Undo writes reverse movements; it never deletes history (D-35). Each action is one
// database transaction, so a refused movement in a batch leaves everything as it was.

type Movement = typeof movements.$inferSelect;
type BatchKind = (typeof movementBatches.$inferSelect)['kind'];

/** Pulls fill a slot, so undoing one sets the slot's picked printing back even to empty. */
const PULL_REASONS: Movement['reason'][] = ['assembled', 'swapped_in'];

function cannotUndo(message: string): AppError {
  return new AppError(409, 'cannot_undo', message);
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

/** The location's name, deleted ones included, so messages can still name it. */
function locationName(db: Db, id: number | null): string {
  if (id === null) return 'nowhere';
  return (
    db.select({ name: locations.name }).from(locations).where(eq(locations.id, id)).get()?.name ??
    'a location that no longer exists'
  );
}

function isLive(db: Db, locationId: number): boolean {
  return (
    db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.id, locationId), isNull(locations.deletedAt)))
      .get() !== undefined
  );
}

/** What a movement did, such as "moved Arcane Signet to Rares binder". */
function describeMovement(db: Db, m: Movement): string {
  const what =
    m.quantity === 1 ? cardName(db, m.scryfallId) : `${m.quantity} ${cardName(db, m.scryfallId)}`;
  const to = locationName(db, m.toLocationId);
  if (m.toLocationId === null) return `removed ${what} from ${locationName(db, m.fromLocationId)}`;
  switch (m.reason) {
    case 'imported':
      return `imported ${what} into ${to}`;
    case 'added':
      return `added ${what} to ${to}`;
    case 'assembled':
      return `pulled ${what} into ${to}`;
    case 'returned':
      return `put ${what} away in ${to}`;
    case 'swapped_out':
    case 'swapped_in':
      return `swapped ${what} into ${to}`;
    default:
      return `moved ${what} to ${to}`;
  }
}

const BATCH_LABELS: Record<BatchKind, string> = {
  import: 'import',
  add: 'add',
  move: 'move',
  pick_list: 'pick list',
  put_away: 'put-away list',
  swap: 'swap list',
  undo: 'undo',
};

/** A stack holding the copies exactly where the movement put them, or undefined. */
function stackWhereMovementLeft(db: Db, m: Movement & { toLocationId: number }) {
  const conditions: SQL[] = [
    eq(copyStacks.scryfallId, m.scryfallId),
    eq(copyStacks.finish, m.finish),
    eq(copyStacks.condition, m.condition),
    eq(copyStacks.language, m.language),
    eq(copyStacks.misprint, m.misprint),
    eq(copyStacks.altered, m.altered),
    eq(copyStacks.isProxy, m.isProxy),
    eq(copyStacks.locationId, m.toLocationId),
    m.cameFromAfter === null
      ? isNull(copyStacks.cameFromLocationId)
      : eq(copyStacks.cameFromLocationId, m.cameFromAfter),
    gte(copyStacks.quantity, m.quantity),
  ];
  return db
    .select()
    .from(copyStacks)
    .where(and(...conditions))
    .get();
}

/** "Arcane Signet has moved since. It is now in Rares binder." */
function movedSinceError(db: Db, m: Movement & { toLocationId: number }): AppError {
  const name = cardName(db, m.scryfallId);
  const elsewhere = db
    .select({ locationId: copyStacks.locationId })
    .from(copyStacks)
    .where(
      and(
        eq(copyStacks.scryfallId, m.scryfallId),
        eq(copyStacks.finish, m.finish),
        eq(copyStacks.condition, m.condition),
        eq(copyStacks.language, m.language),
        eq(copyStacks.isProxy, m.isProxy),
      ),
    )
    .all()
    .map((s) => s.locationId);
  const now = elsewhere.find((id) => id !== m.toLocationId) ?? elsewhere[0];
  return cannotUndo(
    now === undefined
      ? `${name} has moved since. It is no longer in your collection.`
      : `${name} has moved since. It is now in ${locationName(db, now)}.`,
  );
}

function refuseUndoRow(m: Movement) {
  if (m.reason === 'undo') {
    throw new AppError(400, 'cannot_undo', 'An undo can’t itself be undone');
  }
}

/** Writes the reverse of one movement into the undo batch and marks the original undone. */
function reverse(db: Db, m: Movement, batchId: number) {
  const links = {
    reason: 'undo' as const,
    batchId,
    deckId: m.deckId ?? undefined,
    slotId: m.slotId ?? undefined,
    undoesMovementId: m.id,
  };
  const name = cardName(db, m.scryfallId);

  if (m.toLocationId === null) {
    // Removed: recreate the stack where it was, from the snapshot.
    const from = m.fromLocationId;
    if (from === null || !isLive(db, from)) {
      throw cannotUndo(
        `${name} can’t go back, because ${locationName(db, from)} no longer exists.`,
      );
    }
    addCopies(db, {
      scryfallId: m.scryfallId,
      quantity: m.quantity,
      purchasePrice: m.purchasePrice ?? undefined,
      purchaseCurrency: m.purchaseCurrency ?? undefined,
      locationId: from,
      cameFromLocationId: m.cameFromBefore,
      finish: m.finish,
      condition: m.condition,
      language: m.language,
      misprint: m.misprint,
      altered: m.altered,
      isProxy: m.isProxy,
      ...links,
    });
  } else {
    const placed = { ...m, toLocationId: m.toLocationId };
    const stack = stackWhereMovementLeft(db, placed);
    if (!stack) throw movedSinceError(db, placed);
    if (m.fromLocationId === null) {
      // Added or imported: take those copies out again.
      removeCopies(db, stack.id, m.quantity, links);
    } else {
      if (!isLive(db, m.fromLocationId)) {
        throw cannotUndo(
          `${name} can’t go back, because ${locationName(db, m.fromLocationId)} no longer exists.`,
        );
      }
      moveCopies(db, stack.id, m.quantity, m.fromLocationId, {
        ...links,
        cameFromAfter: m.cameFromBefore,
      });
    }
  }

  if (m.slotId !== null && (m.pickedBefore !== null || PULL_REASONS.includes(m.reason))) {
    db.update(deckSlots)
      .set({ pickedScryfallId: m.pickedBefore })
      .where(eq(deckSlots.id, m.slotId))
      .run();
  }

  db.update(movements)
    .set({ undoneAt: new Date().toISOString() })
    .where(eq(movements.id, m.id))
    .run();
}

/** POST /api/movements/:id/undo. */
export function undoMovement(db: Db, movementId: number): ActionResult {
  return db.transaction((tx) => {
    const m = tx.select().from(movements).where(eq(movements.id, movementId)).get();
    if (!m) throw new AppError(404, 'movement_not_found', 'That change is not in History');
    refuseUndoRow(m);
    if (m.undoneAt !== null) throw cannotUndo('This change was already undone');
    const batchId = createBatch(tx, 'undo', { deckId: m.deckId ?? undefined });
    reverse(tx, m, batchId);
    return { message: `Undid: ${describeMovement(tx, m)}`, batchId: null };
  });
}

/** POST /api/batches/:id/undo. Newest movement first; ones already undone are skipped. */
export function undoBatch(db: Db, batchId: number): ActionResult {
  return db.transaction((tx) => {
    const batch = tx.select().from(movementBatches).where(eq(movementBatches.id, batchId)).get();
    if (!batch) throw new AppError(404, 'batch_not_found', 'That change is not in History');
    if (batch.kind === 'undo') {
      throw new AppError(400, 'cannot_undo', 'An undo can’t itself be undone');
    }
    const pending = tx
      .select()
      .from(movements)
      .where(and(eq(movements.batchId, batchId), isNull(movements.undoneAt)))
      .orderBy(desc(movements.id))
      .all();
    pending.forEach(refuseUndoRow);
    if (pending.length === 0) throw cannotUndo('This change was already undone');

    const undoBatchId = createBatch(tx, 'undo', { deckId: batch.deckId ?? undefined });
    for (const m of pending) reverse(tx, m, undoBatchId);

    if (pending.length === 1) {
      return { message: `Undid: ${describeMovement(tx, pending[0])}`, batchId: null };
    }
    const deckName =
      batch.deckId === null
        ? undefined
        : tx.select({ name: decks.name }).from(decks).where(eq(decks.id, batch.deckId)).get()?.name;
    const count = pending.reduce((sum, m) => sum + m.quantity, 0);
    const parts = [BATCH_LABELS[batch.kind], deckName, `${count} cards`].filter(Boolean);
    return { message: `Undid: ${parts.join(' · ')}`, batchId: null };
  });
}
