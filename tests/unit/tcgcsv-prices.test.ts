import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenDb } from '../../src/server/db/database';
import { cardDataStatus, printings } from '../../src/server/db/schema';
import { createTestDb, insertCard, insertPrinting } from '../../src/server/db/test-db';
import { CardDataSync, needsPrices, SYNC_AFTER_MS } from '../../src/server/riftcodex/sync';
import { TCGCSV_HEADERS } from '../../src/server/tcgcsv/fetch';
import { collectPrices, toCents, updatePrices } from '../../src/server/tcgcsv/prices';

// TCGCSV answers saved in tests/fixtures/tcgcsv, cut down from the live files of 2026-10-24:
// three groups (Origins, Spiritforged and Unleashed) and the prices of a few Origins and
// Spiritforged products. Unleashed has no saved prices, so it fails to load unless a test
// answers it.

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'tcgcsv');
const fixture = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));

const ORIGINS = 24344;
const SPIRITFORGED = 24519;
const UNLEASHED = 24560;

let db: OpenDb;
let fetchMock: ReturnType<typeof vi.fn>;
/** Groups whose prices answer 500. */
let failing: Set<number>;

beforeEach(() => {
  db = createTestDb();
  failing = new Set([UNLEASHED]);
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === '/tcgplayer/89/groups') return Response.json(fixture('groups.json'));
    const match = /^\/tcgplayer\/89\/(\d+)\/prices$/.exec(url.pathname);
    if (match) {
      const groupId = Number(match[1]);
      if (failing.has(groupId)) return new Response('Server error', { status: 500 });
      if (groupId === UNLEASHED) return Response.json({ success: true, errors: [], results: [] });
      return Response.json(fixture(`prices-${groupId}.json`));
    }
    throw new Error(`Unexpected request to ${input}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const card = insertCard(db, { name: 'Test Card' });
  const printing = (riftcodexId: string, tcgplayerId: number | null) =>
    insertPrinting(db, { riftcodexId, cardId: card, tcgplayerId, collectorNumber: riftcodexId });
  printing('1', 652771); // Origins: Normal $0.10 and Foil $0.20
  printing('2', 652778); // Origins: Foil $2.18 only
  printing('3', 635366); // Origins: Normal $12.43 only
  printing('4', 652817); // Origins: Normal $0.16, Foil with no market price
  printing('5', 663437); // Spiritforged: Normal $0.08 and Foil $0.27
  printing('6', 999999); // not in any group
  printing('7', null); // no TCGplayer id
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.$client.close();
});

const row = (riftcodexId: string) => {
  const p = db.select().from(printings).where(eq(printings.riftcodexId, riftcodexId)).get();
  return { normal: p?.priceNormal, foil: p?.priceFoil, finishes: p?.finishes };
};
const pricesUpdatedAt = () => db.select().from(cardDataStatus).get()?.pricesUpdatedAt ?? null;

describe('collectPrices', () => {
  it('stores dollars as whole cents and lists finishes from subtypes', () => {
    const products = collectPrices([
      { productId: 1, subTypeName: 'Foil', marketPrice: 0.27 },
      { productId: 1, subTypeName: 'Normal', marketPrice: 12.43 },
      { productId: 2, subTypeName: 'Foil', marketPrice: null },
      { productId: 3, subTypeName: 'Holofoil', marketPrice: 9 },
    ]);
    expect(products.get(1)).toEqual({
      priceNormal: 1243,
      priceFoil: 27,
      finishes: ['normal', 'foil'],
    });
    expect(products.get(2)).toEqual({ priceNormal: null, priceFoil: null, finishes: ['foil'] });
    expect(products.has(3)).toBe(false);
  });

  it('rounds to the nearest cent', () => {
    expect(toCents(0.08)).toBe(8);
    expect(toCents(1482.06)).toBe(148206);
    expect(toCents(null)).toBeNull();
  });
});

describe('updatePrices', () => {
  it('matches each printing by product id, in cents, with finishes from subtypes', async () => {
    failing.clear();
    const report = await updatePrices(db, { gapMs: 0 });

    expect(report).toEqual({ groupCount: 3, failedGroups: [], matchedPrintings: 5 });
    expect(row('1')).toEqual({ normal: 10, foil: 20, finishes: ['normal', 'foil'] });
    expect(row('2')).toEqual({ normal: null, foil: 218, finishes: ['foil'] });
    expect(row('3')).toEqual({ normal: 1243, foil: null, finishes: ['normal'] });
    expect(row('4')).toEqual({ normal: 16, foil: null, finishes: ['normal', 'foil'] });
    expect(row('5')).toEqual({ normal: 8, foil: 27, finishes: ['normal', 'foil'] });
    expect(pricesUpdatedAt()).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://tcgcsv.com/tcgplayer/89/groups', {
      headers: TCGCSV_HEADERS,
      signal: undefined,
    });
  });

  it('gives a printing with no entries no prices and both finishes', async () => {
    failing.clear();
    db.update(printings)
      .set({ priceNormal: 500, priceFoil: 900, finishes: ['foil'] })
      .run();
    await updatePrices(db, { gapMs: 0 });

    expect(row('6')).toEqual({ normal: null, foil: null, finishes: ['normal', 'foil'] });
    expect(row('7')).toEqual({ normal: null, foil: null, finishes: ['normal', 'foil'] });
  });

  it('keeps the old prices of printings it found no entry for while a group fails', async () => {
    db.update(printings)
      .set({ priceNormal: 500, priceFoil: 900, finishes: ['foil'] })
      .run();
    const report = await updatePrices(db, { gapMs: 0 });

    expect(report.failedGroups).toEqual(['Unleashed']);
    // The groups that loaded still update their printings.
    expect(row('1')).toEqual({ normal: 10, foil: 20, finishes: ['normal', 'foil'] });
    // A printing that may be in Unleashed keeps what it had.
    expect(row('6')).toEqual({ normal: 500, foil: 900, finishes: ['foil'] });
    expect(pricesUpdatedAt()).not.toBeNull();
  });

  it('keeps every old price when no group loads', async () => {
    failing = new Set([ORIGINS, SPIRITFORGED, UNLEASHED]);
    db.update(printings).set({ priceNormal: 500 }).run();
    await expect(updatePrices(db, { gapMs: 0 })).rejects.toThrow("Couldn't read any TCGCSV prices");
    expect(row('1').normal).toBe(500);
    expect(pricesUpdatedAt()).toBeNull();
  });

  it('keeps every old price when the groups can’t be read', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Down', { status: 503 }));
    await expect(updatePrices(db, { gapMs: 0 })).rejects.toThrow('TCGCSV answered 503');
    expect(row('1').normal).toBeNull();
    expect(pricesUpdatedAt()).toBeNull();
  });
});

describe('daily price updates', () => {
  it('needs prices with cards and no prices, or prices 24 hours old', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    expect(needsPrices(0, null, now)).toBe(false);
    expect(needsPrices(10, null, now)).toBe(true);
    expect(needsPrices(10, new Date(now - SYNC_AFTER_MS + 1).toISOString(), now)).toBe(false);
    expect(needsPrices(10, new Date(now - SYNC_AFTER_MS).toISOString(), now)).toBe(true);
  });

  it('updates prices alone when cards are fresh and prices are old', async () => {
    failing.clear();
    db.insert(cardDataStatus)
      .values({ id: 1, cardCount: 1, printingCount: 7, cardsSyncedAt: new Date().toISOString() })
      .run();
    const cardSync = new CardDataSync(db, true, { gapMs: 0 });
    await cardSync.check();
    await cardSync.finished();

    const hosts = fetchMock.mock.calls.map(([input]) => new URL(input as string).host);
    expect(new Set(hosts)).toEqual(new Set(['tcgcsv.com']));
    expect(row('1').normal).toBe(10);
    expect(cardSync.status().pricesUpdatedAt).not.toBeNull();
    expect(cardSync.status().state).toBe('ready');
  });
});
