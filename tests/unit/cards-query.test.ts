import { hc } from 'hono/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { api } from '../../src/client/api';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { cards, copyStacks, locations } from '../../src/server/db/schema';
import {
  createTestDb,
  insertCard,
  insertPrinting,
  type TestCard,
  type TestPrinting,
} from '../../src/server/db/test-db';
import { cardDetails, searchCards } from '../../src/server/queries/cards';
import { CardDetailsResponse, CardSearchResponse } from '../../src/shared/api/cards';
import { type Domain, ErrorBody } from '../../src/shared/api/common';

const client: typeof api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

function addCard(db: OpenDb, card: TestCard) {
  return insertCard(db, { type: 'spell', ...card });
}

let printingCount = 0;

function addPrinting(db: OpenDb, cardId: number, extra: Partial<TestPrinting> = {}) {
  printingCount += 1;
  const riftcodexId = `printing-${printingCount}`;
  insertPrinting(db, {
    riftcodexId,
    cardId,
    finishes: ['normal'],
    imageUrl: `https://img/${riftcodexId}.webp`,
    ...extra,
  });
  return riftcodexId;
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
      finish: 'normal',
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
    addCard(db, { name: 'Brainstorm', domains: ['mind'] });
    addCard(db, { name: 'Gilded Brainstorm Whelp', type: 'unit', domains: ['calm'] });
    addCard(db, { name: 'Mind Brainstorm Ritual', domains: ['mind'] });
    addCard(db, { name: 'Ember Signet', type: 'gear' });
    addCard(db, {
      name: 'Jinx, Loose Cannon',
      type: 'legend',
      domains: ['fury', 'chaos'],
      championTag: 'Jinx',
    });
    addCard(db, {
      name: 'Lux, Lady of Luminosity',
      type: 'legend',
      domains: ['order', 'mind'],
      championTag: 'Lux',
    });
    addCard(db, { name: 'Lightning Bolt', domains: ['fury'] });
    addCard(db, { name: 'Terminate', domains: ['fury', 'chaos'] });
    addCard(db, { name: '100% Off', domains: ['fury'] });
  });

  it('puts names starting with the text before names containing it, ignoring case', () => {
    expect(names(searchCards(db, { q: 'BRAINSTORM', limit: 20 }))).toEqual([
      'Brainstorm',
      'Gilded Brainstorm Whelp',
      'Mind Brainstorm Ritual',
    ]);
  });

  it('stops at the limit', () => {
    expect(names(searchCards(db, { q: 'brainstorm', limit: 2 }))).toEqual([
      'Brainstorm',
      'Gilded Brainstorm Whelp',
    ]);
  });

  it('reads % and _ as plain text', () => {
    expect(names(searchCards(db, { q: '100%', limit: 20 }))).toEqual(['100% Off']);
    expect(searchCards(db, { q: '1_0', limit: 20 })).toEqual([]);
    expect(searchCards(db, { q: '_', limit: 20 })).toEqual([]);
  });

  it('matches the start of any word of the name, not the middle of one', () => {
    expect(names(searchCards(db, { q: 'cannon', limit: 20 }))).toEqual(['Jinx, Loose Cannon']);
    expect(names(searchCards(db, { q: 'LOOSE CAN', limit: 20 }))).toEqual(['Jinx, Loose Cannon']);
    expect(searchCards(db, { q: 'annon', limit: 20 })).toEqual([]);
    expect(searchCards(db, { q: 'storm', limit: 20 })).toEqual([]);
  });

  it('keeps only cards of the type asked for', () => {
    // Lux starts with "l", so it comes before Jinx, whose second word does.
    expect(names(searchCards(db, { q: 'l', type: 'legend', limit: 20 }))).toEqual([
      'Lux, Lady of Luminosity',
      'Jinx, Loose Cannon',
    ]);
  });

  it('keeps only cards whose domains fit inside the ones asked for', () => {
    const found = (domains: Domain[]) =>
      ['ember', 'jinx', 'lux', 'terminate'].flatMap((q) =>
        names(searchCards(db, { q, domains, limit: 20 })),
      );
    // Ember Signet has no domain, so it always fits; Lux (Order and Mind) doesn't fit Fury
    // and Chaos.
    expect(found(['fury', 'chaos'])).toEqual(['Ember Signet', 'Jinx, Loose Cannon', 'Terminate']);
    expect(found([])).toEqual(['Ember Signet']);
    expect(found(['chaos', 'fury'])).toEqual(found(['fury', 'chaos']));
  });

  it('keeps only cards with the supertype, champion and deckability asked for', () => {
    addCard(db, { name: 'Jinx, Rebel', type: 'unit', supertype: 'Champion', championTag: 'Jinx' });
    addCard(db, { name: 'Jinx Rocket Token', type: 'unit', supertype: 'Token', deckable: false });
    expect(names(searchCards(db, { q: 'jinx', supertype: 'champion', limit: 20 }))).toEqual([
      'Jinx, Rebel',
    ]);
    expect(names(searchCards(db, { q: 'jinx', championTag: 'JINX', limit: 20 }))).toEqual([
      'Jinx, Loose Cannon',
      'Jinx, Rebel',
    ]);
    expect(names(searchCards(db, { q: 'jinx', deckable: true, limit: 20 }))).toEqual([
      'Jinx, Loose Cannon',
      'Jinx, Rebel',
    ]);
    expect(names(searchCards(db, { q: 'jinx', deckable: false, limit: 20 }))).toEqual([
      'Jinx Rocket Token',
    ]);
  });

  it('takes the deck building filters through the API', async () => {
    addCard(db, { name: 'Jinx, Rebel', type: 'unit', supertype: 'Champion', championTag: 'Jinx' });
    addCard(db, { name: 'Jinx Rocket Token', type: 'unit', supertype: 'Token', deckable: false });
    setDb(db);
    const res = await client.cards.$get({
      query: { q: 'jinx', supertype: 'Champion', championTag: 'jinx', deckable: '1' },
    });
    expect(names(CardSearchResponse.parse(await res.json()).results)).toEqual(['Jinx, Rebel']);
    const all = await client.cards.$get({ query: { q: 'jinx' } });
    expect(CardSearchResponse.parse(await all.json()).results).toHaveLength(3);
  });

  it('answers through the API in the schema', async () => {
    setDb(db);
    const res = await client.cards.$get({
      query: { q: 'jinx', type: 'legend', domains: 'fury,chaos' },
    });
    expect(res.status).toBe(200);
    const { results } = CardSearchResponse.parse(await res.json());
    expect(results).toMatchObject([
      { name: 'Jinx, Loose Cannon', type: 'legend', championTag: 'Jinx', owned: 0, free: 0 },
    ]);
  });

  it('refuses a domain it does not know with 400 invalid_request', async () => {
    setDb(db);
    const res = await app.request('/api/cards?q=jinx&domains=fury,green');
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('invalid_request');
  });
});

describe('copy counts and card details', () => {
  let db: OpenDb;
  let cardId: number;

  beforeEach(() => {
    db = createTestDb();
    cardId = addCard(db, {
      name: 'Ember Signet',
      type: 'gear',
      energy: 2,
      rulesText: 'Exhaust: Add 1 energy.',
    });
    const sfd = addPrinting(db, cardId, { setCode: 'SFD', collectorNumber: '12' });
    const ogn = addPrinting(db, cardId, { setCode: 'OGN', collectorNumber: '53' });
    addPrinting(db, cardId, {
      setCode: 'OGN',
      collectorNumber: '9',
      finishes: ['normal', 'foil'],
      imageUrl: 'https://img/ogn-9.webp',
    });
    addPrinting(db, cardId, {
      setCode: 'OGN',
      collectorNumber: '1',
      alternateArt: true,
      imageUrl: 'https://img/alt.webp',
    });

    const box = addLocation(db, 'Long box', 'box');
    const deckBox = addLocation(db, 'Lux Control deck box', 'deck_box');
    addStack(db, sfd, box, 3); // in storage
    addStack(db, ogn, box, 1, true); // a proxy in storage
    addStack(db, ogn, deckBox, 2); // in a deck
    addStack(db, sfd, deckBox, 1, true); // a proxy in a deck
  });

  it('finds a card by its public code, in any case, with or without the set size', () => {
    expect(names(searchCards(db, { q: 'OGN-053', limit: 20 }))).toEqual(['Ember Signet']);
    expect(names(searchCards(db, { q: 'ogn-053/298', limit: 20 }))).toEqual(['Ember Signet']);
    expect(names(searchCards(db, { q: 'SFD-012/', limit: 20 }))).toEqual(['Ember Signet']);
    expect(searchCards(db, { q: 'OGN-054', limit: 20 })).toEqual([]);
  });

  it('finds a public code typed without its leading zeros', () => {
    expect(names(searchCards(db, { q: 'ogn-53', limit: 20 }))).toEqual(['Ember Signet']);
    expect(names(searchCards(db, { q: 'sfd-12/298', limit: 20 }))).toEqual(['Ember Signet']);
    expect(searchCards(db, { q: 'sfd-1', limit: 20 })).toEqual([]);
  });

  it('puts the exact public code before codes that only start with the text', () => {
    const whelp = addCard(db, { name: 'Ash Whelp', type: 'unit' });
    addPrinting(db, whelp, { setCode: 'OGN', collectorNumber: '5' });
    // OGN-005 is the code typed; OGN-053 (Ember Signet) only starts with "OGN-05".
    expect(names(searchCards(db, { q: 'ogn-05', limit: 20 }))).toEqual([
      'Ash Whelp',
      'Ember Signet',
    ]);
  });

  it('reads a variant letter in a public code', () => {
    const jinx = addCard(db, { name: 'Jinx, Demolitionist', type: 'unit' });
    addPrinting(db, jinx, { setCode: 'OGN', collectorNumber: '202a', publicCode: 'OGN-202a/298' });
    expect(names(searchCards(db, { q: 'OGN-202A', limit: 20 }))).toEqual(['Jinx, Demolitionist']);
    expect(searchCards(db, { q: 'OGN-202b', limit: 20 })).toEqual([]);
  });

  it('counts owned and free across printings in search results', () => {
    expect(searchCards(db, { q: 'signet', limit: 20 })).toMatchObject([
      { name: 'Ember Signet', owned: 7, free: 4 },
    ]);
  });

  it('answers the card, its printings by set and number, and its counts', () => {
    const details = cardDetails(db, cardId);
    expect(details).toBeDefined();
    if (!details) return;
    expect(details.card).toMatchObject({
      name: 'Ember Signet',
      type: 'gear',
      energy: 2,
      rulesText: 'Exhaust: Add 1 energy.',
      deckable: true,
      // The first printing that isn't alternate art gives the card's image.
      imageUrl: 'https://img/ogn-9.webp',
    });
    expect(details.printings.map((p) => `${p.setCode} ${p.collectorNumber}`)).toEqual([
      'OGN 9',
      'OGN 53',
      'SFD 12',
      'OGN 1',
    ]);
    expect(details.printings[0]).toMatchObject({
      publicCode: 'OGN-009/298',
      finishes: ['normal', 'foil'],
      unitPrice: { normal: null, foil: null },
    });
    expect(details.counts).toEqual({ owned: 7, proxies: 2, inDecks: 3, free: 4 });
  });

  it('answers zero counts for a card with no copies', () => {
    const other = addCard(db, { name: 'Sun Disc', type: 'gear' });
    expect(cardDetails(db, other)).toMatchObject({
      card: { name: 'Sun Disc', imageUrl: null },
      printings: [],
      counts: { owned: 0, proxies: 0, inDecks: 0, free: 0 },
    });
  });

  it('answers through the API in the schema, and 404 card_not_found', async () => {
    setDb(db);
    const res = await client.cards[':id'].$get({ param: { id: String(cardId) } });
    expect(res.status).toBe(200);
    expect(CardDetailsResponse.parse(await res.json()).counts.free).toBe(4);

    const missing = await client.cards[':id'].$get({ param: { id: '999' } });
    expect(missing.status).toBe(404);
    expect(ErrorBody.parse(await missing.json()).error.code).toBe('card_not_found');

    const bad = await app.request('/api/cards/not-an-id');
    expect(bad.status).toBe(400);
  });
});

describe('card search on full-size card data', () => {
  it('answers in under 100 ms with 5,000 cards', () => {
    const db = createTestDb();
    const words = ['Ember', 'Storm', 'Poro', 'Rune', 'Signet', 'Bolt', 'Dragon', 'Fox'];
    const types = ['unit', 'spell', 'gear', 'legend'] as const;
    const rows = Array.from({ length: 5_000 }, (_, i) => {
      const name = `${words[i % words.length]} ${words[(i * 7) % words.length]} ${i}`;
      return {
        name,
        nameKey: name.toLowerCase(),
        type: types[i % types.length] ?? 'unit',
        domains:
          ([[], ['fury'], ['calm', 'mind'], ['chaos'], ['order']] as Domain[][])[i % 5] ?? [],
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
      { q: 'po', limit: 20 },
      { q: 'zzz', limit: 20 },
      { q: 'dragon', type: 'legend' as const, domains: ['fury' as const], limit: 20 },
    ]) {
      const start = performance.now();
      searchCards(db, options);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });
});
