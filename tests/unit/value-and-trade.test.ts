import { eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import {
  cardDataStatus,
  cards,
  copyStacks,
  decks,
  locations,
  printings,
} from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { locationTradeFlags } from '../../src/server/queries/locations';
import { locationWorth, unitPrice } from '../../src/server/queries/value';
import { ErrorBody, type Finish, type LocationType } from '../../src/shared/api/common';
import { LocationNode, LocationTree } from '../../src/shared/api/locations';
import {
  CardCopies,
  CollectionValue,
  LocationStacks,
  StacksPage,
  type StacksQuery,
} from '../../src/shared/api/stacks';

// Values (VAL-2) and trade locations (TRADE-1) against a fresh in-memory database, with
// prices inserted directly.

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

type Price = { usd?: number; foil?: number; etched?: number };

function addCard(n: number, name: string, prints: ({ set: string; number: string } & Price)[]) {
  db.insert(cards)
    .values({
      oracleId: oracle(n),
      name,
      frontFaceName: name,
      typeLine: 'Artifact',
      colorIdentity: '',
      commanderLegality: 'legal',
    })
    .run();
  for (const print of prints) {
    db.insert(printings)
      .values({
        printingId: `${name}-${print.set}-${print.number}`,
        oracleId: oracle(n),
        setCode: print.set,
        setName: `Set ${print.set.toUpperCase()}`,
        collectorNumber: print.number,
        lang: 'en',
        finishes: ['nonfoil', 'foil', 'etched'],
        rarity: 'rare',
        releasedAt: '2025-01-01',
        priceUsd: print.usd ?? null,
        priceUsdFoil: print.foil ?? null,
        priceUsdEtched: print.etched ?? null,
      })
      .run();
  }
}

function addLocation(name: string, type: LocationType, parentId?: number) {
  return db.insert(locations).values({ name, type, parentId }).returning({ id: locations.id }).get()
    .id;
}

let clock = 0;
function addStack(
  printingId: string,
  locationId: number,
  quantity: number,
  details: { finish?: Finish; isProxy?: boolean; cameFrom?: number } = {},
) {
  clock += 1;
  return db
    .insert(copyStacks)
    .values({
      printingId,
      quantity,
      finish: details.finish ?? 'nonfoil',
      condition: 'near_mint',
      language: 'en',
      isProxy: details.isProxy ?? false,
      locationId,
      cameFromLocationId: details.cameFrom,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, clock)).toISOString(),
    })
    .returning({ id: copyStacks.id })
    .get().id;
}

/**
 * A shelf with a trade binder (and a section inside it), a long box, a deck's deck box and
 * the inbox. Sol Ring costs $1.50 ($4.00 foil), Mana Crypt $180 (no foil price), Brainstorm
 * has no prices at all, and Lotus Petal's etched printing is $12.
 */
function seed() {
  addCard(1, 'Sol Ring', [
    { set: 'eoc', number: '57', usd: 150, foil: 400 },
    { set: 'cmm', number: '410', usd: 120 },
  ]);
  addCard(2, 'Mana Crypt', [{ set: '2xm', number: '270', usd: 18000 }]);
  addCard(3, 'Brainstorm', [{ set: 'ice', number: '61' }]);
  addCard(4, 'Lotus Petal', [{ set: 'tmp', number: '9', usd: 900, etched: 1200 }]);

  const shelf = addLocation('Shelf', 'box');
  const tradeBinder = addLocation('Trade binder', 'binder', shelf);
  const tradePage = addLocation('Page 2', 'tray', tradeBinder);
  const longBox = addLocation('Long box', 'box');
  const deckBox = addLocation('Atraxa deck box', 'deck_box');
  db.insert(decks).values({ name: 'Atraxa', deckBoxId: deckBox }).run();

  const stacks = {
    solShelf: addStack('Sol Ring-eoc-57', shelf, 2), // 2 × 150 = 300
    solFoilTrade: addStack('Sol Ring-eoc-57', tradeBinder, 3, { finish: 'foil' }), // 1200
    cryptFoilTrade: addStack('Mana Crypt-2xm-270', tradeBinder, 1, { finish: 'foil' }), // no price
    cryptProxyPage: addStack('Mana Crypt-2xm-270', tradePage, 2, { isProxy: true }), // 0
    brainstormPage: addStack('Brainstorm-ice-61', tradePage, 4), // no price × 4
    petalEtchedBox: addStack('Lotus Petal-tmp-9', longBox, 1, { finish: 'etched' }), // 1200
    cryptInDeck: addStack('Mana Crypt-2xm-270', deckBox, 1, { cameFrom: tradeBinder }), // 18000
    solCmmInbox: addStack('Sol Ring-cmm-410', inboxId, 5), // 600
    brainstormProxyInbox: addStack('Brainstorm-ice-61', inboxId, 1, { isProxy: true }), // 0
  };
  return { shelf, tradeBinder, tradePage, longBox, deckBox, stacks };
}

async function search(query: { q?: string; sort?: StacksQuery['sort']; cursor?: string } = {}) {
  const res = await client.stacks.$get({ query });
  expect(res.status).toBe(200);
  return StacksPage.parse(await res.json());
}

async function tree() {
  const res = await client.locations.tree.$get();
  return new Map(LocationTree.parse(await res.json()).nodes.map((node) => [node.id, node]));
}

function patch(id: number, json: { forTrade?: boolean; parentId?: number | null }) {
  return client.locations[':id'].$patch({ param: { id: String(id) }, json });
}

function markForTrade(id: number, forTrade = true) {
  db.update(locations).set({ forTrade }).where(eq(locations.id, id)).run();
}

describe('values', () => {
  it('prices each stack by its finish, and leaves out proxies', async () => {
    const { stacks } = seed();
    const rows = new Map((await search()).rows.map((row) => [row.stackId, row]));
    const worth = (id: number) => {
      const row = rows.get(id);
      return [row?.unitPrice, row?.value];
    };
    expect(worth(stacks.solShelf)).toEqual([150, 300]);
    expect(worth(stacks.solFoilTrade)).toEqual([400, 1200]);
    expect(worth(stacks.petalEtchedBox)).toEqual([1200, 1200]);
    // No price for the finish, even though the nonfoil has one.
    expect(worth(stacks.cryptFoilTrade)).toEqual([null, 0]);
    expect(worth(stacks.brainstormPage)).toEqual([null, 0]);
    // A proxy shows the price but is worth nothing.
    expect(worth(stacks.cryptProxyPage)).toEqual([18000, 0]);
  });

  it('picks the price for the finish', () => {
    const prices = { priceUsd: 1, priceUsdFoil: 2, priceUsdEtched: null };
    expect(unitPrice('nonfoil', prices)).toBe(1);
    expect(unitPrice('foil', prices)).toBe(2);
    expect(unitPrice('etched', prices)).toBeNull();
  });

  it('totals the matched stacks, counting real cards with no price by quantity', async () => {
    seed();
    expect((await search()).total).toEqual({
      stacks: 9,
      cards: 20,
      proxies: 3,
      value: 300 + 1200 + 1200 + 18000 + 600,
      // The foil Mana Crypt and four Brainstorms; the proxy Brainstorm isn't counted.
      noPriceCount: 5,
    });
    expect((await search({ q: 'brainstorm' })).total).toMatchObject({
      value: 0,
      noPriceCount: 4,
    });
  });

  it('values each location with every location inside it', async () => {
    const { shelf, tradeBinder, tradePage, longBox, deckBox } = seed();
    const nodes = await tree();
    const worth = (id: number) => {
      const node = nodes.get(id);
      return [node?.value, node?.noPriceCount];
    };
    expect(worth(tradePage)).toEqual([0, 4]);
    expect(worth(tradeBinder)).toEqual([1200, 5]);
    expect(worth(shelf)).toEqual([1500, 5]);
    expect(worth(longBox)).toEqual([1200, 0]);
    expect(worth(deckBox)).toEqual([18000, 0]);
    expect(worth(inboxId)).toEqual([600, 0]);
    expect(locationWorth(db, shelf)).toEqual({ value: 1500, noPriceCount: 5 });

    const res = await client.locations[':id'].stacks.$get({
      param: { id: String(tradeBinder) },
      query: {},
    });
    const body = LocationStacks.parse(await res.json());
    expect(body.location).toMatchObject({ value: 1200, noPriceCount: 5 });
  });

  it('values a card’s copies', async () => {
    const { stacks } = seed();
    const res = await client.cards[':oracleId'].copies.$get({ param: { oracleId: oracle(1) } });
    const body = CardCopies.parse(await res.json());
    expect(body.rows.find((row) => row.stackId === stacks.solCmmInbox)).toMatchObject({
      unitPrice: 120,
      value: 600,
    });
  });

  it('answers the whole collection’s value, deck boxes and trade locations included', async () => {
    const empty = await client.collection.value.$get();
    expect(CollectionValue.parse(await empty.json())).toEqual({
      value: 0,
      cards: 0,
      noPriceCount: 0,
      proxies: 0,
      pricesUpdatedAt: null,
    });

    seed();
    db.insert(cardDataStatus).values({ bulkUpdatedAt: '2026-10-18T21:04:31.000+00:00' }).run();
    const res = await client.collection.value.$get();
    expect(res.status).toBe(200);
    expect(CollectionValue.parse(await res.json())).toEqual({
      value: 21300,
      cards: 20,
      noPriceCount: 5,
      proxies: 3,
      pricesUpdatedAt: '2026-10-18T21:04:31.000Z',
    });
  });
});

describe('trade locations', () => {
  it('marks a location For trade, and its locations inherit it', async () => {
    const { shelf, tradeBinder, tradePage, longBox } = seed();
    const res = await patch(tradeBinder, { forTrade: true });
    expect(res.status).toBe(200);
    expect(LocationNode.parse(await res.json())).toMatchObject({
      id: tradeBinder,
      markedForTrade: true,
      forTrade: true,
    });

    const nodes = await tree();
    expect(nodes.get(tradePage)).toMatchObject({ markedForTrade: false, forTrade: true });
    expect(nodes.get(shelf)).toMatchObject({ markedForTrade: false, forTrade: false });
    expect(nodes.get(longBox)?.forTrade).toBe(false);

    await patch(tradeBinder, { forTrade: false });
    expect((await tree()).get(tradePage)?.forTrade).toBe(false);
  });

  it('follows a location moved into or out of a trade location', async () => {
    const { tradeBinder, longBox } = seed();
    markForTrade(tradeBinder);
    await patch(longBox, { parentId: tradeBinder });
    expect((await tree()).get(longBox)?.forTrade).toBe(true);
    await patch(longBox, { parentId: null });
    expect((await tree()).get(longBox)?.forTrade).toBe(false);
  });

  it('refuses the inbox and deck boxes', async () => {
    const { deckBox } = seed();
    const inbox = await patch(inboxId, { forTrade: true });
    expect(inbox.status).toBe(400);
    expect(ErrorBody.parse(await inbox.json()).error).toEqual({
      code: 'inbox_protected',
      message: 'The To sort inbox can’t be for trade.',
    });
    const box = await patch(deckBox, { forTrade: true });
    expect(box.status).toBe(400);
    expect(ErrorBody.parse(await box.json()).error).toEqual({
      code: 'deck_box_not_for_trade',
      message: 'A deck box can’t be for trade.',
    });
    // Nothing was saved.
    const nodes = await tree();
    expect(nodes.get(inboxId)?.markedForTrade).toBe(false);
    expect(nodes.get(deckBox)?.markedForTrade).toBe(false);
  });

  it('answers 404 for a location that no longer exists', async () => {
    expect((await patch(999, { forTrade: true })).status).toBe(404);
  });

  it('says on every stack row whether its location and came-from are for trade', async () => {
    const { tradeBinder, stacks } = seed();
    markForTrade(tradeBinder);
    const rows = new Map((await search()).rows.map((row) => [row.stackId, row]));
    expect(rows.get(stacks.solFoilTrade)?.location.forTrade).toBe(true);
    expect(rows.get(stacks.brainstormPage)?.location.forTrade).toBe(true);
    expect(rows.get(stacks.solShelf)?.location.forTrade).toBe(false);
    expect(rows.get(stacks.cryptInDeck)).toMatchObject({
      location: { forTrade: false },
      cameFrom: { id: tradeBinder, forTrade: true },
    });
  });

  it('still reads a deleted location under a trade location as for trade', () => {
    const { tradeBinder } = seed();
    markForTrade(tradeBinder);
    const gone = addLocation('Old page', 'tray', tradeBinder);
    db.update(locations)
      .set({ deletedAt: '2026-01-01T00:00:00.000Z' })
      .where(eq(locations.id, gone))
      .run();
    expect(locationTradeFlags(db).get(gone)).toBe(true);
  });

  it('filters the collection to stacks in, or not in, a trade location', async () => {
    const { tradeBinder, stacks } = seed();
    expect((await search({ q: 'trade:yes' })).rows).toEqual([]);

    markForTrade(tradeBinder);
    const yes = await search({ q: 'trade:yes' });
    expect(new Set(yes.rows.map((row) => row.stackId))).toEqual(
      new Set([
        stacks.solFoilTrade,
        stacks.cryptFoilTrade,
        stacks.cryptProxyPage,
        stacks.brainstormPage,
      ]),
    );
    expect(yes.total).toEqual({ stacks: 4, cards: 10, proxies: 2, value: 1200, noPriceCount: 5 });

    const no = await search({ q: 'trade:no sol' });
    expect(new Set(no.rows.map((row) => row.stackId))).toEqual(
      new Set([stacks.solShelf, stacks.solCmmInbox]),
    );
  });

  it('keeps trade copies in every count and total', async () => {
    const { tradeBinder } = seed();
    markForTrade(tradeBinder);
    expect((await search()).total.cards).toBe(20);
    const value = CollectionValue.parse(await (await client.collection.value.$get()).json());
    expect(value).toMatchObject({ cards: 20, value: 21300 });
    expect((await tree()).get(tradeBinder)?.totalCount).toBe(10);
  });
});

describe('collection sorts', () => {
  const ids = (page: StacksPage) => page.rows.map((row) => row.stackId);

  /** Every page of a sort, one stack at a time, so each cursor is used. */
  async function allPages(sort: StacksQuery['sort']) {
    const seen: number[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i += 1) {
      const res = await client.stacks.$get({ query: { sort, cursor, limit: '1' } });
      const page = StacksPage.parse(await res.json());
      seen.push(...ids(page));
      if (!page.nextCursor) return seen;
      cursor = page.nextCursor;
    }
    throw new Error('Too many pages');
  }

  it('sorts by name by default', async () => {
    const { stacks: s } = seed();
    const expected = [
      s.brainstormPage,
      s.brainstormProxyInbox,
      s.petalEtchedBox,
      s.cryptFoilTrade,
      s.cryptProxyPage,
      s.cryptInDeck,
      s.solCmmInbox,
      s.solShelf,
      s.solFoilTrade,
    ];
    expect(ids(await search())).toEqual(expected);
    expect(ids(await search({ sort: 'name' }))).toEqual(expected);
    expect(await allPages('name')).toEqual(expected);
  });

  it('sorts by value, highest first, then by name', async () => {
    const { stacks: s } = seed();
    const expected = [
      s.cryptInDeck, // 18000
      s.petalEtchedBox, // 1200, Lotus Petal before Sol Ring
      s.solFoilTrade, // 1200
      s.solCmmInbox, // 600
      s.solShelf, // 300
      s.brainstormPage, // 0 from here, by name
      s.brainstormProxyInbox,
      s.cryptFoilTrade,
      s.cryptProxyPage,
    ];
    expect(ids(await search({ sort: 'value' }))).toEqual(expected);
    expect(await allPages('value')).toEqual(expected);
  });

  it('sorts by location in tree order, then by name', async () => {
    const { stacks: s } = seed();
    const expected = [
      s.brainstormProxyInbox, // the inbox first
      s.solCmmInbox,
      s.solShelf, // Shelf
      s.cryptFoilTrade, // Trade binder
      s.solFoilTrade,
      s.brainstormPage, // Page 2
      s.cryptProxyPage,
      s.petalEtchedBox, // Long box
      s.cryptInDeck, // deck boxes last
    ];
    expect(ids(await search({ sort: 'location' }))).toEqual(expected);
    expect(await allPages('location')).toEqual(expected);
  });

  it('sorts by set, then collector number', async () => {
    const { stacks: s } = seed();
    addCard(5, 'Arcane Signet', [
      { set: 'eoc', number: '9' },
      { set: 'eoc', number: '100' },
    ]);
    const nine = addStack('Arcane Signet-eoc-9', inboxId, 1);
    const hundred = addStack('Arcane Signet-eoc-100', inboxId, 1);
    const expected = [
      s.cryptFoilTrade, // 2xm
      s.cryptProxyPage,
      s.cryptInDeck,
      s.solCmmInbox, // cmm
      nine, // eoc 9, 57, 100
      s.solShelf,
      s.solFoilTrade,
      hundred,
      s.brainstormPage, // ice
      s.brainstormProxyInbox,
      s.petalEtchedBox, // tmp
    ];
    expect(ids(await search({ sort: 'set' }))).toEqual(expected);
    expect(await allPages('set')).toEqual(expected);
  });

  it('sorts newest stack first', async () => {
    const { stacks: s } = seed();
    const expected = Object.values(s).reverse();
    expect(ids(await search({ sort: 'recent' }))).toEqual(expected);
    expect(await allPages('recent')).toEqual(expected);
  });

  it('keeps filters and totals whatever the sort', async () => {
    seed();
    const page = await search({ q: 'sol', sort: 'value' });
    expect(page.total).toMatchObject({ stacks: 3, cards: 10, value: 2100 });
  });

  it('refuses a cursor from another sort', async () => {
    seed();
    const res = await client.stacks.$get({ query: { sort: 'recent', limit: '1' } });
    const { nextCursor } = StacksPage.parse(await res.json());
    const wrong = await client.stacks.$get({
      query: { sort: 'value', cursor: nextCursor ?? '' },
    });
    expect(wrong.status).toBe(400);
    expect(ErrorBody.parse(await wrong.json()).error.code).toBe('invalid_cursor');
  });
});
