import { z } from 'zod';
import { CopyDetails, Id } from './common';

// The copies area: moving copies, marking proxies and adding copies. Each route answers with
// an `ActionResult`. Routes in src/server/routes/copies.ts.

const Quantity = z.number().int().positive();

/**
 * POST /api/moves → `ActionResult`. Moves part or all of each stack to one location, in one
 * batch. Error: 409 `stale_copy` "This copy has moved, pick another" when a stack no longer
 * holds the quantity, and then nothing moves.
 */
export const MoveCopiesBody = z.object({
  moves: z.array(z.object({ stackId: Id, quantity: Quantity })).min(1),
  toLocationId: Id,
});
export type MoveCopiesBody = z.infer<typeof MoveCopiesBody>;

/** POST /api/locations/:id/move-contents → `ActionResult`. Moves every stack in the location. */
export const MoveContentsBody = z.object({
  toLocationId: Id,
  /** Also move the stacks in its child locations. */
  includeChildren: z.boolean(),
});
export type MoveContentsBody = z.infer<typeof MoveContentsBody>;

/**
 * POST /api/stacks/proxy → `ActionResult` with batchId null: marking a proxy isn't a change
 * of location, so there is nothing to undo.
 */
export const SetProxyBody = z.object({
  stackIds: z.array(Id).min(1),
  isProxy: z.boolean(),
});
export type SetProxyBody = z.infer<typeof SetProxyBody>;

/**
 * POST /api/stacks/add → `ActionResult`. Adds to the alike stack in the location, or makes one,
 * in an add batch of its own, so quick add can undo one card (COL-5). Errors: 404
 * `printing_not_found`; 400 `finish_not_available` when the printing doesn't come in the finish.
 */
export const AddCopiesBody = z.object({
  /** The printing. */
  printingId: z.string().min(1),
  quantity: Quantity,
  ...CopyDetails.shape,
  /** Kept, not shown in v1. */
  purchasePrice: z.number().nonnegative().optional(),
  /** Such as "USD". */
  purchaseCurrency: z.string().length(3).optional(),
  locationId: Id,
});
export type AddCopiesBody = z.infer<typeof AddCopiesBody>;

/** Why Jeff lowered or removed copies by hand (COL-13). */
export const RemovalReason = z.enum(['sold', 'traded', 'lost', 'miscounted']);
export type RemovalReason = z.infer<typeof RemovalReason>;

/**
 * POST /api/copies/remove → `ActionResult`. Lowers a stack by `quantity`, or removes it when
 * that is all of it, in one remove batch whose movement has no to location. Errors: 409
 * `stale_copy` when the stack no longer holds the quantity, 409 `in_deck` "These copies are in a
 * deck. Take them out first." for a stack in a deck box.
 */
export const RemoveCopiesBody = z.object({
  stackId: Id,
  quantity: Quantity,
  reason: RemovalReason,
});
export type RemoveCopiesBody = z.infer<typeof RemoveCopiesBody>;
