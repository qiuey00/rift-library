import { z } from 'zod';
import { Board, CardSummary, Id, PrintingSummary } from './common';
import { DeckCheck } from './deck-checks';
import { BoardCounts, DeckName, DeckSummary, PrintingHint, Tag } from './decks';

// Deck lists: pasting one to make a deck (DECK-14, DECK-15) or to update a deck (CHG-1). The
// format is in docs/technical-design.md, "Deck lists". The preview reads the text and writes
// nothing; the screen sends it again with Jeff's fixes and skips until the list looks right.
// Each schema has a type of the same name.

const Count = z.number().int().nonnegative();
const Quantity = z.number().int().positive();

/** A line's number in the pasted text, from 1. */
export const LineNumber = z.number().int().positive();
export type LineNumber = z.infer<typeof LineNumber>;

/** The pasted or uploaded text. */
export const DeckListText = z
  .string()
  .max(200_000, 'This deck list is too long')
  .refine((text) => text.trim().length > 0, { message: 'Paste a deck list' });
export type DeckListText = z.infer<typeof DeckListText>;

/** Jeff's pick for an unmatched line: the card it should be. */
export const LineFix = z.object({ lineNumber: LineNumber, cardId: Id });
export type LineFix = z.infer<typeof LineFix>;

/** The text with Jeff's choices. An unmatched line with no fix is left out, as a skip is. */
export const DeckListRequest = z.object({
  text: DeckListText,
  fixes: z.array(LineFix).optional(),
  /** Line numbers Jeff chose to leave out, matched or not. */
  skips: z.array(LineNumber).optional(),
});
export type DeckListRequest = z.infer<typeof DeckListRequest>;

/** POST /api/deck-lists/preview. With a deck id, the preview also answers what would change. */
export const DeckListPreviewRequest = DeckListRequest.extend({ deckId: Id.optional() });
export type DeckListPreviewRequest = z.infer<typeof DeckListPreviewRequest>;

/** What the server made of a line: a board heading such as "Main:", a card, or neither. */
export const DeckListLineKind = z.enum(['heading', 'card', 'unmatched', 'skipped', 'blank']);
export type DeckListLineKind = z.infer<typeof DeckListLineKind>;

/** Every line of the text as it was pasted, so the preview can tag each with its board. */
export const DeckListLine = z.object({
  lineNumber: LineNumber,
  text: z.string(),
  kind: DeckListLineKind,
  /** The board the line is on, or the heading starts; null for blank lines. */
  board: Board.nullable(),
  /** Updating a deck only: the card isn't on this board of the deck now. */
  isNew: z.boolean(),
});
export type DeckListLine = z.infer<typeof DeckListLine>;

/** One slot the deck will have. Repeated names on one board merge into one slot (DECK-14). */
export const ListedSlot = z.object({
  card: CardSummary,
  board: Board,
  quantity: Quantity,
  /** The first merged line's public code and foil; null when no line named one. */
  hint: PrintingHint.nullable(),
  /** The printing the hint names; null without a hint or when the app doesn't know it. */
  printing: PrintingSummary.nullable(),
  /** The merged lines' tags, repeats merged, sorted by name ignoring case. */
  tags: z.array(Tag),
  lineNumbers: z.array(LineNumber).min(1),
});
export type ListedSlot = z.infer<typeof ListedSlot>;

/** A card line whose name matched no card, even through Riftcodex. */
export const UnmatchedLine = z.object({
  lineNumber: LineNumber,
  /** The name as written, such as "Hextek Vault". */
  name: z.string(),
  quantity: Quantity,
  board: Board,
});
export type UnmatchedLine = z.infer<typeof UnmatchedLine>;

/** What the new list changes, compared with the deck's slots now. */
export const DeckChanges = z.object({
  added: z.array(ListedSlot),
  removed: z.array(ListedSlot),
  changed: z.array(z.object({ card: CardSummary, board: Board, from: Count, to: Count })),
});
export type DeckChanges = z.infer<typeof DeckChanges>;

/** A preview's id, such as "dlp_7f3a9c": it names the parsed list until the server restarts. */
export const PreviewId = z.string().regex(/^dlp_[a-z0-9]+$/, 'This isn’t a deck list preview');
export type PreviewId = z.infer<typeof PreviewId>;

/** The answer to POST /api/deck-lists/preview. Nothing is written. */
export const DeckListPreview = z.object({
  previewId: PreviewId,
  lines: z.array(DeckListLine),
  /** Every matched slot, in `Board` order, Legend and Chosen Champion included. */
  slots: z.array(ListedSlot),
  /** Cards per board from the matched slots; unmatched and skipped lines aren't counted. */
  boards: BoardCounts,
  /** The Legend the list names under "Legend:", or else its first legend; null when there is none. */
  legend: CardSummary.nullable(),
  /**
   * The Chosen Champion the list names under "Champion:", or else its first champion unit with
   * the Legend's champion tag; null when there is none.
   */
  champion: CardSummary.nullable(),
  unmatched: z.array(UnmatchedLine),
  /** The deck checks for the matched slots, as `DeckChecks` has them (DECK-6). */
  checks: z.array(DeckCheck),
  /** Null unless the request named a deck. */
  changes: DeckChanges.nullable(),
  /** Riftcodex couldn't be reached, so names the app doesn't know weren't looked up. */
  lookupFailed: z.boolean(),
});
export type DeckListPreview = z.infer<typeof DeckListPreview>;

/**
 * POST /api/deck-lists/:previewId/create → 201 `DeckSummary`: makes the deck from the preview,
 * with the Legend and Chosen Champion Jeff confirmed or changed (DECK-15). An unknown or
 * expired preview answers 404 `preview_not_found`.
 */
export const DeckListCreate = z.object({
  name: DeckName,
  legendId: Id,
  /** Null to make the deck without a Chosen Champion for now. */
  championId: Id.nullable(),
});
export type DeckListCreate = z.infer<typeof DeckListCreate>;

/** POST /api/decks/:id/deck-list takes a `DeckListRequest`; this is its answer (CHG-1). */
export const DeckListUpdated = z.object({
  deck: DeckSummary,
  /** Such as "Updated Jinx Burn: 4 cards added, 3 removed". */
  message: z.string(),
  /** The deck box holds copies the new list doesn't want, so the screen opens the swap list. */
  needsSwap: z.boolean(),
});
export type DeckListUpdated = z.infer<typeof DeckListUpdated>;
