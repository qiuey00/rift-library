import { z } from 'zod';
import { ActionResult, Id } from './common';

// Ticking a pick-list line moves the copy into the deck box at once. Unticking is the undo
// route, POST /api/movements/:id/undo, with the movement id a pull returns.
// Each schema has a type of the same name.

const Quantity = z.number().int().positive();

/**
 * POST /api/decks/:id/pulls. Answers 409 `stale_copy` ("This copy has moved, pick another")
 * when the stack no longer holds the copies, and nothing changes.
 */
export const PullRequest = z.object({
  slotId: Id,
  stackId: Id,
  quantity: Quantity,
  /** The batch the first pull of this pick list returned, so one pick list is one History entry. */
  batchId: Id.optional(),
  /** `assembled` from the pick list (the default), `swapped_in` from the swap list. */
  reason: z.enum(['assembled', 'swapped_in']).optional(),
});
export type PullRequest = z.infer<typeof PullRequest>;

export const PullResult = ActionResult.extend({
  /** What unticking the line undoes. */
  movementId: Id,
  batchId: Id,
  /** The deck the copy came from, which is now partly assembled; null for copies from storage. */
  otherDeck: z.object({ id: Id, name: z.string() }).nullable(),
});
export type PullResult = z.infer<typeof PullResult>;

/** POST /api/decks/:id/proxies: adds a proxy of a missing card straight into the deck box. */
export const ProxyRequest = z.object({
  slotId: Id,
  scryfallId: z.string().min(1),
  quantity: Quantity,
  batchId: Id.optional(),
});
export type ProxyRequest = z.infer<typeof ProxyRequest>;

export const ProxyResult = ActionResult.extend({
  movementId: Id,
  batchId: Id,
});
export type ProxyResult = z.infer<typeof ProxyResult>;
