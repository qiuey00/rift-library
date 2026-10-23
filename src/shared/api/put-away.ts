import { z } from 'zod';
import { ActionResult, CardSummary, CopyDetails, Id, LocationRef, PrintingSummary } from './common';
import { AssemblyDeck, WalkTotals } from './pick-list';

// The put-away list: cards leave a deck box the way they came in, back to the spot they
// left, unless Jeff picks another. Each schema has a type of the same name.

const Quantity = z.number().int().positive();

/** One copy stack in the deck box. */
export const PutAwayLine = z.object({
  stackId: Id,
  card: CardSummary,
  printing: PrintingSummary,
  ...CopyDetails.shape,
  quantity: Quantity,
  /** Where it goes: its came-from location, or the "to sort" inbox when it has none. */
  destination: LocationRef,
  cameFrom: LocationRef.nullable(),
});
export type PutAwayLine = z.infer<typeof PutAwayLine>;

/** The lines going to one destination. */
export const PutAwayGroup = z.object({
  location: LocationRef,
  lines: z.array(PutAwayLine),
});
export type PutAwayGroup = z.infer<typeof PutAwayGroup>;

/** GET /api/decks/:id/put-away */
export const PutAwayResponse = z.object({
  deck: AssemblyDeck,
  /** By destination, in location-tree order (the same order as the pick list). */
  groups: z.array(PutAwayGroup),
  totals: WalkTotals,
});
export type PutAwayResponse = z.infer<typeof PutAwayResponse>;

/**
 * POST /api/decks/:id/returns. Answers 409 `stale_copy` when a stack has moved or shrunk, and
 * 400 `deck_box_destination` when `toLocationId` is a deck box; either way nothing changes.
 * "Keep in box" means the line simply isn't sent.
 */
export const ReturnRequest = z.object({
  lines: z
    .array(
      z.object({
        stackId: Id,
        quantity: Quantity,
        /** Send elsewhere: the copies now live there. Left out, they go to their destination. */
        toLocationId: Id.optional(),
      }),
    )
    .min(1),
  /** The batch the first return of this list returned, so one teardown is one History entry. */
  batchId: Id.optional(),
  /** `returned` from the put-away list (the default), `swapped_out` from the swap list. */
  reason: z.enum(['returned', 'swapped_out']).optional(),
});
export type ReturnRequest = z.infer<typeof ReturnRequest>;

export const ReturnResult = ActionResult.extend({
  /** One per line, in the order sent. */
  movementIds: z.array(Id),
  batchId: Id,
});
export type ReturnResult = z.infer<typeof ReturnResult>;
