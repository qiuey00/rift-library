import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { copyStacks, decks, locations } from '../../src/server/db/schema';
import { createTestDb, insertCard, insertPrinting } from '../../src/server/db/test-db';
import {
  type CardType,
  type Domain,
  ErrorBody,
  type Finish,
  type LocationType,
} from '../../src/shared/api/common';
import { CardCopies, LocationStacks, StacksPage } from '../../src/shared/api/stacks';

// The copy stack lists against a fresh in-memory database, with rows inserted directly.

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

function addCard(
  id: number,
  name: string,
  type: CardType,
  domains: Domain[],
  prints: { set: string; number: string }[],
) {
  insertCard(db, { id, name, type, domains });
  for (const print of prints) {
    insertPrinting(db, {
      riftcodexId: `${name}-${print.set}-${print.number}`,
      cardId: id,
      setCode: print.set,
      setName: `Set ${print.set}`,
      collectorNumber: print.number,
      rarity: 'rare',
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

function addStack(
  printingId: string,
  locationId: number,
  quantity: number,
  details: { finish?: Finish; isProxy?: boolean; cameFrom?: number; condition?: string } = {},
) {
  return db
    .insert(copyStacks)
    .values({
      printingId,
      quantity,
      finish: details.finish ?? 'normal',
      condition: details.condition ?? 'near_mint',
      language: 'en',
      isProxy: details.isProxy ?? false,
      locationId,
      cameFromLocationId: details.cameFrom,
    })
    .returning({ id: copyStacks.id })
    .get().id;
}

/** A small collection: a long box with sections, a binder, and a deck's deck box. */
function seed() {
  addCard(
    1,
    'Sun Disc',
    'gear',
    [],
    [
      { set: 'SFD', number: '57' },
      { set: 'OGN', number: '210' },
    ],
  );
  addCard(2, 'Wild Shaman', 'unit', ['calm'], [{ set: 'OGS', number: '22' }]);
  addCard(
    3,
    'Lux, Lady of Luminosity',
    'legend',
    ['order', 'mind'],
    [
      { set: 'OGN', number: '10' },
      { set: 'OGN', number: '9' },
    ],
  );
  addCard(4, 'Ember Rebuke', 'spell', ['mind'], [{ set: 'UNL', number: '115' }]);

  const longBox = addLocation('Long box', 'box', undefined, '#3b6fd8');
  const lands = addLocation('Lands', 'box', longBox);
  const basics = addLocation('Basics', 'tray', lands);
  const binder = addLocation('Rares binder', 'binder', undefined, '#7c5cd6');
  const deckBox = addLocation('Lux Control deck box', 'deck_box');
  const spareBox = addLocation('Spare deck box', 'deck_box');
  const deck = db
    .insert(decks)
    .values({ name: 'Lux Control', deckBoxId: deckBox })
    .returning({ id: decks.id })
    .get().id;

  const stacks = {
    discSfd: addStack('Sun Disc-SFD-57', longBox, 3),
    discOgnProxy: addStack('Sun Disc-OGN-210', binder, 1, { isProxy: true }),
    discInDeck: addStack('Sun Disc-SFD-57', deckBox, 1, { cameFrom: longBox }),
    shaman: addStack('Wild Shaman-OGS-22', basics, 4),
    shamanFoil: addStack('Wild Shaman-OGS-22', lands, 2, { finish: 'foil' }),
    lux10: addStack('Lux, Lady of Luminosity-OGN-10', deckBox, 1, { finish: 'foil' }),
    lux9: addStack('Lux, Lady of Luminosity-OGN-9', binder, 1),
    rebuke: addStack('Ember Rebuke-UNL-115', spareBox, 2),
    toSort: addStack('Ember Rebuke-UNL-115', inboxId, 5, { condition: 'played' }),
  };
  return { longBox, lands, basics, binder, deckBox, spareBox, deck, stacks };
}

async function search(q?: string, more: { cursor?: string; limit?: string } = {}) {
  const res = await client.stacks.$get({ query: { q, ...more } });
  expect(res.status).toBe(200);
  return StacksPage.parse(await res.json());
}

const stackIds = (page: { rows: { stackId: number }[] }) => page.rows.map((row) => row.stackId);

describe('GET /api/stacks', () => {
  it('answers an empty collection', async () => {
    expect(await search()).toMatchObject({
      rows: [],
      total: { stacks: 0, cards: 0, proxies: 0 },
      nextCursor: null,
    });
  });

  it('lists every stack by card name, then set, then collector number', async () => {
    const { stacks } = seed();
    const page = await search();
    expect(
      page.rows.map(
        (row) => `${row.card.name} ${row.printing.setCode} ${row.printing.collectorNumber}`,
      ),
    ).toEqual([
      'Ember Rebuke UNL 115',
      'Ember Rebuke UNL 115',
      'Lux, Lady of Luminosity OGN 9',
      'Lux, Lady of Luminosity OGN 10',
      'Sun Disc OGN 210',
      'Sun Disc SFD 57',
      'Sun Disc SFD 57',
      'Wild Shaman OGS 22',
      'Wild Shaman OGS 22',
    ]);
    expect(page.total).toMatchObject({ stacks: 9, cards: 20, proxies: 1 });
    expect(page.nextCursor).toBeNull();
    // Stacks of one printing keep their id order.
    expect(stackIds(page).slice(5, 7)).toEqual([stacks.discSfd, stacks.discInDeck]);
  });

  it('builds each row with its location path, inherited color, came-from and deck', async () => {
    const { stacks, longBox, deck, deckBox, spareBox } = seed();
    const rows = new Map((await search()).rows.map((row) => [row.stackId, row]));

    expect(rows.get(stacks.shaman)).toMatchObject({
      quantity: 4,
      card: { name: 'Wild Shaman', type: 'unit', domains: ['calm'] },
      printing: { setCode: 'OGS', setName: 'Set OGS', finishes: ['normal', 'foil'] },
      finish: 'normal',
      condition: 'near_mint',
      isProxy: false,
      location: {
        name: 'Basics',
        type: 'tray',
        path: 'Long box › Lands › Basics',
        color: '#3b6fd8',
      },
      cameFrom: null,
      inDeck: null,
    });
    expect(rows.get(stacks.discInDeck)).toMatchObject({
      location: { id: deckBox, path: 'Lux Control deck box', color: null },
      cameFrom: { id: longBox, name: 'Long box', path: 'Long box', color: '#3b6fd8' },
      inDeck: { deckId: deck, deckName: 'Lux Control' },
    });
    expect(rows.get(stacks.discOgnProxy)?.isProxy).toBe(true);
    // A deck box with no deck is not in a deck.
    expect(rows.get(stacks.rebuke)).toMatchObject({
      location: { id: spareBox },
      inDeck: null,
    });
  });

  it('filters by words in the card name, any case', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('DISC'))).toEqual([
      stacks.discOgnProxy,
      stacks.discSfd,
      stacks.discInDeck,
    ]);
    expect(stackIds(await search('"lady of luminosity"'))).toEqual([stacks.lux9, stacks.lux10]);
    expect(stackIds(await search('disc shaman'))).toEqual([]);
  });

  it('filters by set', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('set:sfd'))).toEqual([stacks.discSfd, stacks.discInDeck]);
  });

  it('filters by domain', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('domain:calm'))).toEqual([stacks.shaman, stacks.shamanFoil]);
    expect(stackIds(await search('domain:mind'))).toEqual([
      stacks.rebuke,
      stacks.toSort,
      stacks.lux9,
      stacks.lux10,
    ]);
    expect(stackIds(await search('domain:fury'))).toEqual([]);
  });

  it('filters by card type', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('t:unit'))).toEqual([stacks.shaman, stacks.shamanFoil]);
    expect(stackIds(await search('t:legend'))).toEqual([stacks.lux9, stacks.lux10]);
  });

  it('filters by finish', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('f:foil'))).toEqual([stacks.lux10, stacks.shamanFoil]);
    expect(stackIds(await search('f:normal'))).toHaveLength(7);
  });

  it('filters proxies and real copies', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('is:proxy'))).toEqual([stacks.discOgnProxy]);
    const real = await search('is:real');
    expect(real.total).toMatchObject({ stacks: 8, cards: 19, proxies: 0 });
  });

  it('filters by location name, any case, including its children', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('loc:"long box"'))).toEqual([
      stacks.discSfd,
      stacks.shaman,
      stacks.shamanFoil,
    ]);
    expect(stackIds(await search('loc:Lands'))).toEqual([stacks.shaman, stacks.shamanFoil]);
    expect(stackIds(await search('loc:"To sort"'))).toEqual([stacks.toSort]);
    expect(stackIds(await search('loc:Nowhere'))).toEqual([]);
  });

  it('leaves out a deleted location from loc:', async () => {
    const { binder } = seed();
    db.$client
      .prepare('UPDATE locations SET deleted_at = ? WHERE id = ?')
      .run('2026-10-19', binder);
    expect(stackIds(await search('loc:"Rares binder"'))).toEqual([]);
  });

  it('combines filters, every one must match', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('t:legend f:foil'))).toEqual([stacks.lux10]);
    expect(stackIds(await search('domain:calm loc:"long box" f:normal shaman'))).toEqual([
      stacks.shaman,
    ]);
    const page = await search('disc is:real loc:"lux control deck box"');
    expect(stackIds(page)).toEqual([stacks.discInDeck]);
    expect(page.total).toMatchObject({ stacks: 1, cards: 1, proxies: 0 });
  });

  it('pages with a cursor, with totals for the whole search on every page', async () => {
    seed();
    const all = stackIds(await search());
    const seen: number[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const page = await search(undefined, { limit: '2', cursor });
      expect(page.total).toMatchObject({ stacks: 9, cards: 20, proxies: 1 });
      seen.push(...stackIds(page));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(all);

    const filtered = await search('domain:mind', { limit: '3' });
    expect(filtered.rows).toHaveLength(3);
    const last = await search('domain:mind', { limit: '3', cursor: filtered.nextCursor ?? '' });
    expect(last.rows).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    expect(last.total.stacks).toBe(4);
  });

  it('keeps paging when the row before the cursor has moved away', async () => {
    const { stacks } = seed();
    const first = await search(undefined, { limit: '3' });
    db.$client.prepare('DELETE FROM copy_stacks WHERE id = ?').run(first.rows[2]?.stackId);
    const next = await search(undefined, { limit: '3', cursor: first.nextCursor ?? '' });
    expect(next.rows[0]?.stackId).toBe(stacks.lux10);
  });

  it('refuses a search term it cannot use with 400 invalid_query', async () => {
    const res = await client.stacks.$get({ query: { q: 'f:shiny' } });
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error).toEqual({
      code: 'invalid_query',
      message: 'f: takes normal or foil.',
    });
  });

  it('refuses a cursor it did not write', async () => {
    const res = await client.stacks.$get({ query: { cursor: 'abc' } });
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('invalid_cursor');
  });
});

describe('GET /api/locations/:id/stacks', () => {
  const get = (id: number, includeChildren?: '0' | '1') =>
    client.locations[':id'].stacks.$get({
      param: { id: String(id) },
      query: includeChildren ? { includeChildren } : {},
    });

  it('answers the location as in the tree, and only its own stacks', async () => {
    const { longBox, stacks } = seed();
    const res = await get(longBox);
    expect(res.status).toBe(200);
    const body = LocationStacks.parse(await res.json());
    expect(body.location).toEqual({
      id: longBox,
      name: 'Long box',
      type: 'box',
      parentId: null,
      position: 0,
      color: '#3b6fd8',
      effectiveColor: '#3b6fd8',
      path: 'Long box',
      depth: 0,
      cardCount: 3,
      totalCount: 9,
      deck: null,
      markedForTrade: false,
      forTrade: false,
      // No prices are loaded, so every real card in it and inside it has no price.
      value: 0,
      noPriceCount: 9,
    });
    expect(stackIds(body)).toEqual([stacks.discSfd]);
  });

  it('adds its children’s stacks when asked', async () => {
    const { longBox, lands, stacks } = seed();
    const body = LocationStacks.parse(await (await get(longBox, '1')).json());
    expect(stackIds(body)).toEqual([stacks.discSfd, stacks.shaman, stacks.shamanFoil]);

    const section = LocationStacks.parse(await (await get(lands, '0')).json());
    expect(section.location).toMatchObject({
      path: 'Long box › Lands',
      depth: 1,
      color: null,
      effectiveColor: '#3b6fd8',
      cardCount: 2,
      totalCount: 6,
    });
    expect(stackIds(section)).toEqual([stacks.shamanFoil]);
  });

  it('names the deck of a deck box', async () => {
    const { deckBox, deck, stacks } = seed();
    const body = LocationStacks.parse(await (await get(deckBox)).json());
    expect(body.location.deck).toEqual({ id: deck, name: 'Lux Control' });
    expect(body.rows.map((row) => [row.stackId, row.inDeck?.deckName])).toEqual([
      [stacks.lux10, 'Lux Control'],
      [stacks.discInDeck, 'Lux Control'],
    ]);
  });

  it('answers an empty location', async () => {
    const empty = addLocation('Empty box', 'box');
    const body = LocationStacks.parse(await (await get(empty, '1')).json());
    expect(body.rows).toEqual([]);
    expect(body.location).toMatchObject({ cardCount: 0, totalCount: 0 });
  });

  it('answers 404 for a missing or deleted location, or one under a deleted location', async () => {
    const { longBox, lands } = seed();
    db.$client
      .prepare('UPDATE locations SET deleted_at = ? WHERE id = ?')
      .run('2026-10-19', longBox);
    for (const id of [999, longBox, lands]) {
      const res = await get(id);
      expect(res.status).toBe(404);
      expect(ErrorBody.parse(await res.json()).error.code).toBe('location_not_found');
    }
  });
});

describe('GET /api/cards/:id/copies', () => {
  const get = async (id: number) => {
    const res = await client.cards[':id'].copies.$get({ param: { id: String(id) } });
    expect(res.status).toBe(200);
    return CardCopies.parse(await res.json());
  };

  it('lists every stack of every printing, with counts', async () => {
    const { stacks } = seed();
    const body = await get(1);
    expect(stackIds(body)).toEqual([stacks.discOgnProxy, stacks.discSfd, stacks.discInDeck]);
    expect(body.rows.map((row) => row.location.path)).toEqual([
      'Rares binder',
      'Long box',
      'Lux Control deck box',
    ]);
    expect(body.counts).toEqual({ owned: 5, proxies: 1, inDecks: 1, free: 4 });
  });

  it('counts copies in any deck box as in decks', async () => {
    seed();
    expect((await get(4)).counts).toEqual({ owned: 7, proxies: 0, inDecks: 2, free: 5 });
  });

  it('answers no copies for a card with none', async () => {
    seed();
    expect(await get(99)).toEqual({
      rows: [],
      counts: { owned: 0, proxies: 0, inDecks: 0, free: 0 },
    });
  });
});

describe('speed with Jeff’s collection size', () => {
  it('answers a filtered page of 10,000 stacks in under 200 ms', async () => {
    const domains = ['[]', '["fury"]', '["calm"]', '["mind"]', '["body","chaos"]', '["order"]'];
    const types = ['unit', 'spell', 'gear', 'legend', 'battlefield'];
    const sets = ['OGN', 'SFD', 'OGS', 'UNL', 'VEN'];
    const client = db.$client;
    client.transaction(() => {
      const card = client.prepare(
        'INSERT INTO cards (id, name, name_key, type, domains) VALUES (?, ?, ?, ?, ?)',
      );
      const printing = client.prepare(
        `INSERT INTO printings (riftcodex_id, card_id, public_code, set_code, set_name, collector_number, rarity)
         VALUES (?, ?, ?, ?, ?, ?, 'common')`,
      );
      const location = client.prepare(
        'INSERT INTO locations (name, type, parent_id, position) VALUES (?, ?, ?, ?)',
      );
      const parents: number[] = [];
      const places: number[] = [inboxId];
      for (let i = 0; i < 10; i++) {
        const box = Number(location.run(`Box ${i}`, 'box', null, i).lastInsertRowid);
        parents.push(box);
        places.push(box);
        for (let j = 0; j < 5; j++) {
          places.push(Number(location.run(`Row ${i}-${j}`, 'tray', box, j).lastInsertRowid));
        }
      }
      for (let n = 0; n < 4000; n++) {
        const name = `Card ${String(n).padStart(4, '0')} ${['Dragon', 'Elf', 'Ring', 'Bolt'][n % 4]}`;
        card.run(
          n + 1,
          name,
          name.toLowerCase(),
          types[n % types.length],
          domains[n % domains.length],
        );
        for (let s = 0; s < 2; s++) {
          const set = sets[(n + s) % sets.length] ?? 'OGN';
          const number = String((n % 300) + s);
          printing.run(`p-${n}-${s}`, n + 1, `${set}-${number}`, set, set, number);
        }
      }
      const stack = client.prepare(
        `INSERT INTO copy_stacks (printing_id, quantity, finish, condition, language, is_proxy, location_id)
         VALUES (?, ?, ?, 'near_mint', 'en', ?, ?)`,
      );
      for (let i = 0; i < 10_000; i++) {
        stack.run(
          `p-${i % 4000}-${Math.floor(i / 4000) % 2}`,
          (i % 4) + 1,
          i % 7 === 0 ? 'foil' : 'normal',
          i % 50 === 0 ? 1 : 0,
          places[i % places.length],
        );
      }
    })();
    expect((await search(undefined, { limit: '1' })).total.stacks).toBe(10_000);

    for (const q of [
      undefined,
      'domain:calm t:spell',
      'elf f:normal is:real',
      'loc:"Box 3"',
      'set:ogn domain:fury',
    ]) {
      const started = performance.now();
      const page = await search(q);
      const took = performance.now() - started;
      expect(page.rows.length).toBeGreaterThan(0);
      expect(took, `${q ?? 'everything'} took ${took.toFixed(0)} ms`).toBeLessThan(200);
    }
  });
});
