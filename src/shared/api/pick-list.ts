import { z } from 'zod';
import { CardSummary, DeckState, Id, LocationRef, StackRow } from './common';
import { PrintingHint } from './decks';

// The pick list: one walk past each location to pull a deck's missing copies into its deck
// box. The server works it out every time it opens and never stores it, so it shows only
// what is left. Each schema has a type of the same name.

const Count = z.number().int().nonnegative();
const Quantity = z.number().int().positive();

/** The deck a walk list is for. */
export const AssemblyDeck = z.object({
  id: Id,
  name: z.string(),
  state: DeckState,
});
export type AssemblyDeck = z.infer<typeof AssemblyDeck>;

/** One copy stack to pull for one slot. */
export const PickLine = z.object({
  /** Tells lines apart within one pick list: the slot id and the line's number for that slot, such as "104-1". */
  key: z.string(),
  slotId: Id,
  card: CardSummary,
  /** How many copies to pull from the suggested stack. */
  quantity: Quantity,
  /** The copy to pull: the decklist's printing first, then real before proxy, then a location already on the route. */
  suggested: StackRow,
  /** The other copies Jeff can switch to, best first. */
  alternatives: z.array(StackRow),
  /** Set for copies in another deck's box: pulling one leaves that deck partly assembled when `becomesPartly`. */
  fromDeck: z
    .object({
      id: Id,
      name: z.string(),
      /** True when that deck is assembled now, so pulling the copy leaves it partly assembled. */
      becomesPartly: z.boolean(),
    })
    .nullable(),
  /** True when the suggested copy is in a location for trade. */
  fromTrade: z.boolean(),
});
export type PickLine = z.infer<typeof PickLine>;

/** The lines to pull in one location. */
export const PickGroup = z.object({
  location: LocationRef,
  /** Cards to pull here: the sum of the lines' quantities ("pull N here"). */
  cardCount: Quantity,
  lines: z.array(PickLine),
});
export type PickGroup = z.infer<typeof PickGroup>;

/** A slot no copy anywhere can fill. Jeff can leave a gap, add it to the buy list or add a proxy. */
export const MissingLine = z.object({
  slotId: Id,
  card: CardSummary,
  /** How many copies are missing. */
  quantity: Quantity,
  /** The printing the decklist names, if any; Add proxy suggests it. */
  hint: PrintingHint.nullable(),
});
export type MissingLine = z.infer<typeof MissingLine>;

/** Runes are always available and never tracked (D-15), so they are only counts to add. */
export const RuneLine = z.object({
  card: CardSummary,
  quantity: Quantity,
});
export type RuneLine = z.infer<typeof RuneLine>;

/** Lines and cards in a walk list. */
export const WalkTotals = z.object({
  lines: Count,
  cards: Count,
});
export type WalkTotals = z.infer<typeof WalkTotals>;

export const PickList = z.object({
  /** In location-tree order. */
  groups: z.array(PickGroup),
  /** "Not in storage: in another deck": copies only another deck's box holds. */
  otherDecks: z.array(PickLine),
  missing: z.array(MissingLine),
  /** At the end, such as "6 Fury Rune, 6 Chaos Rune". */
  runes: z.array(RuneLine),
  /** The lines Jeff can tick: every line in `groups` and `otherDecks`. Missing lines and runes are left out. */
  totals: WalkTotals,
});
export type PickList = z.infer<typeof PickList>;

/** GET /api/decks/:id/pick-list */
export const PickListResponse = z.object({
  deck: AssemblyDeck.extend({ deckBoxId: Id }),
  pickList: PickList,
});
export type PickListResponse = z.infer<typeof PickListResponse>;
