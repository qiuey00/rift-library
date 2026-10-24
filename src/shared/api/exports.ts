import { z } from 'zod';

// Exports: the whole collection as a CSV file, and a deck or a location as a deck list. Routes
// in src/server/routes/exports.ts.

/**
 * The header row of GET /api/exports/collection.csv: the printing, finish and copy details,
 * then the location's path and Proxy. One row per copy stack.
 */
export const COLLECTION_CSV_COLUMNS = [
  'Name',
  'Set code',
  'Set name',
  'Collector number',
  'Foil',
  'Rarity',
  'Quantity',
  'Printing ID',
  'Purchase price',
  'Misprint',
  'Altered',
  'Condition',
  'Language',
  'Purchase price currency',
  'Location',
  'Proxy',
] as const;

/**
 * GET /api/exports/decks/:id/deck-list and GET /api/exports/locations/:id/deck-list. The same
 * text comes as a file from the same address ending in `.txt`.
 *
 * A deck's list is in the format the import reads, board by board, each line with its picked
 * printing (or printing hint) and its tags (EXP-1). A location's list, meant for the trade
 * binder, has one line per printing and finish with its quantity, the location and every
 * location inside it, proxies left out (EXP-2).
 */
export const DeckListExport = z.object({
  /** Such as "Jinx Burn.txt". */
  fileName: z.string(),
  text: z.string(),
  /** Cards on the list, by quantity, runes and the maybe board left out. */
  cardCount: z.number().int().nonnegative(),
  /** Runes on the list; 0 for a location. */
  runeCount: z.number().int().nonnegative(),
  /** Cards on the maybe board; 0 for a location, or when `maybe` is '0'. */
  maybeCount: z.number().int().nonnegative(),
  /** Card lines on the list, headings left out. */
  lineCount: z.number().int().nonnegative(),
});
export type DeckListExport = z.infer<typeof DeckListExport>;

/** GET /api/exports/decks/:id/deck-list(.txt) query. */
export const DeckListExportQuery = z.object({
  /** '1' (the default) writes each slot's tags, such as "#Removal". */
  tags: z.enum(['0', '1']).default('1'),
  /** '1' (the default) adds the maybe board. */
  maybe: z.enum(['0', '1']).default('1'),
});
export type DeckListExportQuery = z.infer<typeof DeckListExportQuery>;
