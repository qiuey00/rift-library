import { z } from 'zod';
import {
  Board,
  CardSummary,
  DeckState,
  Id,
  LocationRef,
  PrintingSummary,
  SlotStatus,
} from './common';

// Decks and their slots: the Decks home, the deck view and building a deck in the app.
// Each schema has a type of the same name.

const Count = z.number().int().nonnegative();
const Quantity = z.number().int().positive();
const OracleId = z.string().min(1);
const DeckName = z.string().trim().min(1, 'Give the deck a name');
/** UTC, such as "2026-10-18T21:40:00Z". */
const Time = z.iso.datetime();

/** A deck named in another answer, such as a deck holding a copy. */
export const DeckRef = z.object({ id: Id, name: z.string() });
export type DeckRef = z.infer<typeof DeckRef>;

/** Cards in the commander and main boards by where they are, counted by slot quantity. */
export const DeckCounts = z.object({
  inBox: Count,
  free: Count,
  otherDecks: Count,
  missing: Count,
  basics: Count,
});
export type DeckCounts = z.infer<typeof DeckCounts>;

export const DeckSummary = z.object({
  id: Id,
  name: z.string(),
  /** The deck's own deck box, a location. */
  deckBoxId: Id,
  commanders: z.array(CardSummary),
  /** The commanders' colors together, such as "BRG"; "" for colorless. */
  colorIdentity: z.string(),
  state: DeckState,
  counts: DeckCounts,
  /** Every copy in the deck box, including any the slots no longer need. */
  boxCopyCount: Count,
  /** Null until the deck is first opened. */
  openedAt: Time.nullable(),
});
export type DeckSummary = z.infer<typeof DeckSummary>;

/** The printing a Moxfield export named for a slot, such as "(EOC) 1 *F*". */
export const PrintingHint = z.object({
  /** Lowercase, as Scryfall writes it, such as "eoc". */
  setCode: z.string(),
  collectorNumber: z.string(),
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
  /** Null for slots added in the app rather than from a Moxfield export with sets. */
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

/** GET /api/decks/:id and PUT /api/decks/:id/commanders. */
export const DeckView = z.object({ deck: DeckSummary, slots: z.array(SlotRow) });
export type DeckView = z.infer<typeof DeckView>;

/** One commander, or two partners. */
const Commanders = z
  .array(OracleId)
  .min(1, 'Pick a commander')
  .max(2, 'A deck has at most two commanders');

/** POST /api/decks. */
export const NewDeck = z.object({ name: DeckName, commanders: Commanders });
export type NewDeck = z.infer<typeof NewDeck>;

/** PATCH /api/decks/:id. */
export const DeckRename = z.object({ name: DeckName });
export type DeckRename = z.infer<typeof DeckRename>;

/** PUT /api/decks/:id/commanders. */
export const DeckCommanders = z.object({ oracleIds: Commanders });
export type DeckCommanders = z.infer<typeof DeckCommanders>;

/** A card and how many of it on one board: POST /api/decks/:id/slots, and the unsaved lists deck checks take. */
export const SlotInput = z.object({ oracleId: OracleId, board: Board, quantity: Quantity });
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

/**
 * POST /api/decks/:id/slots/drop: a card dragged in from another site (scryfall.com,
 * edhrec.com), as the browser's drop strings. Answers with the slot the card is in.
 */
export const CardDrop = z.object({
  /** The panel it was dropped on. */
  board: z.enum(['main', 'maybe']),
  /** The drop's `text/uri-list`, `text/html` and `text/plain`. */
  uriList: z.string().max(10_000).optional(),
  html: z.string().max(100_000).optional(),
  text: z.string().max(10_000).optional(),
});
export type CardDrop = z.infer<typeof CardDrop>;

/** The printing a slot should have: one of the card's printings, and whether the foil. */
export const SlotPrinting = z.object({ scryfallId: z.string().min(1), foil: z.boolean() });
export type SlotPrinting = z.infer<typeof SlotPrinting>;

/**
 * PATCH /api/decks/:id/slots/:slotId: change the quantity, move it to another board, change
 * its printing, or any of these together. A new printing becomes the slot's printing hint and
 * clears its picked printing unless it is the same; copies in the deck box stay where they are.
 */
export const SlotChange = z
  .object({
    quantity: Quantity.optional(),
    board: Board.optional(),
    printing: SlotPrinting.optional(),
  })
  .refine(
    (change) =>
      change.quantity !== undefined || change.board !== undefined || change.printing !== undefined,
    { message: 'Send a quantity, a board, a printing or more than one' },
  );
export type SlotChange = z.infer<typeof SlotChange>;
