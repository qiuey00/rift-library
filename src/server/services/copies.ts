import { and, eq, inArray, isNull, ne, type SQL } from 'drizzle-orm';
import type { CopyDetails, Finish } from '../../shared/api/common';
import type { Db } from '../db/database';
import { copyStacks, locations, movementBatches, movements, printings } from '../db/schema';
import { AppError } from '../errors';

// The one building block every change of location goes through. Each function runs in its
// own transaction, which becomes a savepoint when called inside an action's transaction.

type BatchKind = (typeof movementBatches.$inferInsert)['kind'];
type Reason = (typeof movements.$inferInsert)['reason'];
type Stack = typeof copyStacks.$inferSelect;

/** A stack no longer holds the copies asked for, so nothing changed. */
export class StaleCopyError extends AppError {
  constructor() {
    super(409, 'stale_copy', 'This copy has moved, pick another');
    this.name = 'StaleCopyError';
  }
}

/** Starts the batch that groups one action's movements. Returns its id. */
export function createBatch(
  db: Db,
  kind: BatchKind,
  { deckId, importId }: { deckId?: number; importId?: number } = {},
): number {
  return db
    .insert(movementBatches)
    .values({ kind, deckId: deckId ?? null, importId: importId ?? null })
    .returning({ id: movementBatches.id })
    .get().id;
}

/** What makes two stacks alike, apart from the printing's details. */
type AlikeKey = {
  scryfallId: string;
  finish: Finish;
  condition: string;
  language: string;
  misprint: boolean;
  altered: boolean;
  isProxy: boolean;
  locationId: number;
  cameFromLocationId: number | null;
};

const alikeKey = (stack: Stack): AlikeKey => ({
  scryfallId: stack.scryfallId,
  finish: stack.finish,
  condition: stack.condition,
  language: stack.language,
  misprint: stack.misprint,
  altered: stack.altered,
  isProxy: stack.isProxy,
  locationId: stack.locationId,
  cameFromLocationId: stack.cameFromLocationId,
});

/** The alike stack for these details, if there is one (came-from compared null-safe). */
function findAlike(db: Db, key: AlikeKey, exceptStackId?: number): Stack | undefined {
  const conditions: SQL[] = [
    eq(copyStacks.scryfallId, key.scryfallId),
    eq(copyStacks.finish, key.finish),
    eq(copyStacks.condition, key.condition),
    eq(copyStacks.language, key.language),
    eq(copyStacks.misprint, key.misprint),
    eq(copyStacks.altered, key.altered),
    eq(copyStacks.isProxy, key.isProxy),
    eq(copyStacks.locationId, key.locationId),
    key.cameFromLocationId === null
      ? isNull(copyStacks.cameFromLocationId)
      : eq(copyStacks.cameFromLocationId, key.cameFromLocationId),
  ];
  if (exceptStackId !== undefined) conditions.push(ne(copyStacks.id, exceptStackId));
  return db
    .select()
    .from(copyStacks)
    .where(and(...conditions))
    .get();
}

type Price = { purchasePrice: number | null; purchaseCurrency: string | null };

/**
 * Puts copies into the alike stack, or a new one. When merging, the destination keeps its
 * purchase price, or takes the arriving copies' if it has none. Returns the stack's id.
 */
function addToAlike(db: Db, key: AlikeKey, quantity: number, price: Price): number {
  const alike = findAlike(db, key);
  if (alike) {
    const keepsPrice = alike.purchasePrice !== null;
    db.update(copyStacks)
      .set({
        quantity: alike.quantity + quantity,
        purchasePrice: keepsPrice ? alike.purchasePrice : price.purchasePrice,
        purchaseCurrency: keepsPrice ? alike.purchaseCurrency : price.purchaseCurrency,
      })
      .where(eq(copyStacks.id, alike.id))
      .run();
    return alike.id;
  }
  return db
    .insert(copyStacks)
    .values({
      ...key,
      quantity,
      purchasePrice: price.purchasePrice,
      purchaseCurrency: price.purchaseCurrency,
    })
    .returning({ id: copyStacks.id })
    .get().id;
}

function locationType(db: Db, id: number) {
  return db.select({ type: locations.type }).from(locations).where(eq(locations.id, id)).get()
    ?.type;
}

type MovementLinks = {
  reason: Reason;
  batchId: number;
  deckId?: number;
  slotId?: number;
  /** Set on the reverse movements undo writes. */
  undoesMovementId?: number;
};

export type AddCopiesInput = {
  scryfallId: string;
  quantity: number;
  purchasePrice?: number;
  purchaseCurrency?: string;
  locationId: number;
  /** Only undo sets this, to put removed copies back exactly; otherwise empty. */
  cameFromLocationId?: number | null;
} & CopyDetails &
  MovementLinks;

/**
 * Adds new copies to the collection: to the alike stack in the location (came-from empty),
 * or a new one. Writes a movement with no from location.
 */
export function addCopies(db: Db, input: AddCopiesInput) {
  return db.transaction((tx) => {
    const key: AlikeKey = {
      scryfallId: input.scryfallId,
      finish: input.finish,
      condition: input.condition,
      language: input.language,
      misprint: input.misprint,
      altered: input.altered,
      isProxy: input.isProxy,
      locationId: input.locationId,
      cameFromLocationId: input.cameFromLocationId ?? null,
    };
    const price: Price = {
      purchasePrice: input.purchasePrice ?? null,
      purchaseCurrency: input.purchaseCurrency ?? null,
    };
    const destStackId = addToAlike(tx, key, input.quantity, price);
    const movementId = writeMovement(tx, {
      copyStackId: destStackId,
      details: { ...key, ...price },
      quantity: input.quantity,
      fromLocationId: null,
      toLocationId: input.locationId,
      cameFromBefore: null,
      cameFromAfter: key.cameFromLocationId,
      links: input,
    });
    return { movementId, destStackId };
  });
}

/** The came-from rule, which only `moveCopies` applies. */
function cameFromAfterMove(db: Db, stack: Stack, toLocationId: number): number | null {
  if (locationType(db, toLocationId) !== 'deck_box') return null;
  // Deck box to deck box keeps the original came-from, so a borrowed copy still goes back
  // to storage (D-31).
  if (locationType(db, stack.locationId) === 'deck_box') return stack.cameFromLocationId;
  return stack.locationId;
}

/** Takes copies out of a stack, deleting it at zero. Throws `StaleCopyError` if too few. */
function takeFromStack(db: Db, stackId: number, quantity: number): Stack {
  const stack = db.select().from(copyStacks).where(eq(copyStacks.id, stackId)).get();
  if (!stack || stack.quantity < quantity) throw new StaleCopyError();
  if (stack.quantity === quantity) {
    db.delete(copyStacks).where(eq(copyStacks.id, stackId)).run();
  } else {
    db.update(copyStacks)
      .set({ quantity: stack.quantity - quantity })
      .where(eq(copyStacks.id, stackId))
      .run();
  }
  return stack;
}

/**
 * Moves copies of one stack to a location: splits the stack if only part moves, sets the
 * came-from location, merges into the alike stack there, and writes one movement.
 */
export function moveCopies(
  db: Db,
  stackId: number,
  quantity: number,
  toLocationId: number,
  options: MovementLinks & {
    pickedBefore?: string | null;
    /** Only undo sets this, to restore came-from exactly instead of applying the rule. */
    cameFromAfter?: number | null;
  },
) {
  return db.transaction((tx) => {
    const stack = takeFromStack(tx, stackId, quantity);
    const cameFromAfter =
      options.cameFromAfter !== undefined
        ? options.cameFromAfter
        : cameFromAfterMove(tx, stack, toLocationId);
    const key: AlikeKey = {
      ...alikeKey(stack),
      locationId: toLocationId,
      cameFromLocationId: cameFromAfter,
    };
    const destStackId = addToAlike(tx, key, quantity, stack);
    const movementId = writeMovement(tx, {
      copyStackId: destStackId,
      details: stack,
      quantity,
      fromLocationId: stack.locationId,
      toLocationId,
      cameFromBefore: stack.cameFromLocationId,
      cameFromAfter,
      links: options,
      pickedBefore: options.pickedBefore ?? null,
    });
    return { movementId, destStackId };
  });
}

/** Takes copies out of the collection. Writes a movement with no to location. */
export function removeCopies(db: Db, stackId: number, quantity: number, links: MovementLinks) {
  return db.transaction((tx) => {
    const stack = takeFromStack(tx, stackId, quantity);
    const movementId = writeMovement(tx, {
      copyStackId: stack.id,
      details: stack,
      quantity,
      fromLocationId: stack.locationId,
      toLocationId: null,
      cameFromBefore: stack.cameFromLocationId,
      cameFromAfter: null,
      links,
    });
    return { movementId };
  });
}

/**
 * Marks stacks as proxies or real copies, merging each into an alike stack if one now
 * exists. Not a change of location, so no movement. Throws `StaleCopyError` if a stack is
 * gone. Returns how many stacks changed.
 */
export function setProxy(db: Db, stackIds: number[], isProxy: boolean): number {
  return db.transaction((tx) => {
    const stacks = tx.select().from(copyStacks).where(inArray(copyStacks.id, stackIds)).all();
    if (stacks.length !== new Set(stackIds).size) throw new StaleCopyError();
    let changed = 0;
    for (const stack of stacks) {
      if (stack.isProxy === isProxy) continue;
      changed++;
      const key = { ...alikeKey(stack), isProxy };
      if (findAlike(tx, key, stack.id)) {
        tx.delete(copyStacks).where(eq(copyStacks.id, stack.id)).run();
        addToAlike(tx, key, stack.quantity, stack);
      } else {
        tx.update(copyStacks).set({ isProxy }).where(eq(copyStacks.id, stack.id)).run();
      }
    }
    return changed;
  });
}

type MovementDetails = Pick<
  Stack,
  | 'scryfallId'
  | 'finish'
  | 'condition'
  | 'language'
  | 'misprint'
  | 'altered'
  | 'isProxy'
  | 'purchasePrice'
  | 'purchaseCurrency'
>;

function writeMovement(
  db: Db,
  m: {
    copyStackId: number;
    details: MovementDetails;
    quantity: number;
    fromLocationId: number | null;
    toLocationId: number | null;
    cameFromBefore: number | null;
    cameFromAfter: number | null;
    links: MovementLinks;
    pickedBefore?: string | null;
  },
): number {
  const { details, links } = m;
  return db
    .insert(movements)
    .values({
      batchId: links.batchId,
      copyStackId: m.copyStackId,
      scryfallId: details.scryfallId,
      finish: details.finish,
      condition: details.condition,
      language: details.language,
      misprint: details.misprint,
      altered: details.altered,
      isProxy: details.isProxy,
      purchasePrice: details.purchasePrice,
      purchaseCurrency: details.purchaseCurrency,
      quantity: m.quantity,
      fromLocationId: m.fromLocationId,
      toLocationId: m.toLocationId,
      cameFromBefore: m.cameFromBefore,
      cameFromAfter: m.cameFromAfter,
      reason: links.reason,
      deckId: links.deckId ?? null,
      slotId: links.slotId ?? null,
      pickedBefore: m.pickedBefore ?? null,
      undoesMovementId: links.undoesMovementId ?? null,
    })
    .returning({ id: movements.id })
    .get().id;
}

/** The printing exists in the card data. */
export function printingExists(db: Db, scryfallId: string): boolean {
  return (
    db
      .select({ id: printings.scryfallId })
      .from(printings)
      .where(eq(printings.scryfallId, scryfallId))
      .get() !== undefined
  );
}
