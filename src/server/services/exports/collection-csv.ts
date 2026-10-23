import { asc, eq, sql } from 'drizzle-orm';
import type { Finish } from '../../../shared/api/common';
import { COLLECTION_CSV_COLUMNS } from '../../../shared/api/exports';
import type { Db } from '../../db/database';
import { cards, copyStacks, printings } from '../../db/schema';
import { locationPaths } from '../../queries/locations';

// The whole collection as a CSV backup (PLAT-7), one row per copy stack, with each location's
// path. Rows are written a location at a time, so the whole file is never held in memory.

type Column = (typeof COLLECTION_CSV_COLUMNS)[number];

/** Finishes as the file writes them. */
const FOIL: Record<Finish, string> = { nonfoil: 'normal', foil: 'foil', etched: 'etched' };

/** The header, then each location's copy stacks in tree order, each by name. */
export function* collectionCsv(db: Db): Generator<string> {
  yield csvLine(COLLECTION_CSV_COLUMNS);
  for (const [locationId, path] of locationPaths(db)) {
    const stacks = db
      .select({
        name: cards.name,
        setCode: printings.setCode,
        setName: printings.setName,
        collectorNumber: printings.collectorNumber,
        rarity: printings.rarity,
        stack: copyStacks,
      })
      .from(copyStacks)
      .innerJoin(printings, eq(printings.printingId, copyStacks.printingId))
      .innerJoin(cards, eq(cards.oracleId, printings.oracleId))
      .where(eq(copyStacks.locationId, locationId))
      .orderBy(
        sql`${cards.name} COLLATE NOCASE`,
        printings.setCode,
        printings.collectorNumber,
        asc(copyStacks.id),
      )
      .all();
    if (stacks.length === 0) continue;
    yield stacks
      .map(({ stack, ...card }) => {
        const row: Record<Column, string> = {
          Name: card.name,
          'Set code': card.setCode.toUpperCase(),
          'Set name': card.setName,
          'Collector number': card.collectorNumber,
          Foil: FOIL[stack.finish],
          Rarity: card.rarity,
          Quantity: String(stack.quantity),
          'Printing ID': stack.printingId,
          'Purchase price': stack.purchasePrice === null ? '' : String(stack.purchasePrice),
          Misprint: String(stack.misprint),
          Altered: String(stack.altered),
          Condition: stack.condition,
          Language: stack.language,
          'Purchase price currency': stack.purchaseCurrency ?? '',
          Location: path,
          Proxy: String(stack.isProxy),
        };
        return csvLine(COLLECTION_CSV_COLUMNS.map((column) => row[column]));
      })
      .join('');
  }
}

/** One CSV line with its line break, quoting values that hold a comma, quote or line break. */
function csvLine(values: readonly string[]): string {
  return `${values.map((value) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)).join(',')}\n`;
}

/** Such as "rift-library-2026-10-20.csv", with the computer's own date. */
export function collectionCsvFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `rift-library-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
