import { z } from 'zod';
import {
  Board,
  CardSummary,
  DeckState,
  Domain,
  Id,
  LocationRef,
  PrintingSummary,
  SlotStatus,
} from './common';

// Decks and their slots: the Decks home, the deck view and building a deck in the app.
// Each schema has a type of the same name.

const Count = z.number().int().nonnegative();
const Quantity = z.number().int().positive();
export const DeckName = z.string().trim().min(1, 'Give the deck a name');
/** UTC, such as "2026-10-18T21:40:00Z". */
const Time = z.iso.datetime();

/** A deck named in another answer, such as a deck holding a copy. */
export const DeckRef = z.object({ id: Id, name: z.string() });
export type DeckRef = z.infer<typeof DeckRef>;

/** Cards on the boards that are pulled, by where they are, counted by slot quantity. */
export const DeckCounts = z.object({
  inBox: Count,
  free: Count,
  otherDecks: Count,
  missing: Count,
  /** Runes are always available (D-15), so they are only counted. */
  runes: Count,
});
export type DeckCounts = z.infer<typeof DeckCounts>;

export const DeckSummary = z.object({
  id: Id,
  name: z.string(),
  /** The deck's own deck box, a location. */
  deckBoxId: Id,
  /** Null until the deck has a Legend. */
  legend: CardSummary.nullable(),
  /** The Chosen Champion; null until the deck has one. */
  champion: CardSummary.nullable(),
  /** The Legend's domains; empty without a Legend. */
  domains: z.array(Domain),
  state: DeckState,
  counts: DeckCounts,
  /** Every copy in the deck box, including any the slots no longer need. */
  boxCopyCount: Count,
  /** Null until the deck is first opened. */
  openedAt: Time.nullable(),
});
export type DeckSummary = z.infer<typeof DeckSummary>;

/** The printing a deck list named for a slot: its public code and foil. */
export const PrintingHint = z.object({
  /** Such as "OGN-042". */
  publicCode: z.string(),
  foil: z.boolean(),
});
export type PrintingHint = z.infer<typeof PrintingHint>;

/** Where copies for a slot can come from. */
export const SlotWhere = z.object({
  /** Storage locations with free copies, best first. */
  locations: z.array(LocationRef),
  /** Free copies in storage. */
  freeCount: Count,
  /** Other decks whose boxes hold a copy. */
  otherDecks: z.array(DeckRef),
});
export type SlotWhere = z.infer<typeof SlotWhere>;

/** One card on one board of a deck. */
export const SlotRow = z.object({
  id: Id,
  card: CardSummary,
  board: Board,
  quantity: Quantity,
  /** The printing of the copy pulled for this slot; null until one is pulled. */
  pickedPrinting: PrintingSummary.nullable(),
  /**
   * The decklist's printing: the picked printing, otherwise the printing the hint names; null
   * when neither is known. The deck view shows its image.
   */
  printing: PrintingSummary.nullable(),
  /** Null for slots added in the app rather than from a deck list with public codes. */
  hint: PrintingHint.nullable(),
  /** Null on the maybe board. */
  status: SlotStatus.nullable(),
  /** Copies of this card in the deck box. */
  inBoxQuantity: Count,
  /** True when a copy in the deck box is a proxy. */
  inBoxProxy: z.boolean(),
  where: SlotWhere,
  /** Such as "Ramp", sorted by name ignoring case. */
  tags: z.array(z.string()),
});
export type SlotRow = z.infer<typeof SlotRow>;

/** GET /api/decks: most recently opened first. */
export const DeckList = z.object({ decks: z.array(DeckSummary) });
export type DeckList = z.infer<typeof DeckList>;

/**
 * Cards on each board, by slot quantity. `main` counts only the main board: the main deck size
 * the deck checks use adds the Chosen Champion (DECK-6).
 */
export const BoardCounts = z.object({
  legend: Count,
  champion: Count,
  main: Count,
  battlefield: Count,
  rune: Count,
  sideboard: Count,
  maybe: Count,
}) satisfies z.ZodType<Record<Board, number>>;
export type BoardCounts = z.infer<typeof BoardCounts>;

/**
 * GET /api/decks/:id, PUT /api/decks/:id/legend and PUT /api/decks/:id/runes. The slots come
 * board by board in `Board` order (legend, champion, main, battlefield, rune, sideboard, maybe),
 * each with its board, so the deck view shows them grouped.
 */
export const DeckView = z.object({
  deck: DeckSummary,
  slots: z.array(SlotRow),
  boards: BoardCounts,
});
export type DeckView = z.infer<typeof DeckView>;

/** POST /api/decks: the deck, its Legend and, when Jeff picked one, its Chosen Champion. */
export const NewDeck = z.object({ name: DeckName, legendId: Id, championId: Id.optional() });
export type NewDeck = z.infer<typeof NewDeck>;

/** PATCH /api/decks/:id. */
export const DeckRename = z.object({ name: DeckName });
export type DeckRename = z.infer<typeof DeckRename>;

/** PUT /api/decks/:id/legend: replaces the deck's Legend. */
export const DeckLegend = z.object({ legendId: Id });
export type DeckLegend = z.infer<typeof DeckLegend>;

/** A card and how many of it on one board: POST /api/decks/:id/slots, and the unsaved lists deck checks take. */
export const SlotInput = z.object({ cardId: Id, board: Board, quantity: Quantity });
export type SlotInput = z.infer<typeof SlotInput>;

/** A slot's tag as Jeff types it. Tags with the same tag key (lower case, spaces as -) are one tag. */
export const Tag = z
  .string()
  .trim()
  .min(1, 'A tag needs a name')
  .max(40, 'A tag can have at most 40 characters')
  .regex(/^[^#]+$/, 'A tag can’t contain #');
export type Tag = z.infer<typeof Tag>;

/**
 * PUT /api/decks/:id/slots/:slotId/tags → `SlotRow`: replaces the slot's tags. Repeats (the
 * same tag key) are merged, keeping the first.
 */
export const SlotTags = z.object({
  tags: z.array(Tag).max(20, 'A card can have at most 20 tags'),
});
export type SlotTags = z.infer<typeof SlotTags>;

/** The printing a slot should have: one of the card's printings, and whether the foil. */
export const SlotPrinting = z.object({ printingId: z.string().min(1), foil: z.boolean() });
export type SlotPrinting = z.infer<typeof SlotPrinting>;

/** The boards a slot can move between from its menu (DECK-16). */
export const MovableBoard = z.enum(['main', 'sideboard', 'maybe']);
export type MovableBoard = z.infer<typeof MovableBoard>;

/**
 * PATCH /api/decks/:id/slots/:slotId: change the quantity, move it to another board, change
 * its printing, or any of these together. A new printing becomes the slot's printing hint and
 * clears its picked printing unless it is the same; copies in the deck box stay where they are.
 */
export const SlotChange = z
  .object({
    quantity: Quantity.optional(),
    /** Moving onto a board that already has the card merges the two slots (DECK-16). */
    board: MovableBoard.optional(),
    printing: SlotPrinting.optional(),
  })
  .refine(
    (change) =>
      change.quantity !== undefined || change.board !== undefined || change.printing !== undefined,
    { message: 'Send a quantity, a board, a printing or more than one' },
  );
export type SlotChange = z.infer<typeof SlotChange>;

/** How many of one rune card the deck has. Zero takes the rune off the deck. */
export const RuneCount = z.object({ cardId: Id, quantity: Count });
export type RuneCount = z.infer<typeof RuneCount>;

/**
 * PUT /api/decks/:id/runes → `DeckView`: sets the count of each rune card named, leaving other
 * rune slots as they are. Runes are always available, so nothing is pulled (D-15).
 */
export const DeckRunes = z.object({
  runes: z
    .array(RuneCount)
    .min(1, 'Send at least one rune')
    .refine((runes) => new Set(runes.map((rune) => rune.cardId)).size === runes.length, {
      message: 'Send each rune card once',
    }),
});
export type DeckRunes = z.infer<typeof DeckRunes>;
