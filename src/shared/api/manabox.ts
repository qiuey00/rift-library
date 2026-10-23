import { z } from 'zod';
import { ActionResult, Id, LocationRef, LocationType } from './common';

// Importing a ManaBox CSV by adding its copies (COL-1, COL-2, COL-10, COL-11). Two steps: the
// preview reads the file and writes nothing, then the apply adds the copies in one transaction.

/** The row's number as a spreadsheet shows it: the header is row 1, so the first card is row 2. */
export const RowNumber = z.number().int().min(2);
export type RowNumber = z.infer<typeof RowNumber>;

/** A row whose printing neither the app nor Scryfall knows, for Jeff to fix or skip. */
export const UnknownRow = z.object({
  row: RowNumber,
  name: z.string(),
  setCode: z.string(),
  collectorNumber: z.string(),
  /** Null when the row has no Scryfall ID and set code with collector number found nothing. */
  scryfallId: z.string().nullable(),
  quantity: z.number().int().positive(),
});
export type UnknownRow = z.infer<typeof UnknownRow>;

/** A row with a value the app can't use, such as quantity "abc". The import always skips it. */
export const InvalidRow = z.object({
  row: RowNumber,
  name: z.string(),
  setCode: z.string(),
  collectorNumber: z.string(),
  /** Written for Jeff, such as "Quantity is \"abc\", not a number". */
  reason: z.string(),
});
export type InvalidRow = z.infer<typeof InvalidRow>;

/** Jeff's choices for unknown rows: row number to the Scryfall ID of the printing Jeff picked. */
export const RowFixes = z.record(RowNumber, z.string());
export type RowFixes = z.infer<typeof RowFixes>;

/** ManaBox's Binder Type column. Rows of a list are cards Jeff doesn't own and are never imported. */
export const ManaBoxBinderType = z.enum(['binder', 'deck', 'list']);
export type ManaBoxBinderType = z.infer<typeof ManaBoxBinderType>;

/** One ManaBox binder, deck or list named in the file's Binder Name and Binder Type columns. */
export const ManaBoxBinder = z.object({
  /** Made from the binder's type and name; the apply request maps it to a location. */
  key: z.string(),
  name: z.string(),
  type: ManaBoxBinderType,
  rowCount: z.number().int().nonnegative(),
  cardCount: z.number().int().nonnegative(),
  /** The location this binder went to last time (the remembered mapping); always null for a list. */
  mappedLocation: LocationRef.nullable(),
});
export type ManaBoxBinder = z.infer<typeof ManaBoxBinder>;

/** POST /api/imports/manabox/preview, multipart. */
export const ManaBoxPreviewRequest = z.object({
  file: z.instanceof(File),
});
export type ManaBoxPreviewRequest = z.infer<typeof ManaBoxPreviewRequest>;

/**
 * The answer to the preview. A file without the required columns answers 400
 * `missing_columns` instead, with a message naming the columns expected.
 */
export const ManaBoxPreview = z.object({
  /** Where the server keeps the parsed rows until the apply. Not a database id. */
  previewId: z.string(),
  fileName: z.string(),
  hasBinderColumn: z.boolean(),
  hasProxyColumn: z.boolean(),
  /** Card rows in the file, list rows included. */
  rowCount: z.number().int().nonnegative(),
  /** The sum of the rows' quantities, list rows included. */
  cardCount: z.number().int().nonnegative(),
  /** Empty when the file has no Binder Name column. */
  binders: z.array(ManaBoxBinder),
  unknownRows: z.array(UnknownRow),
  invalidRows: z.array(InvalidRow),
  /** Scryfall couldn't be reached, so rows the app doesn't know weren't looked up. */
  lookupFailed: z.boolean(),
});
export type ManaBoxPreview = z.infer<typeof ManaBoxPreview>;

/** A location to create for a binder, in the same transaction as the import. */
export const NewLocation = z.object({
  name: z.string().trim().min(1),
  /** There is only one "to sort" inbox, so a new location can't be one. */
  type: LocationType.exclude(['inbox']),
  parentId: Id.optional(),
});
export type NewLocation = z.infer<typeof NewLocation>;

/** POST /api/imports/manabox/apply */
export const ManaBoxApplyRequest = z.object({
  previewId: z.string(),
  /** Where every row goes when the file has no binders. */
  targetLocationId: Id.optional(),
  /** Binder key to an existing location, when the file has binders. */
  destinations: z.record(z.string(), Id).optional(),
  /** Binder key to a location to create for it, when the file has binders. */
  newLocations: z.record(z.string(), NewLocation).optional(),
  /** "These are all proxies", for files without a Proxy column. */
  allProxies: z.boolean(),
  fixes: RowFixes,
  /** Row numbers Jeff chose not to import. */
  skips: z.array(RowNumber),
});
export type ManaBoxApplyRequest = z.infer<typeof ManaBoxApplyRequest>;

/**
 * The answer to the apply. A preview the server no longer holds (applied already, too old, or
 * from before a restart) answers 410 `preview_expired`.
 */
export const ManaBoxApplyResult = ActionResult.extend({
  importId: Id,
  /** Cards added. */
  cardCount: z.number().int().nonnegative(),
  /** Rows not imported: the ones Jeff skipped, invalid rows and list rows. */
  skippedCount: z.number().int().nonnegative(),
});
export type ManaBoxApplyResult = z.infer<typeof ManaBoxApplyResult>;
