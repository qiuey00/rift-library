import { z } from 'zod';
import { Board, CardSummary, Id } from './common';
import { CommanderIds, LineFixes, LineNumber, MoxfieldPreview, ParsedSlot } from './moxfield';

// Updating a deck from a fresh Moxfield export (CHG-1). The new text replaces the deck's slots;
// when the deck box holds copies, the screen opens the swap list afterwards.

/** POST /api/imports/moxfield/update-preview */
export const MoxfieldUpdatePreviewRequest = z.object({
  deckId: Id,
  text: z.string(),
  commanders: CommanderIds.optional(),
  fixes: LineFixes.optional(),
  skips: z.array(LineNumber).optional(),
});
export type MoxfieldUpdatePreviewRequest = z.infer<typeof MoxfieldUpdatePreviewRequest>;

/** What the new text changes, compared with the deck's current slots. */
export const DeckChanges = z.object({
  added: z.array(ParsedSlot),
  removed: z.array(ParsedSlot),
  changed: z.array(
    z.object({
      card: CardSummary,
      board: Board,
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative(),
    }),
  ),
});
export type DeckChanges = z.infer<typeof DeckChanges>;

/** The answer to the update preview. Nothing is written. */
export const MoxfieldUpdatePreview = MoxfieldPreview.extend({
  changes: DeckChanges,
});
export type MoxfieldUpdatePreview = z.infer<typeof MoxfieldUpdatePreview>;

/** POST /api/imports/moxfield/update-apply */
export const MoxfieldUpdateApplyRequest = z.object({
  deckId: Id,
  text: z.string(),
  commanders: CommanderIds,
  fixes: LineFixes,
  skips: z.array(LineNumber),
});
export type MoxfieldUpdateApplyRequest = z.infer<typeof MoxfieldUpdateApplyRequest>;

export const MoxfieldUpdateApplyResult = z.object({
  deckId: Id,
  message: z.string(),
  /** The deck box holds copies, so the screen opens the swap list next. */
  needsSwap: z.boolean(),
});
export type MoxfieldUpdateApplyResult = z.infer<typeof MoxfieldUpdateApplyResult>;
