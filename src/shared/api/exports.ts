import { z } from 'zod';

// Exports: the whole collection as a CSV file, and a deck or a location as Moxfield's import
// text. Routes in src/server/routes/exports.ts.

const Count = z.number().int().nonnegative();

/**
 * GET /api/exports/decks/:id/moxfield and GET /api/exports/locations/:id/moxfield. The `.txt`
 * routes send the same `text` as a `text/plain` attachment named `fileName`.
 */
export const MoxfieldExport = z.object({
  /** Such as "Hearthhull.txt". */
  fileName: z.string(),
  /** Moxfield's import text, one line per card, such as "1 Arcane Signet (EOC) 53 #ramp". */
  text: z.string(),
  /** Cards on the main deck and commander, or in the location. */
  cardCount: Count,
  /** Cards on the maybe board; 0 for a location, or when `maybe` is '0'. */
  maybeCount: Count,
  /** Card lines in `text`. */
  lineCount: Count,
});
export type MoxfieldExport = z.infer<typeof MoxfieldExport>;

/** GET /api/exports/decks/:id/moxfield(.txt) query. */
export const DeckExportQuery = z.object({
  /** '1' (the default) writes each slot's tags, such as "#ramp" (lower case, each run of spaces as -). */
  tags: z.enum(['0', '1']).default('1'),
  /** '1' (the default) adds the maybe board. */
  maybe: z.enum(['0', '1']).default('1'),
});
export type DeckExportQuery = z.infer<typeof DeckExportQuery>;

/**
 * The header row of GET /api/exports/collection.csv: ManaBox's 15 columns in ManaBox's order,
 * then Binder Name (the location path), Binder Type ("binder") and Proxy, so the ManaBox import
 * with binder mapping can rebuild the collection. One row per copy stack.
 */
export const COLLECTION_CSV_COLUMNS = [
  'Name',
  'Set code',
  'Set name',
  'Collector number',
  'Foil',
  'Rarity',
  'Quantity',
  'ManaBox ID',
  'Scryfall ID',
  'Purchase price',
  'Misprint',
  'Altered',
  'Condition',
  'Language',
  'Purchase price currency',
  'Binder Name',
  'Binder Type',
  'Proxy',
] as const;
