import { z } from 'zod';
import { Board, CardSummary, Id } from './common';

// Making a deck from Moxfield's export text (DECK-1 to DECK-4). The preview reads the text and
// writes nothing; the screen sends it again with Jeff's choices until Jeff creates the deck.

/** The line's number in the text, from 1. */
export const LineNumber = z.number().int().positive();
export type LineNumber = z.infer<typeof LineNumber>;

/** Commanders Jeff chose, as oracle ids: one, or two for partners. */
export const CommanderIds = z.array(z.string()).max(2);

/** Jeff's choices for unmatched lines: line number to the oracle id of the card Jeff picked. */
export const LineFixes = z.record(LineNumber, z.string());
export type LineFixes = z.infer<typeof LineFixes>;

/** POST /api/imports/moxfield/preview */
export const MoxfieldPreviewRequest = z.object({
  text: z.string(),
  /** Leave out to let the server propose the commander. */
  commanders: CommanderIds.optional(),
  fixes: LineFixes.optional(),
  /** Line numbers Jeff chose to leave out. */
  skips: z.array(LineNumber).optional(),
});
export type MoxfieldPreviewRequest = z.infer<typeof MoxfieldPreviewRequest>;

/** `header` is a section line, such as "SIDEBOARD:". */
export const MoxfieldLineTag = z.enum([
  'commander',
  'main',
  'basic',
  'maybe',
  'unmatched',
  'skipped',
  'header',
  'blank',
]);
export type MoxfieldLineTag = z.infer<typeof MoxfieldLineTag>;

/** Every line of the text, as it was pasted, with what the server made of it. */
export const MoxfieldLine = z.object({
  lineNo: LineNumber,
  text: z.string(),
  tag: MoxfieldLineTag,
  /** Updating a deck only: the card isn't in the deck's current list. */
  isNew: z.boolean().optional(),
});
export type MoxfieldLine = z.infer<typeof MoxfieldLine>;

/** The printing a line named, kept on the slot as its printing hint (DECK-4). */
export const PrintingHint = z.object({
  setCode: z.string(),
  collectorNumber: z.string(),
  foil: z.boolean(),
});
export type PrintingHint = z.infer<typeof PrintingHint>;

/** One slot the deck will have. Repeated names merge into one slot with their total quantity. */
export const ParsedSlot = z.object({
  card: CardSummary,
  board: Board,
  quantity: z.number().int().positive(),
  /** The first merged line's printing; null for lines without a set code. */
  hint: PrintingHint.nullable(),
});
export type ParsedSlot = z.infer<typeof ParsedSlot>;

/** The answer to the preview. */
export const MoxfieldPreview = z.object({
  /** "sets" for lines like "1 Sol Ring (EOC) 57", "plain" for lines like "1 Sol Ring". */
  format: z.enum(['sets', 'plain']),
  lines: z.array(MoxfieldLine),
  /** The commanders Jeff chose, or the ones the server proposes from the text: 0 to 2. */
  commanders: z.array(CardSummary).max(2),
  /** Every matched slot, the commander's included (board `commander`). */
  slots: z.array(ParsedSlot),
  unmatched: z.array(
    z.object({ lineNo: LineNumber, name: z.string(), quantity: z.number().int().positive() }),
  ),
  /**
   * Cards per board as the text has them, skipped lines left out and unmatched lines counted.
   * `main` includes the basic lands; `basics` is how many of them are basic lands.
   */
  counts: z.object({
    main: z.number().int().nonnegative(),
    maybe: z.number().int().nonnegative(),
    basics: z.number().int().nonnegative(),
  }),
  /** Scryfall couldn't be reached, so names the app doesn't know weren't looked up. */
  lookupFailed: z.boolean(),
});
export type MoxfieldPreview = z.infer<typeof MoxfieldPreview>;

/** POST /api/imports/moxfield/create */
export const MoxfieldCreateRequest = z.object({
  text: z.string(),
  name: z.string().trim().min(1),
  commanders: CommanderIds,
  fixes: LineFixes,
  skips: z.array(LineNumber),
});
export type MoxfieldCreateRequest = z.infer<typeof MoxfieldCreateRequest>;

export const MoxfieldCreateResult = z.object({
  deckId: Id,
  /** Such as "Created the deck Hearthhull". */
  message: z.string(),
});
export type MoxfieldCreateResult = z.infer<typeof MoxfieldCreateResult>;
