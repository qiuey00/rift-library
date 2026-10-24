import { type SQL, sql } from 'drizzle-orm';
import type { Finish, LocationRef, LocationType, StackRow } from '../../shared/api/common';
import type { DeckRef } from '../../shared/api/decks';
import type { CardCopies, LocationStacks, StacksPage, StacksQuery } from '../../shared/api/stacks';
import type { CollectionFilter } from '../../shared/collection-query';
import type { Db } from '../db/database';
import { AppError } from '../errors';
import {
  type CardRecord,
  cardColumnsSql,
  type PrintingRecord,
  printingColumnsSql,
  toCardSummary,
  toPrintingSummary,
} from './card-summaries';
import { locationNode } from './location-tree';
import { descendantIds, locationPaths, locationTradeFlags, treeOrder } from './locations';
import { noPriceSql, stackValue, stackValueSql, unitPriceSql } from './value';

// Lists of copy stacks: the Collection screen's search, a location's contents and a card's
// copies. Every list is sorted by card name, then set, then collector number (as a number
// first, so 9 comes before 10), then stack id; the Collection's search can sort other ways.

/** The columns a `StackRow` is built from, as one query returns them. */
type StackRecord = CardRecord &
  PrintingRecord & {
    stackId: number;
    quantity: number;
    finish: Finish;
    condition: string;
    language: string;
    misprint: number;
    altered: number;
    isProxy: number;
    locationId: number;
    cameFromLocationId: number | null;
    unitPrice: number | null;
  };

const columns = sql`
  s.id AS stackId, s.quantity, s.finish, s.condition, s.language, s.misprint, s.altered,
  s.is_proxy AS isProxy, s.location_id AS locationId,
  s.came_from_location_id AS cameFromLocationId,
  ${cardColumnsSql}, ${printingColumnsSql}, ${unitPriceSql} AS unitPrice`;

const from = sql`
  FROM copy_stacks AS s
  JOIN printings AS p ON p.riftcodex_id = s.printing_id
  JOIN cards AS c ON c.id = p.card_id`;

/** The name order: card name, then set, then collector number (as a number first), then id. */
const byName = [
  sql`lower(c.name)`,
  sql`p.set_code`,
  sql`CAST(p.collector_number AS INTEGER)`,
  sql`p.collector_number`,
];

type Sort = StacksQuery['sort'];

/**
 * A sort as the row value a cursor can say "after this row" of: every part goes the same
 * way, so `value` is negated to go highest first, and `recent` goes backwards.
 */
function sortKeys(db: Db, sort: Sort): { keys: SQL[]; descending: boolean } {
  switch (sort) {
    case 'name':
      return { keys: [...byName, sql`s.id`], descending: false };
    case 'value':
      return { keys: [sql`-${stackValueSql}`, ...byName, sql`s.id`], descending: false };
    case 'location': {
      const order = treeOrder(db);
      const index =
        order.length === 0
          ? sql`0`
          : sql`(CASE s.location_id ${sql.join(
              order.map((id, i) => sql`WHEN ${id} THEN ${i}`),
              sql` `,
            )} ELSE ${order.length} END)`;
      return { keys: [index, ...byName, sql`s.id`], descending: false };
    }
    case 'set':
      return {
        keys: [
          sql`p.set_code`,
          sql`CAST(p.collector_number AS INTEGER)`,
          sql`p.collector_number`,
          sql`lower(c.name)`,
          sql`s.id`,
        ],
        descending: false,
      };
    case 'recent':
      return { keys: [sql`s.created_at`, sql`s.id`], descending: true };
  }
}

const orderBy = sql`ORDER BY ${sql.join(byName, sql`, `)}, s.id`;

function encodeCursor(sortKey: string): string {
  return Buffer.from(sortKey).toString('base64url');
}

function decodeCursor(text: string, length: number): (string | number)[] {
  try {
    const value: unknown = JSON.parse(Buffer.from(text, 'base64url').toString());
    if (
      Array.isArray(value) &&
      value.length === length &&
      value.every((part) => typeof part === 'string' || typeof part === 'number')
    ) {
      return value;
    }
  } catch {
    // Falls through to the error below.
  }
  throw new AppError(
    400,
    'invalid_cursor',
    'That page of the collection is out of date. Search again.',
  );
}

/** What every stack row needs to know about locations, loaded once per request. */
type Places = {
  refs: Map<number, LocationRef>;
  deckByBox: Map<number, DeckRef>;
};

function loadPlaces(db: Db): Places {
  const rows = db.all<{
    id: number;
    name: string;
    type: LocationType;
    parentId: number | null;
    color: string | null;
  }>(sql`SELECT id, name, type, parent_id AS parentId, color FROM locations`);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const paths = locationPaths(db);
  const trade = locationTradeFlags(db);

  const colors = new Map<number, string | null>();
  const colorOf = (id: number | null, seen = 0): string | null => {
    if (id === null || seen > byId.size) return null;
    const known = colors.get(id);
    if (known !== undefined) return known;
    const row = byId.get(id);
    const color = row ? (row.color ?? colorOf(row.parentId, seen + 1)) : null;
    colors.set(id, color);
    return color;
  };

  const refs = new Map<number, LocationRef>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        type: row.type,
        // A deleted location (still named as a came-from) has no tree path; its name stands in.
        path: paths.get(row.id) ?? row.name,
        color: colorOf(row.id),
        forTrade: trade.get(row.id) ?? false,
      },
    ]),
  );

  const deckByBox = new Map(
    db
      .all<{ id: number; name: string; deckBoxId: number }>(
        sql`SELECT id, name, deck_box_id AS deckBoxId FROM decks WHERE deleted_at IS NULL`,
      )
      .map((deck) => [deck.deckBoxId, { id: deck.id, name: deck.name }]),
  );

  return { refs, deckByBox };
}

function toRow(record: StackRecord, places: Places): StackRow {
  const location = places.refs.get(record.locationId);
  if (!location) throw new Error(`Location ${record.locationId} is missing.`);
  const deck = location.type === 'deck_box' ? places.deckByBox.get(location.id) : undefined;
  return {
    stackId: record.stackId,
    quantity: record.quantity,
    card: toCardSummary(record),
    printing: toPrintingSummary(record),
    finish: record.finish,
    condition: record.condition,
    language: record.language,
    misprint: record.misprint === 1,
    altered: record.altered === 1,
    isProxy: record.isProxy === 1,
    location,
    cameFrom:
      record.cameFromLocationId === null
        ? null
        : (places.refs.get(record.cameFromLocationId) ?? null),
    inDeck: deck ? { deckId: deck.id, deckName: deck.name } : null,
    unitPrice: record.unitPrice,
    value: stackValue(record.quantity, record.unitPrice, record.isProxy === 1),
  };
}

/** Stack rows matching `where`, in the list order. */
function stackRows(db: Db, where: SQL): StackRow[] {
  const records = db.all<StackRecord>(sql`SELECT ${columns} ${from} WHERE ${where} ${orderBy}`);
  const places = loadPlaces(db);
  return records.map((record) => toRow(record, places));
}

/** Live locations with this name (any case), and everything under them. */
function locationsNamed(db: Db, name: string): number[] {
  const ids = db
    .all<{ id: number }>(
      sql`SELECT id FROM locations WHERE deleted_at IS NULL AND lower(name) = lower(${name})`,
    )
    .map((row) => row.id);
  return [...new Set(ids.flatMap((id) => [id, ...descendantIds(db, id)]))];
}

/** One search filter as a SQL condition over the stack `s`, printing `p` and card `c`. */
function condition(db: Db, filter: CollectionFilter): SQL {
  switch (filter.kind) {
    case 'name':
      return sql`instr(lower(c.name), ${filter.value}) > 0`;
    case 'set':
      return sql`p.set_code = ${filter.value} COLLATE NOCASE`;
    case 'domain':
      return sql`EXISTS (SELECT 1 FROM json_each(c.domains) WHERE value = ${filter.value})`;
    case 'type':
      return sql`instr(lower(c.type), ${filter.value}) > 0`;
    case 'finish':
      return sql`s.finish = ${filter.value}`;
    case 'proxy':
      return sql`s.is_proxy = ${filter.value ? 1 : 0}`;
    case 'location': {
      const ids = locationsNamed(db, filter.value);
      return ids.length === 0 ? sql`0` : sql`s.location_id IN (${sql.join(ids, sql`, `)})`;
    }
    case 'trade': {
      const ids = [...locationTradeFlags(db)].filter(([, trade]) => trade).map(([id]) => id);
      const inTrade = ids.length === 0 ? sql`0` : sql`s.location_id IN (${sql.join(ids, sql`, `)})`;
      return filter.value ? inTrade : sql`NOT ${inTrade}`;
    }
    case 'invalid':
      throw new AppError(400, 'invalid_query', filter.message);
  }
}

/** GET /api/stacks: one page of every copy stack the search matches, with totals for all. */
export function searchStacks(
  db: Db,
  filters: CollectionFilter[],
  page: { sort?: Sort; cursor?: string; limit: number },
): StacksPage {
  const where = sql.join([sql`1`, ...filters.map((filter) => condition(db, filter))], sql` AND `);

  const total = db.get<StacksPage['total']>(sql`
    SELECT
      count(*) AS stacks,
      coalesce(sum(s.quantity), 0) AS cards,
      coalesce(sum(CASE WHEN s.is_proxy = 1 THEN s.quantity ELSE 0 END), 0) AS proxies,
      coalesce(sum(${stackValueSql}), 0) AS value,
      coalesce(sum(${noPriceSql}), 0) AS noPriceCount
    ${from} WHERE ${where}`) ?? { stacks: 0, cards: 0, proxies: 0, value: 0, noPriceCount: 0 };

  const { keys, descending } = sortKeys(db, page.sort ?? 'name');
  const key = sql`(${sql.join(keys, sql`, `)})`;
  const after = page.cursor
    ? sql` AND ${key} ${descending ? sql`<` : sql`>`} (${sql.join(
        decodeCursor(page.cursor, keys.length),
        sql`, `,
      )})`
    : sql``;
  const order = sql.join(
    keys.map((part) => (descending ? sql`${part} DESC` : part)),
    sql`, `,
  );
  // One extra row says whether there is a next page.
  const records = db.all<StackRecord & { sortKey: string }>(
    sql`SELECT ${columns}, json_array(${sql.join(keys, sql`, `)}) AS sortKey
      ${from} WHERE ${where}${after} ORDER BY ${order} LIMIT ${page.limit + 1}`,
  );
  const more = records.length > page.limit;
  const shown = more ? records.slice(0, page.limit) : records;
  const places = loadPlaces(db);
  const last = shown.at(-1);

  return {
    rows: shown.map((record) => toRow(record, places)),
    total,
    nextCursor: more && last ? encodeCursor(last.sortKey) : null,
  };
}

/** GET /api/locations/:id/stacks: the location and its stacks, and its children's if asked. */
export function locationStacks(db: Db, id: number, includeChildren: boolean): LocationStacks {
  const location = locationNode(db, id);
  if (!location) {
    throw new AppError(404, 'location_not_found', 'That location no longer exists.');
  }
  const ids = includeChildren ? [id, ...descendantIds(db, id)] : [id];
  return {
    location,
    rows: stackRows(db, sql`s.location_id IN (${sql.join(ids, sql`, `)})`),
  };
}

/** GET /api/cards/:id/copies: every stack of any printing of the card, and counts. */
export function cardCopies(db: Db, cardId: number): CardCopies {
  const rows = stackRows(db, sql`c.id = ${cardId}`);
  const sum = (list: StackRow[]) => list.reduce((total, row) => total + row.quantity, 0);
  const owned = sum(rows);
  const inDecks = sum(rows.filter((row) => row.location.type === 'deck_box'));
  return {
    rows,
    counts: {
      owned,
      proxies: sum(rows.filter((row) => row.isProxy)),
      inDecks,
      free: owned - inDecks,
    },
  };
}
