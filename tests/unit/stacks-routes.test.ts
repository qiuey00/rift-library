import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { cards, copyStacks, decks, locations, printings } from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { ErrorBody, type Finish, type LocationType } from '../../src/shared/api/common';
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

const oracle = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function addCard(
  n: number,
  name: string,
  typeLine: string,
  colorIdentity: string,
  prints: { set: string; number: string }[],
) {
  db.insert(cards)
    .values({
      oracleId: oracle(n),
      name,
      frontFaceName: name.split(' // ')[0] ?? name,
      typeLine,
      colorIdentity,
      commanderLegality: 'legal',
    })
    .run();
  for (const print of prints) {
    db.insert(printings)
      .values({
        scryfallId: `${name}-${print.set}-${print.number}`,
        oracleId: oracle(n),
        setCode: print.set,
        setName: `Set ${print.set.toUpperCase()}`,
        collectorNumber: print.number,
        lang: 'en',
        finishes: ['nonfoil', 'foil'],
        rarity: 'rare',
        releasedAt: '2025-01-01',
      })
      .run();
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
  scryfallId: string,
  locationId: number,
  quantity: number,
  details: { finish?: Finish; isProxy?: boolean; cameFrom?: number; condition?: string } = {},
) {
  return db
    .insert(copyStacks)
    .values({
      scryfallId,
      quantity,
      finish: details.finish ?? 'nonfoil',
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
  addCard(1, 'Sol Ring', 'Artifact', '', [
    { set: 'eoc', number: '57' },
    { set: 'cmm', number: '410' },
  ]);
  addCard(2, 'Llanowar Elves', 'Creature — Elf Druid', 'G', [{ set: 'fdn', number: '227' }]);
  addCard(3, 'Atraxa, Praetors’ Voice', 'Legendary Creature — Phyrexian Angel Horror', 'WUBG', [
    { set: 'cm2', number: '10' },
    { set: 'cm2', number: '9' },
  ]);
  addCard(4, 'Counterspell', 'Instant', 'U', [{ set: 'tdc', number: '115' }]);

  const longBox = addLocation('Long box', 'box', undefined, '#3b6fd8');
  const lands = addLocation('Lands', 'box', longBox);
  const basics = addLocation('Basics', 'tray', lands);
  const binder = addLocation('Rares binder', 'binder', undefined, '#7c5cd6');
  const deckBox = addLocation('Atraxa deck box', 'deck_box');
  const spareBox = addLocation('Spare deck box', 'deck_box');
  const deck = db
    .insert(decks)
    .values({ name: 'Atraxa', deckBoxId: deckBox })
    .returning({ id: decks.id })
    .get().id;

  const stacks = {
    solEoc: addStack('Sol Ring-eoc-57', longBox, 3),
    solCmmProxy: addStack('Sol Ring-cmm-410', binder, 1, { isProxy: true }),
    solInDeck: addStack('Sol Ring-eoc-57', deckBox, 1, { cameFrom: longBox }),
    elves: addStack('Llanowar Elves-fdn-227', basics, 4),
    elvesFoil: addStack('Llanowar Elves-fdn-227', lands, 2, { finish: 'foil' }),
    atraxa10: addStack('Atraxa, Praetors’ Voice-cm2-10', deckBox, 1, { finish: 'foil' }),
    atraxa9: addStack('Atraxa, Praetors’ Voice-cm2-9', binder, 1),
    counterspell: addStack('Counterspell-tdc-115', spareBox, 2),
    toSort: addStack('Counterspell-tdc-115', inboxId, 5, { condition: 'played' }),
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
      'Atraxa, Praetors’ Voice cm2 9',
      'Atraxa, Praetors’ Voice cm2 10',
      'Counterspell tdc 115',
      'Counterspell tdc 115',
      'Llanowar Elves fdn 227',
      'Llanowar Elves fdn 227',
      'Sol Ring cmm 410',
      'Sol Ring eoc 57',
      'Sol Ring eoc 57',
    ]);
    expect(page.total).toMatchObject({ stacks: 9, cards: 20, proxies: 1 });
    expect(page.nextCursor).toBeNull();
    // Stacks of one printing keep their id order.
    expect(stackIds(page).slice(-2)).toEqual([stacks.solEoc, stacks.solInDeck]);
  });

  it('builds each row with its location path, inherited color, came-from and deck', async () => {
    const { stacks, longBox, deck, deckBox, spareBox } = seed();
    const rows = new Map((await search()).rows.map((row) => [row.stackId, row]));

    expect(rows.get(stacks.elves)).toMatchObject({
      quantity: 4,
      card: { name: 'Llanowar Elves', colorIdentity: 'G', canBeCommander: false },
      printing: { setCode: 'fdn', setName: 'Set FDN', finishes: ['nonfoil', 'foil'] },
      finish: 'nonfoil',
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
    expect(rows.get(stacks.solInDeck)).toMatchObject({
      location: { id: deckBox, path: 'Atraxa deck box', color: null },
      cameFrom: { id: longBox, name: 'Long box', path: 'Long box', color: '#3b6fd8' },
      inDeck: { deckId: deck, deckName: 'Atraxa' },
    });
    expect(rows.get(stacks.solCmmProxy)?.isProxy).toBe(true);
    // A deck box with no deck is not in a deck.
    expect(rows.get(stacks.counterspell)).toMatchObject({
      location: { id: spareBox },
      inDeck: null,
    });
  });

  it('filters by words in the card name, any case', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('ring'))).toEqual([
      stacks.solCmmProxy,
      stacks.solEoc,
      stacks.solInDeck,
    ]);
    expect(stackIds(await search('"praetors’ voice"'))).toEqual([stacks.atraxa9, stacks.atraxa10]);
    expect(stackIds(await search('sol elves'))).toEqual([]);
  });

  it('filters by set', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('set:EOC'))).toEqual([stacks.solEoc, stacks.solInDeck]);
  });

  it('filters by color identity including every given color, and colorless', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('c:g'))).toEqual([
      stacks.atraxa9,
      stacks.atraxa10,
      stacks.elves,
      stacks.elvesFoil,
    ]);
    expect(stackIds(await search('c:ug'))).toEqual([stacks.atraxa9, stacks.atraxa10]);
    expect(stackIds(await search('c:c'))).toEqual([
      stacks.solCmmProxy,
      stacks.solEoc,
      stacks.solInDeck,
    ]);
  });

  it('filters by type line', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('t:creature'))).toEqual([
      stacks.atraxa9,
      stacks.atraxa10,
      stacks.elves,
      stacks.elvesFoil,
    ]);
    expect(stackIds(await search('t:"legendary creature"'))).toEqual([
      stacks.atraxa9,
      stacks.atraxa10,
    ]);
  });

  it('filters by finish', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('f:foil'))).toEqual([stacks.atraxa10, stacks.elvesFoil]);
    expect(stackIds(await search('f:etched'))).toEqual([]);
  });

  it('filters proxies and real copies', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('is:proxy'))).toEqual([stacks.solCmmProxy]);
    const real = await search('is:real');
    expect(real.total).toMatchObject({ stacks: 8, cards: 19, proxies: 0 });
  });

  it('filters by location name, any case, including its children', async () => {
    const { stacks } = seed();
    expect(stackIds(await search('loc:"long box"'))).toEqual([
      stacks.elves,
      stacks.elvesFoil,
      stacks.solEoc,
    ]);
    expect(stackIds(await search('loc:Lands'))).toEqual([stacks.elves, stacks.elvesFoil]);
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
    expect(stackIds(await search('t:creature f:foil'))).toEqual([
      stacks.atraxa10,
      stacks.elvesFoil,
    ]);
    expect(stackIds(await search('c:g loc:"long box" f:nonfoil elves'))).toEqual([stacks.elves]);
    const page = await search('sol is:real loc:"atraxa deck box"');
    expect(stackIds(page)).toEqual([stacks.solInDeck]);
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

    const filtered = await search('c:g', { limit: '3' });
    expect(filtered.rows).toHaveLength(3);
    const last = await search('c:g', { limit: '3', cursor: filtered.nextCursor ?? '' });
    expect(last.rows).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    expect(last.total.stacks).toBe(4);
  });

  it('keeps paging when the row before the cursor has moved away', async () => {
    const { stacks } = seed();
    const first = await search(undefined, { limit: '3' });
    db.$client.prepare('DELETE FROM copy_stacks WHERE id = ?').run(first.rows[2]?.stackId);
    const next = await search(undefined, { limit: '3', cursor: first.nextCursor ?? '' });
    expect(next.rows[0]?.stackId).toBe(stacks.toSort);
  });

  it('refuses a search term it cannot use with 400 invalid_query', async () => {
    const res = await client.stacks.$get({ query: { q: 'f:shiny' } });
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error).toEqual({
      code: 'invalid_query',
      message: 'f: takes foil, nonfoil or etched.',
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
    expect(stackIds(body)).toEqual([stacks.solEoc]);
  });

  it('adds its children’s stacks when asked', async () => {
    const { longBox, lands, stacks } = seed();
    const body = LocationStacks.parse(await (await get(longBox, '1')).json());
    expect(stackIds(body)).toEqual([stacks.elves, stacks.elvesFoil, stacks.solEoc]);

    const section = LocationStacks.parse(await (await get(lands, '0')).json());
    expect(section.location).toMatchObject({
      path: 'Long box › Lands',
      depth: 1,
      color: null,
      effectiveColor: '#3b6fd8',
      cardCount: 2,
      totalCount: 6,
    });
    expect(stackIds(section)).toEqual([stacks.elvesFoil]);
  });

  it('names the deck of a deck box', async () => {
    const { deckBox, deck, stacks } = seed();
    const body = LocationStacks.parse(await (await get(deckBox)).json());
    expect(body.location.deck).toEqual({ id: deck, name: 'Atraxa' });
    expect(body.rows.map((row) => [row.stackId, row.inDeck?.deckName])).toEqual([
      [stacks.atraxa10, 'Atraxa'],
      [stacks.solInDeck, 'Atraxa'],
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

describe('GET /api/cards/:oracleId/copies', () => {
  const get = async (oracleId: string) => {
    const res = await client.cards[':oracleId'].copies.$get({ param: { oracleId } });
    expect(res.status).toBe(200);
    return CardCopies.parse(await res.json());
  };

  it('lists every stack of every printing, with counts', async () => {
    const { stacks } = seed();
    const body = await get(oracle(1));
    expect(stackIds(body)).toEqual([stacks.solCmmProxy, stacks.solEoc, stacks.solInDeck]);
    expect(body.rows.map((row) => row.location.path)).toEqual([
      'Rares binder',
      'Long box',
      'Atraxa deck box',
    ]);
    expect(body.counts).toEqual({ owned: 5, proxies: 1, inDecks: 1, free: 4 });
  });

  it('counts copies in any deck box as in decks', async () => {
    seed();
    expect((await get(oracle(4))).counts).toEqual({ owned: 7, proxies: 0, inDecks: 2, free: 5 });
  });

  it('answers no copies for a card with none', async () => {
    seed();
    expect(await get(oracle(99))).toEqual({
      rows: [],
      counts: { owned: 0, proxies: 0, inDecks: 0, free: 0 },
    });
  });
});

describe('speed with Jeff’s collection size', () => {
  it('answers a filtered page of 10,000 stacks in under 200 ms', async () => {
    const colors = ['', 'W', 'U', 'B', 'R', 'G', 'WU', 'BG', 'WUBRG'];
    const types = [
      'Creature — Elf',
      'Instant',
      'Sorcery',
      'Artifact',
      'Legendary Creature — Angel',
    ];
    const sets = ['eoc', 'tdc', 'fdn', 'cmm', 'mh3'];
    const client = db.$client;
    client.transaction(() => {
      const card = client.prepare(
        `INSERT INTO cards (oracle_id, name, front_face_name, type_line, color_identity, commander_legality)
         VALUES (?, ?, ?, ?, ?, 'legal')`,
      );
      const printing = client.prepare(
        `INSERT INTO printings (scryfall_id, oracle_id, set_code, set_name, collector_number, lang, finishes, rarity, released_at)
         VALUES (?, ?, ?, ?, ?, 'en', '["nonfoil","foil"]', 'common', '2025-01-01')`,
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
        card.run(oracle(n), name, name, types[n % types.length], colors[n % colors.length]);
        for (let s = 0; s < 2; s++) {
          const set = sets[(n + s) % sets.length] ?? 'eoc';
          printing.run(`p-${n}-${s}`, oracle(n), set, set.toUpperCase(), String((n % 300) + s));
        }
      }
      const stack = client.prepare(
        `INSERT INTO copy_stacks (scryfall_id, quantity, finish, condition, language, is_proxy, location_id)
         VALUES (?, ?, ?, 'near_mint', 'en', ?, ?)`,
      );
      for (let i = 0; i < 10_000; i++) {
        stack.run(
          `p-${i % 4000}-${Math.floor(i / 4000) % 2}`,
          (i % 4) + 1,
          i % 7 === 0 ? 'foil' : 'nonfoil',
          i % 50 === 0 ? 1 : 0,
          places[i % places.length],
        );
      }
    })();
    expect((await search(undefined, { limit: '1' })).total.stacks).toBe(10_000);

    for (const q of [
      undefined,
      'c:g t:creature',
      'elf f:nonfoil is:real',
      'loc:"Box 3"',
      'set:eoc c:wu',
    ]) {
      const started = performance.now();
      const page = await search(q);
      const took = performance.now() - started;
      expect(page.rows.length).toBeGreaterThan(0);
      expect(took, `${q ?? 'everything'} took ${took.toFixed(0)} ms`).toBeLessThan(200);
    }
  });
});
