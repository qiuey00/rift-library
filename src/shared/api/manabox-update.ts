import { z } from 'zod';
import {
  ActionResult,
  CardSummary,
  Finish,
  Id,
  IdParam,
  LocationRef,
  PrintingSummary,
} from './common';
import { InvalidRow, RowFixes, RowNumber, UnknownRow } from './manabox';

// Updating one location from a ManaBox CSV that describes it (COL-3, COL-4). Rows are matched on
// the match key (printing, finish, condition, language, misprint, altered) against the stacks in
// that location and in deck boxes whose came-from location is that location.

/** POST /api/imports/manabox/update-preview, multipart. */
export const ManaBoxUpdatePreviewRequest = z.object({
  file: z.instanceof(File),
  /** The location the file describes. */
  locationId: IdParam,
});
export type ManaBoxUpdatePreviewRequest = z.infer<typeof ManaBoxUpdatePreviewRequest>;

/** Copies the update would take out of a deck box, for Jeff to keep or remove one by one. */
export const FlaggedCopy = z.object({
  stackId: Id,
  deck: z.object({ id: Id, name: z.string() }),
  quantity: z.number().int().positive(),
});
export type FlaggedCopy = z.infer<typeof FlaggedCopy>;

/** One match key, with how many copies the file has and how many belong to the location now. */
export const UpdateRow = z.object({
  key: z.string(),
  card: CardSummary,
  printing: PrintingSummary,
  finish: Finish,
  condition: z.string(),
  language: z.string(),
  misprint: z.boolean(),
  altered: z.boolean(),
  fileQuantity: z.number().int().nonnegative(),
  /** Copies in the location plus copies in deck boxes that came from it. */
  appQuantity: z.number().int().nonnegative(),
  /** Empty unless lowering or removing would take copies out of deck boxes. */
  flagged: z.array(FlaggedCopy),
});
export type UpdateRow = z.infer<typeof UpdateRow>;

/** The answer to the update preview. Nothing is written. */
export const UpdatePreview = z.object({
  /** Where the server keeps the parsed rows until the apply. Not a database id. */
  previewId: z.string(),
  location: LocationRef,
  groups: z.object({
    /** In the file, not in the app. */
    new: z.array(UpdateRow),
    /** More copies in the file than in the app. */
    raised: z.array(UpdateRow),
    /** Fewer copies in the file than in the app, but some. */
    lowered: z.array(UpdateRow),
    /** In the app, not in the file. */
    missing: z.array(UpdateRow),
  }),
  /** Match keys with the same quantity in the file and the app. */
  unchangedCount: z.number().int().nonnegative(),
  unknownRows: z.array(UnknownRow),
  invalidRows: z.array(InvalidRow),
  /** Scryfall couldn't be reached, so rows the app doesn't know weren't looked up. */
  lookupFailed: z.boolean(),
});
export type UpdatePreview = z.infer<typeof UpdatePreview>;

/** POST /api/imports/manabox/update-apply */
export const ManaBoxUpdateApplyRequest = z.object({
  previewId: z.string(),
  /** Flagged deck-box stacks Jeff chose to remove; every other flagged copy is kept. */
  removeFlagged: z.array(Id),
  fixes: RowFixes,
  skips: z.array(RowNumber),
});
export type ManaBoxUpdateApplyRequest = z.infer<typeof ManaBoxUpdateApplyRequest>;

/** The answer to the update apply. An expired preview answers 410 `preview_expired`. */
export const ManaBoxUpdateApplyResult = ActionResult.extend({
  importId: Id,
});
export type ManaBoxUpdateApplyResult = z.infer<typeof ManaBoxUpdateApplyResult>;
