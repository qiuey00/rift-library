import { z } from 'zod';
import { AssemblyDeck, PickList } from './pick-list';
import { PutAwayGroup } from './put-away';

// The swap list: after a built deck's list changes, take out the copies the new list no
// longer needs and pull in what it lacks. Take-outs tick through POST /api/decks/:id/returns
// with reason `swapped_out`, pull-ins through POST /api/decks/:id/pulls with reason
// `swapped_in`. Each schema has a type of the same name.

const Count = z.number().int().nonnegative();

/** GET /api/decks/:id/swap */
export const SwapResponse = z.object({
  deck: AssemblyDeck,
  /** Copies in the box beyond what the slots need, grouped by destination like the put-away list. */
  takeOut: z.object({
    groups: z.array(PutAwayGroup),
    /** Cards to take out. */
    count: Count,
  }),
  /** What unfilled slots still need, laid out like the pick list. */
  pullIn: PickList,
  counts: z.object({
    takeOut: Count,
    pullIn: Count,
  }),
});
export type SwapResponse = z.infer<typeof SwapResponse>;
