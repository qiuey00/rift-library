import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Finish } from '../../../shared/api/common';
import type { DeckRef } from '../../../shared/api/decks';
import type {
  FlaggedCopy,
  ManaBoxUpdateApplyRequest,
  ManaBoxUpdateApplyResult,
  UpdatePreview,
  UpdateRow,
} from '../../../shared/api/manabox-update';
import type { Db } from '../../db/database';
import { cards, copyStacks, imports, locations, printings } from '../../db/schema';
import { AppError } from '../../errors';
import { cardImages, cardSummary, printingSummary } from '../../queries/decks';
import { deckForBox } from '../../queries/location-tree';
import { locationPaths } from '../../queries/locations';
import { locationRef } from '../../queries/put-away';
import { addCopies, createBatch, printingExists, removeCopies } from '../copies';
import { matchManaBoxRows } from './manabox-match';
import {
  type InvalidManaBoxRow,
  type ManaBoxCsv,
  type ManaBoxRow,
  parseManaBoxCsv,
} from './manabox-parse';
import { PreviewStore } from './previews';

// Updating one location L from a ManaBox CSV that describes it (COL-3, COL-4). The copies that
// belong to L are its own stacks plus stacks in deck boxes whose came-from location is L
// (D-16). The file and those copies are compared per match key; the preview writes nothing and
// the apply works the comparison out again in one transaction. Removals take L's own copies
// first; deck-box copies are only removed when Jeff chose to (D-17).

interface HeldUpdate {
  fileName: string;
  csv: ManaBoxCsv;
  /** The parser's row number to the printing found for it. */
  matched: Map<number, string>;
  locationId: number;
}

const previews = new PreviewStore<HeldUpdate>();

/** The parser counts the first card row as 1; Jeff's spreadsheet shows it as row 2. */
const sheetRow = (row: { row: number }) => row.row + 1;

/** What a file row and a stack are matched on: not the proxy flag, not the price. */
interface MatchKey {
  scryfallId: string;
  finish: Finish;
  condition: string;
  language: string;
  misprint: boolean;
  altered: boolean;
}

const keyOf = (k: MatchKey) =>
  `${k.scryfallId}:${k.finish}:${k.condition}:${k.language}:${k.misprint ? 1 : 0}:${k.altered ? 1 : 0}`;

type Stack = typeof copyStacks.$inferSelect;

/** A deck-box stack that came from L, with the deck whose box it is in. */
interface BoxedStack {
  stack: Stack;
  deck: DeckRef;
}

type Group = 'new' | 'raised' | 'lowered' | 'missing' | 'unchanged';

/** One match key, compared. */
interface Entry {
  group: Group;
  match: MatchKey;
  /** The file rows with this key and the printing each stands for. */
  fileRows: ManaBoxRow[];
  fileQuantity: number;
  appQuantity: number;
  /** L's own stacks with this key, proxies first, so real copies are the last removed. */
  own: Stack[];
  boxed: BoxedStack[];
  /** For lowered and missing keys: the deck-box copies the removal would reach. */
  flagged: FlaggedCopy[];
}

export async function previewManaBoxUpdate(
  db: Db,
  file: File,
  locationId: number,
): Promise<UpdatePreview> {
  liveLocation(db, locationId);
  const csv = parseManaBoxCsv(await file.text());
  const invalid = csv.rows.filter((row): row is InvalidManaBoxRow => !row.valid);
  const { matched, unknown, lookupFailed } = await matchManaBoxRows(db, ownedRows(csv));

  const keep = { keys: new Set<string>(), printings: invalidPrintings(db, invalid) };
  const entries = compare(db, locationId, resolvedRows(csv, matched, new Set()), keep);
  const previewId = previews.put({ fileName: file.name, csv, matched, locationId });

  const rows = updateRows(db, entries);
  const groupOf = (group: Group) =>
    entries.flatMap((entry, i) => (entry.group === group ? [rows[i] as UpdateRow] : []));
  return {
    previewId,
    location: locationRef(db, locationId, locationPaths(db)),
    groups: {
      new: groupOf('new'),
      raised: groupOf('raised'),
      lowered: groupOf('lowered'),
      missing: groupOf('missing'),
    },
    unchangedCount: entries.filter((entry) => entry.group === 'unchanged').length,
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

export function applyManaBoxUpdate(
  db: Db,
  body: ManaBoxUpdateApplyRequest,
): ManaBoxUpdateApplyResult {
  const preview = previews.get(body.previewId);
  const result = db.transaction((tx) => applyPreview(tx, preview, body));
  previews.delete(body.previewId);
  return result;
}

function applyPreview(
  db: Db,
  preview: HeldUpdate,
  body: ManaBoxUpdateApplyRequest,
): ManaBoxUpdateApplyResult {
  const { csv, locationId } = preview;
  liveLocation(db, locationId);
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
  const resolved = new Map(preview.matched);
  for (const row of ownedRows(csv)) {
    const fix = fixes.get(sheetRow(row));
    if (fix) resolved.set(row.row, fix);
  }

  const unresolved = ownedRows(csv)
    .filter((row) => !skips.has(sheetRow(row)) && !resolved.has(row.row))
    .map(sheetRow);
  if (unresolved.length > 0) {
    throw new AppError(
      400,
      'unknown_rows',
      unresolved.length === 1
        ? `Fix or skip row ${unresolved[0]} first: its card isn't known.`
        : `Fix or skip rows ${unresolved.join(', ')} first: their cards aren't known.`,
    );
  }

  const invalid = csv.rows.filter((row): row is InvalidManaBoxRow => !row.valid);
  const keep = { keys: new Set<string>(), printings: invalidPrintings(db, invalid) };
  for (const row of ownedRows(csv)) {
    const scryfallId = resolved.get(row.row);
    if (skips.has(sheetRow(row)) && scryfallId) keep.keys.add(keyOf({ ...row, scryfallId }));
  }
  const compared = resolvedRows(csv, resolved, skips);
  const entries = compare(db, locationId, compared, keep);

  const cardCount = compared.reduce((sum, { row }) => sum + row.quantity, 0);
  const importId = db
    .insert(imports)
    .values({
      kind: 'manabox_update',
      fileName: preview.fileName,
      targetLocationId: locationId,
      rowCount: csv.rowCount,
      cardCount,
      skippedCount: csv.rowCount - compared.length,
    })
    .returning({ id: imports.id })
    .get().id;
  const batchId = createBatch(db, 'import', { importId });
  const locationDeck = deckForBox(db, locationId)?.id;
  const removeFlagged = new Set(body.removeFlagged);

  let added = 0;
  let removed = 0;
  for (const entry of entries) {
    const links = { reason: 'location_update' as const, batchId };
    if (entry.group === 'new') {
      for (const row of entry.fileRows) {
        addCopies(db, {
          ...entry.match,
          quantity: row.quantity,
          purchasePrice: row.purchasePrice ?? undefined,
          purchaseCurrency: row.purchaseCurrency ?? undefined,
          locationId,
          isProxy: row.isProxy ?? false,
          deckId: locationDeck,
          ...links,
        });
        added += row.quantity;
      }
    } else if (entry.group === 'raised') {
      const quantity = entry.fileQuantity - entry.appQuantity;
      // Onto L's real stack if it has one; with every copy in deck boxes, a new stack in L
      // takes their proxy flag and the file's price.
      const alike = entry.own.length > 0 ? entry.own : entry.boxed.map(({ stack }) => stack);
      const isProxy = alike.every((stack) => stack.isProxy);
      const priced =
        entry.own.length > 0 ? undefined : entry.fileRows.find((row) => row.purchasePrice !== null);
      addCopies(db, {
        ...entry.match,
        quantity,
        purchasePrice: priced?.purchasePrice ?? undefined,
        purchaseCurrency: priced?.purchaseCurrency ?? undefined,
        locationId,
        isProxy,
        deckId: locationDeck,
        ...links,
      });
      added += quantity;
    } else if (entry.group === 'lowered' || entry.group === 'missing') {
      let rest = entry.appQuantity - entry.fileQuantity;
      for (const stack of entry.own) {
        if (rest === 0) break;
        const quantity = Math.min(rest, stack.quantity);
        removeCopies(db, stack.id, quantity, { ...links, deckId: locationDeck });
        rest -= quantity;
        removed += quantity;
      }
      for (const flagged of entry.flagged) {
        if (!removeFlagged.has(flagged.stackId)) continue;
        removeCopies(db, flagged.stackId, flagged.quantity, { ...links, deckId: flagged.deck.id });
        removed += flagged.quantity;
      }
    }
  }

  const name = locationName(db, locationId);
  const message =
    added === 0 && removed === 0
      ? `${name} is already up to date`
      : `Updated ${name}: ${cardsText(added)} added, ${removed.toLocaleString('en-US')} removed`;
  return { message, batchId: added + removed > 0 ? batchId : null, importId };
}

/** Valid rows of cards Jeff owns: list rows are never imported. */
function ownedRows(csv: ManaBoxCsv): ManaBoxRow[] {
  return csv.rows.filter((row): row is ManaBoxRow => row.valid && row.binderType !== 'list');
}

/** The printings invalid rows name, by Scryfall ID or by set code and collector number. */
function invalidPrintings(db: Db, rows: InvalidManaBoxRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.scryfallId) {
      ids.add(row.scryfallId);
      continue;
    }
    if (!row.setCode || !row.collectorNumber) continue;
    for (const { id } of db
      .select({ id: printings.scryfallId })
      .from(printings)
      .where(
        and(
          eq(sql`lower(${printings.setCode})`, row.setCode.toLowerCase()),
          eq(sql`lower(${printings.collectorNumber})`, row.collectorNumber.toLowerCase()),
        ),
      )
      .all()) {
      ids.add(id);
    }
  }
  return ids;
}

/** The owned rows that take part in the comparison, each with its printing. */
function resolvedRows(
  csv: ManaBoxCsv,
  resolved: Map<number, string>,
  skips: Set<number>,
): { row: ManaBoxRow; scryfallId: string }[] {
  return ownedRows(csv).flatMap((row) => {
    const scryfallId = resolved.get(row.row);
    return scryfallId && !skips.has(sheetRow(row)) ? [{ row, scryfallId }] : [];
  });
}

/**
 * What a row left out of the comparison protects: skipped rows their match key, invalid rows
 * (whose key can't be read) every key of their printing. Such keys are never lowered or
 * missing, so leaving a row out never removes copies.
 */
interface Keep {
  keys: Set<string>;
  printings: Set<string>;
}

/**
 * The file's totals per match key against the copies that belong to L, ordered by card name,
 * then set and collector number. Unchanged keys are kept, for counting.
 */
function compare(
  db: Db,
  locationId: number,
  fileRows: { row: ManaBoxRow; scryfallId: string }[],
  keep: Keep,
): Entry[] {
  const entries = new Map<string, Entry>();
  const entryFor = (match: MatchKey) => {
    const key = keyOf(match);
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        group: 'unchanged',
        match,
        fileRows: [],
        fileQuantity: 0,
        appQuantity: 0,
        own: [],
        boxed: [],
        flagged: [],
      };
      entries.set(key, entry);
    }
    return entry;
  };

  for (const { row, scryfallId } of fileRows) {
    const match = matchKey({ ...row, scryfallId });
    const entry = entryFor(match);
    entry.fileRows.push(row);
    entry.fileQuantity += row.quantity;
  }

  const decks = new Map<number, DeckRef | undefined>();
  for (const { stack, type } of belongingStacks(db, locationId)) {
    const match = matchKey(stack);
    if (stack.locationId === locationId) {
      entryFor(match).own.push(stack);
    } else {
      if (type !== 'deck_box') continue;
      if (!decks.has(stack.locationId)) {
        decks.set(stack.locationId, deckForBox(db, stack.locationId));
      }
      const deck = decks.get(stack.locationId);
      // A deck box without a live deck holds nobody's copies, so they aren't counted.
      if (!deck) continue;
      entryFor(match).boxed.push({ stack, deck });
    }
    entryFor(match).appQuantity += stack.quantity;
  }

  for (const [key, entry] of entries) {
    entry.own.sort((a, b) => Number(b.isProxy) - Number(a.isProxy) || a.id - b.id);
    entry.boxed.sort((a, b) => a.stack.id - b.stack.id);
    entry.group =
      entry.appQuantity === 0
        ? 'new'
        : entry.fileQuantity === 0
          ? 'missing'
          : entry.fileQuantity > entry.appQuantity
            ? 'raised'
            : entry.fileQuantity < entry.appQuantity
              ? 'lowered'
              : 'unchanged';
    const removes = entry.group === 'lowered' || entry.group === 'missing';
    if (removes && (keep.keys.has(key) || keep.printings.has(entry.match.scryfallId))) {
      entries.delete(key);
      continue;
    }
    if (removes) {
      const ownQuantity = entry.own.reduce((sum, stack) => sum + stack.quantity, 0);
      let rest = entry.appQuantity - entry.fileQuantity - ownQuantity;
      for (const { stack, deck } of entry.boxed) {
        if (rest <= 0) break;
        const quantity = Math.min(rest, stack.quantity);
        entry.flagged.push({ stackId: stack.id, deck, quantity });
        rest -= quantity;
      }
    }
  }

  const named = cardNames(
    db,
    [...entries.values()].map((entry) => entry.match.scryfallId),
  );
  const sortKey = (entry: Entry) => named.get(entry.match.scryfallId)?.sortKey ?? '';
  return [...entries.values()].sort(
    (a, b) => sortKey(a).localeCompare(sortKey(b)) || keyOf(a.match).localeCompare(keyOf(b.match)),
  );
}

function matchKey(k: MatchKey): MatchKey {
  return {
    scryfallId: k.scryfallId,
    finish: k.finish,
    condition: k.condition,
    language: k.language,
    misprint: k.misprint,
    altered: k.altered,
  };
}

/** L's own stacks and the stacks whose came-from location is L, with their location's type. */
function belongingStacks(db: Db, locationId: number) {
  return db
    .select({ stack: copyStacks, type: locations.type })
    .from(copyStacks)
    .innerJoin(locations, eq(locations.id, copyStacks.locationId))
    .where(
      and(
        isNull(locations.deletedAt),
        or(eq(copyStacks.locationId, locationId), eq(copyStacks.cameFromLocationId, locationId)),
      ),
    )
    .all();
}

/** Each printing's card name with its set and number, for ordering the rows. */
function cardNames(db: Db, scryfallIds: string[]) {
  const names = new Map<string, { sortKey: string }>();
  const unique = [...new Set(scryfallIds)];
  if (unique.length === 0) return names;
  for (const row of db
    .select({
      scryfallId: printings.scryfallId,
      name: cards.name,
      setCode: printings.setCode,
      collectorNumber: printings.collectorNumber,
    })
    .from(printings)
    .innerJoin(cards, eq(cards.oracleId, printings.oracleId))
    .where(inArray(printings.scryfallId, unique))
    .all()) {
    names.set(row.scryfallId, {
      sortKey: `${row.name.toLowerCase()}\u0000${row.setCode}\u0000${row.collectorNumber.padStart(8, '0')}`,
    });
  }
  return names;
}

/** The entries as the API shows them, in the same order. */
function updateRows(db: Db, entries: Entry[]): UpdateRow[] {
  const ids = [...new Set(entries.map((entry) => entry.match.scryfallId))];
  if (ids.length === 0) return [];
  const printingRows = new Map(
    db
      .select()
      .from(printings)
      .where(inArray(printings.scryfallId, ids))
      .all()
      .map((row) => [row.scryfallId, row]),
  );
  const oracleIds = [...new Set([...printingRows.values()].map((row) => row.oracleId))];
  const cardRows = new Map(
    db
      .select()
      .from(cards)
      .where(inArray(cards.oracleId, oracleIds))
      .all()
      .map((row) => [row.oracleId, row]),
  );
  const images = cardImages(db, oracleIds);
  return entries.map((entry) => {
    const printing = printingRows.get(entry.match.scryfallId);
    const card = printing && cardRows.get(printing.oracleId);
    if (!printing || !card) throw new Error(`Printing ${entry.match.scryfallId} is missing`);
    return {
      key: keyOf(entry.match),
      card: cardSummary(card, images.get(card.oracleId)),
      printing: printingSummary(printing),
      finish: entry.match.finish,
      condition: entry.match.condition,
      language: entry.match.language,
      misprint: entry.match.misprint,
      altered: entry.match.altered,
      fileQuantity: entry.fileQuantity,
      appQuantity: entry.appQuantity,
      flagged: entry.flagged,
    };
  });
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
    'the location'
  );
}

function cardsText(count: number) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'card' : 'cards'}`;
}
