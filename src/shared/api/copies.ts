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

/** POST /api/stacks/add → `ActionResult`. Adds to the alike stack in the location, or makes one. */
export const AddCopiesBody = z.object({
  /** The printing. */
  scryfallId: z.string().min(1),
  quantity: Quantity,
  ...CopyDetails.shape,
  /** Kept, not shown in v1. */
  purchasePrice: z.number().nonnegative().optional(),
  /** Such as "USD". */
  purchaseCurrency: z.string().length(3).optional(),
  locationId: Id,
});
export type AddCopiesBody = z.infer<typeof AddCopiesBody>;
