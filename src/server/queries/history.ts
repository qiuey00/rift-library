import { type SQL, sql } from 'drizzle-orm';
import type { LocationRef, LocationType } from '../../shared/api/common';
import type { DeckRef } from '../../shared/api/decks';
import type {
  BatchKind,
  HistoryBatch,
  HistoryDay,
  HistoryEntry,
  HistoryQuery,
  MovementReason,
  MovementRow,
} from '../../shared/api/history';
import type { Db } from '../db/database';
import {
  type CardRecord,
  cardColumnsSql,
  type PrintingRecord,
  printingColumnsSql,
  toCardSummary,
  toPrintingSummary,
} from './card-summaries';
import { locationPaths, locationTradeFlags, PATH_SEPARATOR } from './locations';

// History: every movement, one day of Jeff's clock at a time (HIST-2, FIND-6). Movements are
// never deleted, so each answer reads only one day's rows plus a few small lookups.

/** Batches shown as one entry that expands; movements of other batches stand alone. */
const GROUPED_KINDS: readonly BatchKind[] = ['pick_list', 'put_away', 'swap', 'undo'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The filters and offset of GET /api/history, without `before`. */
type Filters = Omit<HistoryQuery, 'before'>;

/** The columns a `MovementRow` is built from, as one query returns them. */
type MovementRecord = CardRecord &
  PrintingRecord & {
    id: number;
    batchId: number;
    createdAt: string;
    quantity: number;
    fromLocationId: number | null;
    toLocationId: number | null;
    reason: MovementReason;
    deckId: number | null;
    undoneAt: string | null;
  };

const columns = sql`
  m.id, m.batch_id AS batchId, m.created_at AS createdAt, m.quantity,
  m.from_location_id AS fromLocationId, m.to_location_id AS toLocationId, m.reason,
  m.deck_id AS deckId, m.undone_at AS undoneAt,
  ${cardColumnsSql}, ${printingColumnsSql}`;

const from = sql`
  FROM movements AS m
  JOIN printings AS p ON p.riftcodex_id = m.printing_id
  JOIN cards AS c ON c.id = p.card_id`;

/** Every location, deleted ones too, so old movements still name where copies were. */
type Places = {
  refs: Map<number, LocationRef>;
  children: Map<number, number[]>;
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
  const livePaths = locationPaths(db);
  const trade = locationTradeFlags(db);

  // A deleted location, or one under a deleted location, has no tree path: its path is
  // worked out the same way from its parents' names.
  const pathOf = (id: number): string => {
    const live = livePaths.get(id);
    if (live !== undefined) return live;
    const names: string[] = [];
    const seen = new Set<number>();
    for (let at = byId.get(id); at && !seen.has(at.id); at = byId.get(at.parentId ?? -1)) {
      seen.add(at.id);
      names.unshift(at.name);
    }
    return names.join(PATH_SEPARATOR);
  };

  const colorOf = (id: number): string | null => {
    const seen = new Set<number>();
    for (let at = byId.get(id); at && !seen.has(at.id); at = byId.get(at.parentId ?? -1)) {
      seen.add(at.id);
      if (at.color !== null) return at.color;
    }
    return null;
  };

  const refs = new Map<number, LocationRef>();
  const children = new Map<number, number[]>();
  for (const row of rows) {
    refs.set(row.id, {
      id: row.id,
      name: row.name,
      type: row.type,
      path: pathOf(row.id),
      color: colorOf(row.id),
      forTrade: trade.get(row.id) ?? false,
    });
    if (row.parentId !== null) {
      children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
    }
  }
  return { refs, children };
}

/** The location and every location under it, deleted ones too. */
function withChildren(places: Places, id: number): number[] {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) {
    for (const child of places.children.get(ids[i] as number) ?? []) {
      if (!ids.includes(child)) ids.push(child);
    }
  }
  return ids;
}

/** Every deck by id, deleted ones too. */
function loadDecks(db: Db): Map<number, DeckRef> {
  return new Map(
    db
      .all<DeckRef>(sql`SELECT id, name FROM decks`)
      .map((deck) => [deck.id, { id: deck.id, name: deck.name }]),
  );
}

/** The SQL condition over movement `m` for the card, location and deck filters. */
function filterSql(filters: Filters, places: Places): SQL {
  const conditions: SQL[] = [];
  if (filters.card !== undefined) {
    conditions.push(
      sql`m.printing_id IN (SELECT riftcodex_id FROM printings WHERE card_id = ${filters.card})`,
    );
  }
  if (filters.location !== undefined) {
    const ids = JSON.stringify(withChildren(places, filters.location));
    conditions.push(
      sql`(m.from_location_id IN (SELECT value FROM json_each(${ids}))
        OR m.to_location_id IN (SELECT value FROM json_each(${ids})))`,
    );
  }
  if (filters.deck !== undefined) {
    conditions.push(sql`m.deck_id = ${filters.deck}`);
  }
  return conditions.length === 0 ? sql`1` : sql.join(conditions, sql` AND `);
}

/**
 * The UTC time Jeff's day starts, without seconds' fraction or zone, such as
 * "2026-10-18T07:00:00". Stored times compare against it as text whether or not they carry
 * milliseconds, because offsets are whole minutes.
 */
function dayStart(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 60_000).toISOString().slice(0, 19);
}

/** The day on Jeff's clock of a UTC time. */
function localDay(time: number, offset: number): string {
  return new Date(time - offset * 60_000).toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Such as "1 card" or "1,036 cards". */
function cardCount(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'card' : 'cards'}`;
}

/** What one batch is, for its summary, over all its movements (not only the filtered ones). */
type BatchInfo = {
  id: number;
  kind: BatchKind;
  deckId: number | null;
  createdAt: string;
  cards: number;
  movements: number;
  undone: number;
};

/** Writes batch summaries, loading what they need once per batch. */
class Summaries {
  private readonly batches = new Map<number, BatchInfo>();
  private readonly texts = new Map<number, string>();

  constructor(
    private readonly db: Db,
    private readonly places: Places,
    private readonly decks: Map<number, DeckRef>,
  ) {}

  /** Loads these batches' kinds and totals in one query. */
  load(ids: number[]) {
    const missing = ids.filter((id) => !this.batches.has(id));
    if (missing.length === 0) return;
    const rows = this.db.all<BatchInfo>(sql`
      SELECT
        b.id, b.kind, b.deck_id AS deckId, b.created_at AS createdAt,
        coalesce(sum(m.quantity), 0) AS cards, count(m.id) AS movements,
        count(m.undone_at) AS undone
      FROM movement_batches AS b
      LEFT JOIN movements AS m ON m.batch_id = b.id
      WHERE b.id IN (SELECT value FROM json_each(${JSON.stringify(missing)}))
      GROUP BY b.id`);
    for (const row of rows) this.batches.set(row.id, row);
  }

  batch(id: number): BatchInfo | undefined {
    this.load([id]);
    return this.batches.get(id);
  }

  deck(id: number | null): DeckRef | null {
    return id === null ? null : (this.decks.get(id) ?? null);
  }

  /** Such as "Pick list · Jinx Burn · 12 cards". */
  summary(batch: BatchInfo, depth = 0): string {
    const known = this.texts.get(batch.id);
    if (known !== undefined) return known;
    const text = this.write(batch, depth);
    this.texts.set(batch.id, text);
    return text;
  }

  private write(batch: BatchInfo, depth: number): string {
    const cards = cardCount(batch.cards);
    const deckName = this.deck(batch.deckId)?.name;
    const list = (name: string) => [name, deckName, cards].filter(Boolean).join(' · ');
    switch (batch.kind) {
      case 'pick_list':
        return list('Pick list');
      case 'put_away':
        return list('Put-away list');
      case 'swap':
        return list('Swap list');
      case 'undo':
        return this.undoSummary(batch, depth);
      case 'move':
        return `Moved ${cards}`;
      case 'add':
        return `Added ${cards}`;
      case 'remove':
        return `Removed ${cards}`;
    }
  }

  /**
   * Such as "Undid: Pick list · Jinx Burn · 3 cards" for a whole batch, or "Undid: moved
   * Ember Signet to Rares binder" for one movement.
   */
  private undoSummary(batch: BatchInfo, depth: number): string {
    const undid = this.db.all<{
      batchId: number;
      quantity: number;
      reason: MovementReason;
      toLocationId: number | null;
      name: string;
    }>(sql`
      SELECT t.batch_id AS batchId, t.quantity, t.reason, t.to_location_id AS toLocationId, c.name
      FROM movements AS u
      JOIN movements AS t ON t.id = u.undoes_movement_id
      JOIN printings AS p ON p.riftcodex_id = t.printing_id
      JOIN cards AS c ON c.id = p.card_id
      WHERE u.batch_id = ${batch.id}
      ORDER BY t.id`);
    const first = undid[0];
    if (!first) return `Undid ${cardCount(batch.cards)}`;

    const batchIds = new Set(undid.map((row) => row.batchId));
    const undone = batchIds.size === 1 ? this.batch(first.batchId) : undefined;
    // A whole batch shown as one entry was undone: name it the way its entry does.
    if (undone && GROUPED_KINDS.includes(undone.kind) && depth < 5) {
      return `Undid: ${this.summary(undone, depth + 1)}`;
    }

    const to = (id: number | null) => (id === null ? undefined : this.places.refs.get(id)?.name);
    if (undid.length === 1) {
      const quantity = first.quantity > 1 ? `${first.quantity} × ` : '';
      const where = to(first.toLocationId);
      return `Undid: ${VERBS[first.reason]} ${quantity}${first.name}${where ? ` to ${where}` : ''}`;
    }
    const total = undid.reduce((sum, row) => sum + row.quantity, 0);
    const places = new Set(undid.map((row) => row.toLocationId));
    const where = places.size === 1 ? to(first.toLocationId) : undefined;
    const verb = new Set(undid.map((row) => row.reason)).size === 1 ? VERBS[first.reason] : 'moved';
    return `Undid: ${verb} ${cardCount(total)}${where ? ` to ${where}` : ''}`;
  }
}

/** How an undo summary names the movement it undid. */
const VERBS: Record<MovementReason, string> = {
  added: 'added',
  removed: 'removed',
  moved: 'moved',
  assembled: 'pulled',
  returned: 'put back',
  swapped_out: 'swapped out',
  swapped_in: 'swapped in',
  location_update: 'updated',
  undo: 'undid',
};

function toMovementRow(record: MovementRecord, places: Places, summaries: Summaries): MovementRow {
  const place = (id: number | null) => (id === null ? null : (places.refs.get(id) ?? null));
  return {
    id: record.id,
    createdAt: record.createdAt,
    card: toCardSummary(record),
    printing: toPrintingSummary(record),
    quantity: record.quantity,
    from: place(record.fromLocationId),
    to: place(record.toLocationId),
    reason: record.reason,
    deck: summaries.deck(record.deckId),
    undoneAt: record.undoneAt,
  };
}

/**
 * GET /api/history: the latest day on or before `before` (default today on Jeff's clock) with
 * movements matching the filters, its entries newest first.
 */
export function historyDay(db: Db, query: HistoryQuery, now = Date.now()): HistoryDay {
  const { offset } = query;
  const before = query.before ?? localDay(now, offset);
  const places = loadPlaces(db);
  const where = filterSql(query, places);

  // The newest matching movement up to the end of `before` picks the day; the created_at
  // index answers it without reading older rows.
  const latest = db.get<{ createdAt: string }>(sql`
    SELECT m.created_at AS createdAt FROM movements AS m
    WHERE ${where} AND m.created_at < ${dayStart(addDays(before, 1), offset)}
    ORDER BY m.created_at DESC LIMIT 1`);
  if (!latest) return { day: before, entries: [], nextBefore: null };

  const day = localDay(Date.parse(latest.createdAt), offset);
  const start = dayStart(day, offset);
  const end = dayStart(addDays(day, 1), offset);

  const records = db.all<MovementRecord>(sql`
    SELECT ${columns} ${from}
    WHERE ${where} AND m.created_at >= ${start} AND m.created_at < ${end}
    ORDER BY m.created_at DESC, m.id DESC`);

  const older = db.get<{ found: number }>(sql`
    SELECT 1 AS found FROM movements AS m WHERE ${where} AND m.created_at < ${start} LIMIT 1`);

  const summaries = new Summaries(db, places, loadDecks(db));
  summaries.load([...new Set(records.map((record) => record.batchId))]);

  // Records are newest first, so each entry lands in order of its newest movement.
  const entries: HistoryEntry[] = [];
  const grouped = new Map<number, HistoryBatch>();
  for (const record of records) {
    const movement = toMovementRow(record, places, summaries);
    const batch = summaries.batch(record.batchId);
    if (!batch || !GROUPED_KINDS.includes(batch.kind)) {
      entries.push({ kind: 'movement', movement });
      continue;
    }
    const entry = grouped.get(batch.id);
    if (entry) {
      entry.movements.push(movement);
      continue;
    }
    const created: HistoryBatch = {
      id: batch.id,
      kind: batch.kind,
      summary: summaries.summary(batch),
      deck: summaries.deck(batch.deckId),
      createdAt: batch.createdAt,
      undone: batch.movements > 0 && batch.undone === batch.movements,
      movements: [movement],
    };
    grouped.set(batch.id, created);
    entries.push({ kind: 'batch', batch: created });
  }

  return { day, entries, nextBefore: older ? addDays(day, -1) : null };
}
