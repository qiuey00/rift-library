import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { decks, locations, movementBatches, movements } from '../../src/server/db/schema';
import { createTestDb, insertCard, insertPrinting } from '../../src/server/db/test-db';
import { historyDay } from '../../src/server/queries/history';
import type { LocationType } from '../../src/shared/api/common';
import {
  type BatchKind,
  HistoryDay,
  type HistoryEntry,
  type MovementReason,
} from '../../src/shared/api/history';

// GET /api/history against a fresh in-memory database, with movements inserted directly.

const client = hc<AppType>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;
let inboxId: number;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  inboxId = db.select().from(locations).get()?.id ?? 0;
});
afterEach(() => db.$client.close());

function addCard(n: number, name: string, prints: string[]) {
  insertCard(db, { id: n, name });
  for (const [i, printingId] of prints.entries()) {
    insertPrinting(db, {
      riftcodexId: printingId,
      cardId: n,
      collectorNumber: String(50 + i),
      finishes: ['normal'],
      rarity: 'uncommon',
    });
  }
}

function addLocation(name: string, type: LocationType, parentId?: number, color?: string) {
  return db
    .insert(locations)
    .values({ name, type, parentId, color })
    .returning({ id: locations.id })
    .get().id;
}

function addBatch(kind: BatchKind, createdAt: string, more: { deckId?: number } = {}) {
  return db
    .insert(movementBatches)
    .values({ kind, createdAt, ...more })
    .returning({ id: movementBatches.id })
    .get().id;
}

function addMovement(
  batchId: number,
  createdAt: string,
  printingId: string,
  details: {
    quantity?: number;
    from?: number | null;
    to?: number | null;
    reason?: MovementReason;
    deckId?: number;
    undoneAt?: string;
    undoes?: number;
  } = {},
) {
  return db
    .insert(movements)
    .values({
      batchId,
      copyStackId: 1,
      printingId,
      finish: 'normal',
      condition: 'near_mint',
      language: 'en',
      quantity: details.quantity ?? 1,
      fromLocationId: details.from ?? null,
      toLocationId: details.to ?? null,
      reason: details.reason ?? 'moved',
      deckId: details.deckId,
      undoneAt: details.undoneAt,
      undoesMovementId: details.undoes,
      createdAt,
    })
    .returning({ id: movements.id })
    .get().id;
}

/** A single move in its own batch. */
function move(createdAt: string, printingId: string, from: number, to: number) {
  return addMovement(addBatch('move', createdAt), createdAt, printingId, { from, to });
}

async function history(query: {
  offset?: string;
  before?: string;
  card?: string;
  location?: string;
  deck?: string;
}) {
  const res = await client.history.$get({ query: { offset: '0', ...query } });
  expect(res.status).toBe(200);
  const body = await res.json();
  // Responses match the shared schema exactly.
  expect(HistoryDay.parse(body)).toEqual(body);
  return body as HistoryDay;
}

/** Each entry's movement ids, newest first: a number for a single, a list for a batch. */
const shape = (entries: HistoryEntry[]) =>
  entries.map((entry) =>
    entry.kind === 'movement'
      ? entry.movement.id
      : entry.batch.movements.map((movement) => movement.id),
  );

function seedCards() {
  addCard(1, 'Sun Disc', ['sol-eoc', 'sol-cmm']);
  addCard(2, 'Ember Signet', ['signet']);
}

describe('GET /api/history', () => {
  it('answers an empty history with the asked day and no older day', async () => {
    expect(await history({ before: '2026-10-18' })).toEqual({
      day: '2026-10-18',
      entries: [],
      nextBefore: null,
    });
  });

  it('defaults to today on Jeff’s clock', () => {
    // 03:00 UTC on the 19th is still the 18th at UTC−7.
    const now = Date.parse('2026-10-19T03:00:00Z');
    expect(historyDay(db, { offset: 420 }, now).day).toBe('2026-10-18');
    expect(historyDay(db, { offset: 0 }, now).day).toBe('2026-10-19');
    expect(historyDay(db, { offset: -600 }, now).day).toBe('2026-10-19');
  });

  it('builds each movement with card, printing, places and deck', async () => {
    seedCards();
    const box = addLocation('Long box', 'box', undefined, '#3b6fd8');
    const lands = addLocation('Lands', 'box', box);
    const id = move('2026-10-18T12:00:00.000Z', 'sol-eoc', inboxId, lands);

    const day = await history({ before: '2026-10-18' });
    expect(day.entries).toEqual([
      {
        kind: 'movement',
        movement: {
          id,
          createdAt: '2026-10-18T12:00:00.000Z',
          card: {
            id: 1,
            name: 'Sun Disc',
            type: 'gear',
            supertype: null,
            domains: [],
            energy: null,
            might: null,
            power: null,
            championTag: null,
            imageUrl: null,
          },
          printing: {
            printingId: 'sol-eoc',
            publicCode: 'OGN-050/298',
            setCode: 'OGN',
            setName: 'Origins',
            collectorNumber: '50',
            rarity: 'uncommon',
            imageUrl: null,
            alternateArt: false,
            overnumbered: false,
            signature: false,
            finishes: ['normal'],
            unitPrice: { normal: null, foil: null },
          },
          quantity: 1,
          from: {
            id: inboxId,
            name: 'To sort',
            type: 'inbox',
            path: 'To sort',
            color: null,
            forTrade: false,
          },
          to: {
            id: lands,
            name: 'Lands',
            type: 'box',
            path: 'Long box › Lands',
            color: '#3b6fd8',
            forTrade: false,
          },
          reason: 'moved',
          removalReason: null,
          deck: null,
          undoneAt: null,
        },
      },
    ]);
  });

  it('groups days by Jeff’s UTC offset', async () => {
    seedCards();
    const box = addLocation('Long box', 'box');
    // 02:00 UTC on the 19th is the evening of the 18th at UTC−7 (offset 420).
    const late = move('2026-10-19T02:00:00.000Z', 'sol-eoc', inboxId, box);
    const morning = move('2026-10-18T08:00:00.000Z', 'signet', inboxId, box);
    const early = move('2026-10-18T06:59:59.999Z', 'signet', box, inboxId);

    const utc7 = await history({ offset: '420', before: '2026-10-19' });
    expect(utc7.day).toBe('2026-10-18');
    expect(shape(utc7.entries)).toEqual([late, morning]);
    expect(utc7.nextBefore).toBe('2026-10-17');
    const previous = await history({ offset: '420', before: '2026-10-17' });
    expect(previous.day).toBe('2026-10-17');
    expect(shape(previous.entries)).toEqual([early]);
    expect(previous.nextBefore).toBeNull();

    const utc = await history({ offset: '0', before: '2026-10-19' });
    expect(utc.day).toBe('2026-10-19');
    expect(shape(utc.entries)).toEqual([late]);
    expect(shape((await history({ offset: '0', before: '2026-10-18' })).entries)).toEqual([
      morning,
      early,
    ]);

    // East of UTC (UTC+10, offset −600) the late move is already the 19th's midday.
    const east = await history({ offset: '-600', before: '2026-10-19' });
    expect(shape(east.entries)).toEqual([late]);
  });

  it('counts a time without milliseconds on the right day', async () => {
    seedCards();
    const box = addLocation('Long box', 'box');
    const midnight = move('2026-10-18T07:00:00Z', 'sol-eoc', inboxId, box);
    const day = await history({ offset: '420', before: '2026-10-18' });
    expect(shape(day.entries)).toEqual([midnight]);
  });

  it('skips empty days and points nextBefore at the day before the one shown', async () => {
    seedCards();
    const box = addLocation('Long box', 'box');
    const newest = move('2026-10-18T12:00:00.000Z', 'sol-eoc', inboxId, box);
    const older = move('2026-10-10T12:00:00.000Z', 'signet', inboxId, box);
    const oldest = move('2026-09-01T12:00:00.000Z', 'signet', box, inboxId);

    const first = await history({ before: '2026-10-25' });
    expect(first).toMatchObject({ day: '2026-10-18', nextBefore: '2026-10-17' });
    expect(shape(first.entries)).toEqual([newest]);

    const second = await history({ before: first.nextBefore ?? '' });
    expect(second).toMatchObject({ day: '2026-10-10', nextBefore: '2026-10-09' });
    expect(shape(second.entries)).toEqual([older]);

    const third = await history({ before: second.nextBefore ?? '' });
    expect(third).toMatchObject({ day: '2026-09-01', nextBefore: null });
    expect(shape(third.entries)).toEqual([oldest]);
  });

  it('filters by card: any printing of it', async () => {
    seedCards();
    const box = addLocation('Long box', 'box');
    const eoc = move('2026-10-18T10:00:00.000Z', 'sol-eoc', inboxId, box);
    move('2026-10-18T11:00:00.000Z', 'signet', inboxId, box);
    const cmm = move('2026-10-18T12:00:00.000Z', 'sol-cmm', inboxId, box);
    move('2026-10-20T12:00:00.000Z', 'signet', box, inboxId);

    const day = await history({ before: '2026-10-25', card: '1' });
    expect(day).toMatchObject({ day: '2026-10-18', nextBefore: null });
    expect(shape(day.entries)).toEqual([cmm, eoc]);
  });

  it('filters by location: from or to it or its children, deleted ones too', async () => {
    seedCards();
    const box = addLocation('Long box', 'box');
    const lands = addLocation('Lands', 'box', box);
    const old = addLocation('Old tray', 'tray', lands);
    const binder = addLocation('Rares binder', 'binder');
    db.$client
      .prepare('UPDATE locations SET deleted_at = ? WHERE id = ?')
      .run('2026-10-18T20:00:00Z', old);

    const intoBox = move('2026-10-18T10:00:00.000Z', 'sol-eoc', inboxId, box);
    const outOfLands = move('2026-10-18T11:00:00.000Z', 'signet', lands, binder);
    const intoOld = move('2026-10-18T12:00:00.000Z', 'signet', inboxId, old);
    move('2026-10-18T13:00:00.000Z', 'sol-eoc', inboxId, binder);

    expect(shape((await history({ before: '2026-10-18', location: String(box) })).entries)).toEqual(
      [intoOld, outOfLands, intoBox],
    );
    expect(
      shape((await history({ before: '2026-10-18', location: String(lands) })).entries),
    ).toEqual([intoOld, outOfLands]);
    expect(shape((await history({ before: '2026-10-18', location: String(old) })).entries)).toEqual(
      [intoOld],
    );
  });

  it('filters by deck', async () => {
    seedCards();
    const box = addLocation('Long box', 'box');
    const deckBox = addLocation('Jinx Burn deck box', 'deck_box');
    const deckId = db
      .insert(decks)
      .values({ name: 'Jinx Burn', deckBoxId: deckBox })
      .returning({ id: decks.id })
      .get().id;
    move('2026-10-18T09:00:00.000Z', 'signet', inboxId, box);
    const batch = addBatch('pick_list', '2026-10-18T10:00:00.000Z', { deckId });
    const pulled = addMovement(batch, '2026-10-18T10:00:00.000Z', 'sol-eoc', {
      from: box,
      to: deckBox,
      reason: 'assembled',
      deckId,
    });

    const day = await history({ before: '2026-10-18', deck: String(deckId) });
    expect(shape(day.entries)).toEqual([[pulled]]);
    expect(day.nextBefore).toBeNull();
  });

  it('groups pick list, put-away, swap and undo batches with summaries', async () => {
    seedCards();
    const box = addLocation('Long box', 'box');
    const deckBox = addLocation('Jinx Burn deck box', 'deck_box');
    const deckId = db
      .insert(decks)
      .values({ name: 'Jinx Burn', deckBoxId: deckBox })
      .returning({ id: decks.id })
      .get().id;
    const t = (minute: number) => `2026-10-18T12:${String(minute).padStart(2, '0')}:00.000Z`;

    const added = addBatch('add', t(1));
    const i1 = addMovement(added, t(1), 'sol-eoc', { quantity: 388, to: inboxId });
    const i2 = addMovement(added, t(1), 'signet', { quantity: 1, to: inboxId });

    const pick = addBatch('pick_list', t(2), { deckId });
    const p1 = addMovement(pick, t(2), 'sol-eoc', {
      from: inboxId,
      to: deckBox,
      reason: 'assembled',
      deckId,
    });
    const p2 = addMovement(pick, t(3), 'signet', {
      quantity: 2,
      from: inboxId,
      to: deckBox,
      reason: 'assembled',
      deckId,
    });

    const swap = addBatch('swap', t(4), { deckId });
    const s1 = addMovement(swap, t(4), 'sol-cmm', {
      from: box,
      to: deckBox,
      reason: 'swapped_in',
      deckId,
    });

    const putAway = addBatch('put_away', t(5), { deckId });
    const a1 = addMovement(putAway, t(5), 'sol-eoc', {
      from: deckBox,
      to: box,
      reason: 'returned',
      deckId,
      undoneAt: t(7),
    });

    // A single move, then undone on its own.
    const single = addMovement(addBatch('move', t(6)), t(6), 'signet', {
      from: box,
      to: inboxId,
      undoneAt: t(8),
    });
    // The put-away list undone as a whole.
    const undoAll = addBatch('undo', t(7));
    const u1 = addMovement(undoAll, t(7), 'sol-eoc', {
      from: box,
      to: deckBox,
      reason: 'undo',
      undoes: a1,
    });
    const undoOne = addBatch('undo', t(8));
    const u2 = addMovement(undoOne, t(8), 'signet', {
      from: inboxId,
      to: box,
      reason: 'undo',
      undoes: single,
    });

    const day = await history({ before: '2026-10-18' });
    expect(shape(day.entries)).toEqual([[u2], [u1], single, [a1], [s1], [p2, p1], i2, i1]);
    const batches = day.entries.flatMap((entry) => (entry.kind === 'batch' ? [entry.batch] : []));
    expect(
      batches.map(({ kind, summary, deck, undone, createdAt }) => [
        kind,
        summary,
        deck?.name ?? null,
        undone,
        createdAt,
      ]),
    ).toEqual([
      ['undo', 'Undid: moved Ember Signet to To sort', null, false, t(8)],
      ['undo', 'Undid: Put-away list · Jinx Burn · 1 card', null, false, t(7)],
      ['put_away', 'Put-away list · Jinx Burn · 1 card', 'Jinx Burn', true, t(5)],
      ['swap', 'Swap list · Jinx Burn · 1 card', 'Jinx Burn', false, t(4)],
      ['pick_list', 'Pick list · Jinx Burn · 3 cards', 'Jinx Burn', false, t(2)],
    ]);
  });

  it('keeps a batch’s summary whole when a filter shows only some of its movements', async () => {
    seedCards();
    const batch = addBatch('pick_list', '2026-10-18T12:00:00.000Z');
    addMovement(batch, '2026-10-18T12:00:00.000Z', 'sol-eoc', { quantity: 3, to: inboxId });
    const signet = addMovement(batch, '2026-10-18T12:00:00.000Z', 'signet', { to: inboxId });

    const day = await history({ before: '2026-10-18', card: '2' });
    expect(shape(day.entries)).toEqual([[signet]]);
    expect(day.entries[0]).toMatchObject({
      batch: { summary: 'Pick list · 4 cards' },
    });
  });

  it('still names deleted locations and decks', async () => {
    seedCards();
    const shelf = addLocation('Shelf', 'box', undefined, '#7c5cd6');
    const deckBox = addLocation('Old deck box', 'deck_box', shelf);
    const deckId = db
      .insert(decks)
      .values({ name: 'Old deck', deckBoxId: deckBox })
      .returning({ id: decks.id })
      .get().id;
    const batch = addBatch('put_away', '2026-10-18T12:00:00.000Z', { deckId });
    addMovement(batch, '2026-10-18T12:00:00.000Z', 'sol-eoc', {
      from: deckBox,
      to: inboxId,
      reason: 'returned',
      deckId,
    });
    const gone = '2026-10-18T13:00:00Z';
    db.$client.prepare('UPDATE decks SET deleted_at = ?').run(gone);
    db.$client
      .prepare('UPDATE locations SET deleted_at = ? WHERE id IN (?, ?)')
      .run(gone, shelf, deckBox);

    const [entry] = (await history({ before: '2026-10-18' })).entries;
    expect(entry).toMatchObject({
      kind: 'batch',
      batch: {
        summary: 'Put-away list · Old deck · 1 card',
        deck: { id: deckId, name: 'Old deck' },
        movements: [
          {
            from: {
              id: deckBox,
              name: 'Old deck box',
              path: 'Shelf › Old deck box',
              color: '#7c5cd6',
            },
            deck: { id: deckId, name: 'Old deck' },
          },
        ],
      },
    });
  });

  it('refuses an offset outside the world’s time zones', async () => {
    const res = await client.history.$get({ query: { offset: '900' } });
    expect(res.status).toBe(400);
  });
});

describe('speed with years of history', () => {
  it('loads a day of 5,000 movements among 50,000 in under 200 ms', async () => {
    const sqlite = db.$client;
    const places = [inboxId];
    sqlite.transaction(() => {
      const card = sqlite.prepare(
        `INSERT INTO cards (id, name, name_key, type) VALUES (?, ?, ?, 'gear')`,
      );
      const printing = sqlite.prepare(
        `INSERT INTO printings (riftcodex_id, card_id, public_code, set_code, set_name, collector_number, finishes, rarity)
         VALUES (?, ?, ?, 'OGN', 'Origins', ?, '["normal"]', 'common')`,
      );
      for (let n = 0; n < 1000; n++) {
        card.run(n + 1, `Card ${n}`, `card ${n}`);
        printing.run(`p-${n}`, n + 1, `OGN-${n}`, String(n));
      }
      const location = sqlite.prepare('INSERT INTO locations (name, type) VALUES (?, ?)');
      for (let i = 0; i < 30; i++) {
        places.push(Number(location.run(`Box ${i}`, 'box').lastInsertRowid));
      }
      const batch = sqlite.prepare('INSERT INTO movement_batches (kind, created_at) VALUES (?, ?)');
      const movement = sqlite.prepare(
        `INSERT INTO movements (batch_id, copy_stack_id, printing_id, finish, condition, language,
           quantity, from_location_id, to_location_id, reason, created_at)
         VALUES (?, 1, ?, 'normal', 'near_mint', 'en', 1, ?, ?, ?, ?)`,
      );
      // 45 older days of 1,000 movements, then the busy day: 5,000 movements, half of them
      // in pick-list batches of 50.
      let pickList = 0;
      const at = (day: number, i: number) =>
        new Date(Date.parse('2026-08-01T00:00:00Z') + day * 86_400_000 + i * 1000).toISOString();
      for (let day = 0; day < 46; day++) {
        const count = day === 45 ? 5000 : 1000;
        for (let i = 0; i < count; i++) {
          const grouped = day === 45 && i % 2 === 0;
          if (grouped && i % 100 === 0) {
            pickList = Number(batch.run('pick_list', at(day, i)).lastInsertRowid);
          }
          movement.run(
            grouped ? pickList : Number(batch.run('move', at(day, i)).lastInsertRowid),
            `p-${(day * 7 + i) % 1000}`,
            places[i % places.length],
            places[(i + 1) % places.length],
            grouped ? 'assembled' : 'moved',
            at(day, i),
          );
        }
      }
    })();
    expect(sqlite.prepare('SELECT count(*) AS n FROM movements').get()).toEqual({ n: 50_000 });

    // Timed from request to the answer's JSON, as the screen gets it.
    const started = performance.now();
    const res = await client.history.$get({ query: { offset: '0', before: '2026-12-31' } });
    const body = await res.json();
    const took = performance.now() - started;
    const day = HistoryDay.parse(body);
    expect(day.day).toBe('2026-09-15');
    expect(
      day.entries.flatMap((entry) =>
        entry.kind === 'batch' ? entry.batch.movements : [entry.movement],
      ),
    ).toHaveLength(5000);
    expect(day.nextBefore).toBe('2026-09-14');
    expect(took, `took ${took.toFixed(0)} ms`).toBeLessThan(200);
  });
});
