import { randomUUID } from 'node:crypto';
import { hc } from 'hono/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { api } from '../../src/client/api';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { cards, copyStacks, locations, printings } from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { cardDetails, searchCards } from '../../src/server/queries/cards';
import { CardDetailsResponse, CardSearchResponse } from '../../src/shared/api/cards';
import { ErrorBody } from '../../src/shared/api/common';

const client: typeof api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

type CardInput = Partial<typeof cards.$inferInsert> & { name: string };

function addCard(db: OpenDb, input: CardInput) {
  return db
    .insert(cards)
    .values({
      oracleId: randomUUID(),
      frontFaceName: input.name.split(' // ')[0],
      typeLine: 'Instant',
      commanderLegality: 'legal',
      ...input,
    })
    .returning()
    .get();
}

function addPrinting(
  db: OpenDb,
  oracleId: string,
  setCode: string,
  releasedAt: string,
  extra: Partial<typeof printings.$inferInsert> = {},
) {
  return db
    .insert(printings)
    .values({
      printingId: randomUUID(),
      oracleId,
      setCode,
      setName: `${setCode.toUpperCase()} set`,
      collectorNumber: '1',
      lang: 'en',
      finishes: ['nonfoil'],
      rarity: 'common',
      releasedAt,
      imageSmall: `https://img/small/${setCode}.jpg`,
      imageNormal: `https://img/normal/${setCode}.jpg`,
      ...extra,
    })
    .returning()
    .get();
}

function addStack(
  db: OpenDb,
  printingId: string,
  locationId: number,
  quantity: number,
  isProxy = false,
) {
  db.insert(copyStacks)
    .values({
      printingId,
      quantity,
      locationId,
      isProxy,
      finish: 'nonfoil',
      condition: 'near_mint',
      language: 'en',
    })
    .run();
}

function addLocation(db: OpenDb, name: string, type: 'box' | 'deck_box') {
  return db.insert(locations).values({ name, type }).returning().get().id;
}

const names = (results: { name: string }[]) => results.map((r) => r.name);

describe('card search', () => {
  let db: OpenDb;

  beforeEach(() => {
    db = createTestDb();
    addCard(db, { name: 'Brainstorm', colorIdentity: 'U' });
    addCard(db, {
      name: 'Harmonized Trio // Brainstorm',
      frontFaceName: 'Harmonized Trio',
      colorIdentity: 'G',
    });
    addCard(db, { name: 'Mind Brainstorm Ritual', colorIdentity: 'U' });
    addCard(db, { name: 'Arcane Signet', typeLine: 'Artifact' });
    addCard(db, {
      name: 'Hearthhull, the Worldseed',
      typeLine: 'Legendary Artifact — Spacecraft',
      colorIdentity: 'BRG',
      canBeCommander: true,
    });
    addCard(db, {
      name: 'Atraxa, Praetors’ Voice',
      typeLine: 'Legendary Creature — Phyrexian Angel Horror',
      colorIdentity: 'WUBG',
      canBeCommander: true,
    });
    addCard(db, { name: 'Lightning Bolt', colorIdentity: 'R' });
    addCard(db, { name: 'Terminate', colorIdentity: 'BR' });
    addCard(db, { name: '100% Off', colorIdentity: 'R' });
  });

  it('puts names starting with the text before names containing it, ignoring case', () => {
    expect(names(searchCards(db, { q: 'BRAINSTORM', limit: 20 }))).toEqual([
      'Brainstorm',
      'Harmonized Trio // Brainstorm',
      'Mind Brainstorm Ritual',
    ]);
  });

  it('finds a double-faced card by either face', () => {
    expect(names(searchCards(db, { q: 'harmonized', limit: 20 }))).toEqual([
      'Harmonized Trio // Brainstorm',
    ]);
    expect(names(searchCards(db, { q: 'brainstorm', limit: 20 }))).toContain(
      'Harmonized Trio // Brainstorm',
    );
  });

  it('stops at the limit', () => {
    expect(names(searchCards(db, { q: 'brainstorm', limit: 2 }))).toEqual([
      'Brainstorm',
      'Harmonized Trio // Brainstorm',
    ]);
  });

  it('reads % and _ as plain text', () => {
    expect(names(searchCards(db, { q: '%', limit: 20 }))).toEqual(['100% Off']);
    expect(searchCards(db, { q: '_', limit: 20 })).toEqual([]);
  });

  it('keeps only commanders with commander', () => {
    expect(names(searchCards(db, { q: 'a', commander: true, limit: 20 }))).toEqual([
      'Atraxa, Praetors’ Voice',
      'Hearthhull, the Worldseed',
    ]);
  });

  it('keeps only cards whose color identity fits inside identity', () => {
    const found = (identity: string) => names(searchCards(db, { q: 'e', identity, limit: 20 }));
    // Colorless Arcane Signet always fits; Harmonized Trio (G) and Terminate (BR) fit BRG,
    // Atraxa (WUBG) doesn't.
    expect(found('BRG')).toEqual([
      'Arcane Signet',
      'Harmonized Trio // Brainstorm',
      'Hearthhull, the Worldseed',
      'Terminate',
    ]);
    expect(found('')).toEqual(['Arcane Signet']);
    expect(found('GRB')).toEqual(found('BRG'));
    expect(found('WUBRG')).toHaveLength(names(searchCards(db, { q: 'e', limit: 20 })).length);
  });

  it('answers through the API in the schema', async () => {
    setDb(db);
    const res = await client.cards.search.$get({
      query: { q: 'hearthhull', commander: '1', identity: 'BRG' },
    });
    expect(res.status).toBe(200);
    const { results } = CardSearchResponse.parse(await res.json());
    expect(results).toMatchObject([
      { name: 'Hearthhull, the Worldseed', canBeCommander: true, owned: 0, free: 0 },
    ]);
  });
});

describe('copy counts and card details', () => {
  let db: OpenDb;
  let oracleId: string;

  beforeEach(() => {
    db = createTestDb();
    oracleId = addCard(db, {
      name: 'Arcane Signet',
      typeLine: 'Artifact',
      manaCost: '{2}',
      manaValue: 2,
      keywords: [],
    }).oracleId;
    const old = addPrinting(db, oracleId, 'eld', '2019-10-04');
    const newest = addPrinting(db, oracleId, 'eoc', '2025-08-01');
    addPrinting(db, oracleId, 'cmm', '2023-08-04', { finishes: ['nonfoil', 'foil'] });
    addPrinting(db, oracleId, 'jpn', '2026-01-01', {
      lang: 'ja',
      imageSmall: 'https://img/small/ja.jpg',
    });

    const box = addLocation(db, 'Long box', 'box');
    const deckBox = addLocation(db, 'Atraxa deck box', 'deck_box');
    addStack(db, old.printingId, box, 3); // in storage
    addStack(db, newest.printingId, box, 1, true); // a proxy in storage
    addStack(db, newest.printingId, deckBox, 2); // in a deck
    addStack(db, old.printingId, deckBox, 1, true); // a proxy in a deck
  });

  it('counts owned and free across printings in search results', () => {
    expect(searchCards(db, { q: 'signet', limit: 20 })).toMatchObject([
      { name: 'Arcane Signet', owned: 7, free: 4 },
    ]);
  });

  it('answers the card, its printings newest first and its counts', () => {
    const details = cardDetails(db, oracleId);
    expect(details).toBeDefined();
    if (!details) return;
    expect(details.card).toMatchObject({
      name: 'Arcane Signet',
      keywords: [],
      commanderLegality: 'legal',
      // The newest English printing's images.
      imageSmall: 'https://img/small/eoc.jpg',
    });
    expect(details.printings.map((p) => p.setCode)).toEqual(['jpn', 'eoc', 'cmm', 'eld']);
    expect(details.printings[2].finishes).toEqual(['nonfoil', 'foil']);
    expect(details.counts).toEqual({ owned: 7, proxies: 2, inDecks: 3, free: 4 });
  });

  it('answers zero counts for a card with no copies', () => {
    const other = addCard(db, { name: 'Sol Ring', typeLine: 'Artifact', keywords: ['Partner'] });
    expect(cardDetails(db, other.oracleId)).toMatchObject({
      card: { keywords: ['Partner'], imageSmall: null },
      printings: [],
      counts: { owned: 0, proxies: 0, inDecks: 0, free: 0 },
    });
  });

  it('answers through the API in the schema, and 404 card_not_found', async () => {
    setDb(db);
    const res = await client.cards[':oracleId'].$get({ param: { oracleId } });
    expect(res.status).toBe(200);
    expect(CardDetailsResponse.parse(await res.json()).counts.free).toBe(4);

    const missing = await client.cards[':oracleId'].$get({
      param: { oracleId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(missing.status).toBe(404);
    expect(ErrorBody.parse(await missing.json()).error.code).toBe('card_not_found');

    const bad = await app.request('/api/cards/not-an-id');
    expect(bad.status).toBe(400);
  });
});

describe('card search on full-size card data', () => {
  it('answers in under 100 ms with 35,000 cards', () => {
    const db = createTestDb();
    const words = ['Arcane', 'Storm', 'Goblin', 'Angel', 'Signet', 'Bolt', 'Dragon', 'Elf'];
    const rows = Array.from({ length: 35_000 }, (_, i) => {
      const name = `${words[i % words.length]} ${words[(i * 7) % words.length]} ${i}`;
      return {
        oracleId: randomUUID(),
        name,
        frontFaceName: name,
        typeLine: 'Creature',
        commanderLegality: 'legal' as const,
        colorIdentity: ['', 'W', 'UB', 'BRG', 'G'][i % 5],
        canBeCommander: i % 10 === 0,
      };
    });
    db.transaction((tx) => {
      for (let i = 0; i < rows.length; i += 500) {
        tx.insert(cards)
          .values(rows.slice(i, i + 500))
          .run();
      }
    });

    // Warm up once, as the running server would be.
    searchCards(db, { q: 'storm', limit: 20 });
    for (const options of [
      { q: 'storm', limit: 20 },
      { q: 'go', limit: 20 },
      { q: 'zzz', limit: 20 },
      { q: 'dragon', commander: true, identity: 'BRG', limit: 20 },
    ]) {
      const start = performance.now();
      searchCards(db, options);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });
});
