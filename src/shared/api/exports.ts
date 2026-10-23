// Exports: the whole collection as a CSV file. Routes in src/server/routes/exports.ts.

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
