import { and, eq, isNull } from 'drizzle-orm';
import type {
  ManaBoxApplyRequest,
  ManaBoxApplyResult,
  ManaBoxBinder,
  ManaBoxPreview,
} from '../../../shared/api/manabox';
import type { Db } from '../../db/database';
import { binderMappings, imports, locations } from '../../db/schema';
import { AppError } from '../../errors';
import { deckForBox } from '../../queries/location-tree';
import { locationPaths } from '../../queries/locations';
import { inboxId, locationRef } from '../../queries/put-away';
import { addCopies, createBatch, printingExists } from '../copies';
import { createLocation } from '../locations';
import { matchManaBoxRows } from './manabox-match';
import {
  type BinderType,
  type InvalidManaBoxRow,
  type ManaBoxCsv,
  type ManaBoxRow,
  parseManaBoxCsv,
} from './manabox-parse';
import { PreviewStore } from './previews';

// Importing a ManaBox CSV by adding its copies (COL-1, COL-2, COL-10, COL-11): the preview
// reads the file and writes nothing; the apply adds every row's copies in one transaction.
// Importing the same file twice adds the copies twice (D-14).

interface HeldPreview {
  fileName: string;
  csv: ManaBoxCsv;
  /** The parser's row number to the printing found for it. */
  matched: Map<number, string>;
}

const previews = new PreviewStore<HeldPreview>();

/** The parser counts the first card row as 1; Jeff's spreadsheet shows it as row 2. */
const sheetRow = (row: { row: number }) => row.row + 1;

/** Made from the binder's type and name, such as "binder:Trade binder". */
export const binderKey = (type: BinderType, name: string) => `${type}:${name}`;

export async function previewManaBoxAdd(db: Db, file: File): Promise<ManaBoxPreview> {
  const csv = parseManaBoxCsv(await file.text());
  const valid = csv.rows.filter((row): row is ManaBoxRow => row.valid);
  const invalid = csv.rows.filter((row): row is InvalidManaBoxRow => !row.valid);
  // List rows are cards Jeff doesn't own: never imported, so never looked up.
  const owned = valid.filter((row) => row.binderType !== 'list');
  const { matched, unknown, lookupFailed } = await matchManaBoxRows(db, owned);

  const previewId = previews.put({ fileName: file.name, csv, matched });
  return {
    previewId,
    fileName: file.name,
    hasBinderColumn: csv.hasBinderColumn,
    hasProxyColumn: csv.hasProxyColumn,
    rowCount: csv.rowCount,
    cardCount: csv.cardCount,
    binders: csv.hasBinderColumn ? bindersOf(db, valid) : [],
    unknownRows: unknown.map((row) => ({
      row: sheetRow(row),
      name: row.name,
      setCode: row.setCode,
      collectorNumber: row.collectorNumber,
      scryfallId: row.scryfallId,
      quantity: row.quantity,
    })),
    invalidRows: invalid.map((row) => ({
      row: sheetRow(row),
      name: row.name,
      setCode: row.setCode,
      collectorNumber: row.collectorNumber,
      reason: row.reason,
    })),
    lookupFailed,
  };
}

/** The file's binders, decks and lists in the order they first appear, with their counts. */
function bindersOf(db: Db, rows: ManaBoxRow[]): ManaBoxBinder[] {
  const binders = new Map<string, ManaBoxBinder>();
  for (const row of rows) {
    if (row.binderName === null || row.binderType === null) continue;
    const key = binderKey(row.binderType, row.binderName);
    const binder = binders.get(key) ?? {
      key,
      name: row.binderName,
      type: row.binderType,
      rowCount: 0,
      cardCount: 0,
      mappedLocation: null,
    };
    binder.rowCount++;
    binder.cardCount += row.quantity;
    binders.set(key, binder);
  }

  const paths = locationPaths(db);
  for (const binder of binders.values()) {
    if (binder.type === 'list') continue;
    const mapped = db
      .select({ id: locations.id })
      .from(binderMappings)
      .innerJoin(locations, eq(locations.id, binderMappings.locationId))
      .where(
        and(
          eq(binderMappings.manaboxName, binder.name),
          eq(binderMappings.manaboxType, binder.type),
          isNull(locations.deletedAt),
        ),
      )
      .get();
    if (mapped) binder.mappedLocation = locationRef(db, mapped.id, paths);
  }
  return [...binders.values()];
}

/** One row's copies, ready to add. */
interface PlannedRow {
  row: ManaBoxRow;
  scryfallId: string;
  locationId: number;
}

export function applyManaBoxAdd(db: Db, body: ManaBoxApplyRequest): ManaBoxApplyResult {
  const preview = previews.get(body.previewId);
  const result = db.transaction((tx) => applyPreview(tx, preview, body));
  previews.delete(body.previewId);
  return result;
}

function applyPreview(db: Db, preview: HeldPreview, body: ManaBoxApplyRequest): ManaBoxApplyResult {
  const { csv } = preview;
  const fixes = new Map(
    Object.entries(body.fixes).map(([row, scryfallId]) => [Number(row), scryfallId]),
  );
  for (const scryfallId of new Set(fixes.values())) {
    if (!printingExists(db, scryfallId)) {
      throw new AppError(
        404,
        'printing_not_found',
        'A printing you picked is not in the card data',
      );
    }
  }
  const skips = new Set(body.skips);
  const destinationOf = csv.hasBinderColumn
    ? binderDestinations(db, csv, body)
    : singleDestination(db, body.targetLocationId);

  const planned: PlannedRow[] = [];
  const unresolved: ManaBoxRow[] = [];
  let skippedCount = 0;
  for (const row of csv.rows) {
    if (!row.valid || row.binderType === 'list' || skips.has(sheetRow(row))) {
      skippedCount++;
      continue;
    }
    const scryfallId = fixes.get(sheetRow(row)) ?? preview.matched.get(row.row);
    if (!scryfallId) {
      unresolved.push(row);
      continue;
    }
    planned.push({ row, scryfallId, locationId: destinationOf(row) });
  }
  if (unresolved.length > 0) {
    const rows = unresolved.map(sheetRow);
    throw new AppError(
      400,
      'unknown_rows',
      rows.length === 1
        ? `Fix or skip row ${rows[0]} first: its card isn't known.`
        : `Fix or skip rows ${rows.join(', ')} first: their cards aren't known.`,
    );
  }

  const cardCount = planned.reduce((sum, { row }) => sum + row.quantity, 0);
  const usedLocations = [...new Set(planned.map((p) => p.locationId))];
  const target = csv.hasBinderColumn
    ? usedLocations.length === 1
      ? usedLocations[0]
      : null
    : destinationOf(null);

  const importId = db
    .insert(imports)
    .values({
      kind: 'manabox_add',
      fileName: preview.fileName,
      targetLocationId: target,
      rowCount: csv.rowCount,
      cardCount,
      skippedCount,
    })
    .returning({ id: imports.id })
    .get().id;
  const batchId = createBatch(db, 'import', { importId });

  const deckIds = new Map<number, number | undefined>();
  for (const { row, scryfallId, locationId } of planned) {
    if (!deckIds.has(locationId)) deckIds.set(locationId, deckForBox(db, locationId)?.id);
    addCopies(db, {
      scryfallId,
      quantity: row.quantity,
      purchasePrice: row.purchasePrice ?? undefined,
      purchaseCurrency: row.purchaseCurrency ?? undefined,
      locationId,
      finish: row.finish,
      condition: row.condition,
      language: row.language,
      misprint: row.misprint,
      altered: row.altered,
      isProxy: row.isProxy ?? body.allProxies,
      reason: 'imported',
      batchId,
      deckId: deckIds.get(locationId),
    });
  }

  const cards = `${cardCount.toLocaleString('en-US')} ${cardCount === 1 ? 'card' : 'cards'}`;
  const where =
    target !== null
      ? locationName(db, target)
      : `${usedLocations.length.toLocaleString('en-US')} locations`;
  return { message: `Added ${cards} to ${where}`, batchId, importId, cardCount, skippedCount };
}

/** Without binders every row goes to the chosen location, or the "To sort" inbox. */
function singleDestination(db: Db, targetLocationId: number | undefined) {
  const locationId = targetLocationId ?? inboxId(db);
  liveLocation(db, locationId);
  return (_row: ManaBoxRow | null) => locationId;
}

/**
 * Each binder's location: the chosen one, or one created for it. Saves the mapping for the
 * next import. Every binder and deck in the file needs one; lists are never imported.
 */
function binderDestinations(db: Db, csv: ManaBoxCsv, body: ManaBoxApplyRequest) {
  const destinations = new Map<string, number>();
  for (const row of csv.rows) {
    if (!row.valid || row.binderName === null || row.binderType === null) continue;
    if (row.binderType === 'list') continue;
    const key = binderKey(row.binderType, row.binderName);
    if (destinations.has(key)) continue;

    const existing = body.destinations?.[key];
    const created = body.newLocations?.[key];
    let locationId: number;
    if (existing !== undefined) {
      locationId = liveLocation(db, existing);
    } else if (created) {
      locationId = createLocation(db, created).id;
    } else {
      throw new AppError(
        400,
        'missing_destination',
        `Choose where the ManaBox ${row.binderType} "${row.binderName}" goes.`,
      );
    }
    destinations.set(key, locationId);
    db.insert(binderMappings)
      .values({ manaboxName: row.binderName, manaboxType: row.binderType, locationId })
      .onConflictDoUpdate({
        target: [binderMappings.manaboxName, binderMappings.manaboxType],
        set: { locationId },
      })
      .run();
  }

  return (row: ManaBoxRow | null) => {
    const locationId =
      row?.binderType && row.binderName !== null
        ? destinations.get(binderKey(row.binderType, row.binderName))
        : undefined;
    if (locationId === undefined) throw new Error('A row has no binder to import into.');
    return locationId;
  };
}

/** A live location's id, or 404. */
function liveLocation(db: Db, id: number): number {
  const row = db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.id, id), isNull(locations.deletedAt)))
    .get();
  if (!row) throw new AppError(404, 'location_not_found', 'That location no longer exists.');
  return row.id;
}

function locationName(db: Db, id: number): string {
  return (
    db.select({ name: locations.name }).from(locations).where(eq(locations.id, id)).get()?.name ??
    'the collection'
  );
}
