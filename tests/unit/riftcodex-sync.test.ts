import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { api } from '../../src/client/api';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import {
  cardDataStatus,
  cards,
  copyStacks,
  locations,
  printings,
} from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { RIFTCODEX_HEADERS } from '../../src/server/riftcodex/fetch';
import { lookupCardsByName } from '../../src/server/riftcodex/lookup';
import { nameKey } from '../../src/server/riftcodex/records';
import {
  CardDataSync,
  CHECK_INTERVAL_MS,
  needsSync,
  SYNC_AFTER_MS,
  setCardDataSync,
  syncCardData,
} from '../../src/server/riftcodex/sync';
import { CardDataStatus } from '../../src/shared/api/card-data';
import { ErrorBody } from '../../src/shared/api/common';

// Riftcodex answers saved in tests/fixtures/riftcodex, shaped like the real API's: two pages
// of cards (one record on page 1 is broken on purpose) and one page of sets.

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'riftcodex');
const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as {
    items: Record<string, unknown>[];
    page: number;
    pages: number;
  };

const HOUR = 60 * 60 * 1000;

// The typed client from src/client/api.ts, pointed at the app in memory.
const client: typeof api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;
let cardPages: ReturnType<typeof fixture>[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  db = createTestDb();
  cardPages = [fixture('cards-page-1.json'), fixture('cards-page-2.json')];
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    const page = Number(url.searchParams.get('page'));
    if (url.pathname === '/sets') return Response.json(fixture('sets.json'));
    if (url.pathname === '/cards') {
      const body = cardPages[page - 1];
      return body ? Response.json(body) : Response.json({ items: [], page, pages: 2 });
    }
    if (url.pathname === '/cards/name') {
      if (url.searchParams.get('fuzzy')?.toLowerCase().includes('rebel')) {
        return Response.json(fixture('name-jinx-rebel.json'));
      }
      return Response.json({ items: [], total: 0, page: 1, size: 100, pages: 0 });
    }
    throw new Error(`Unexpected request to ${input}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setCardDataSync(undefined);
  db.$client.close();
});

const requested = () => fetchMock.mock.calls.map(([url]) => new URL(url as string));
const sync = () => syncCardData(db, { gapMs: 0 });
const cardNamed = (name: string) =>
  db
    .select()
    .from(cards)
    .where(eq(cards.nameKey, nameKey(name)))
    .get();
const printingsOf = (cardId: number) =>
  db.select().from(printings).where(eq(printings.cardId, cardId)).all();

describe('the sync', () => {
  it('pages through the cards and sets, 100 records a request', async () => {
    await sync();

    const urls = requested();
    expect(urls.map((url) => `${url.pathname}?page=${url.searchParams.get('page')}`)).toEqual([
      '/sets?page=1',
      '/cards?page=1',
      '/cards?page=2',
    ]);
    for (const url of urls) {
      expect(url.origin).toBe('https://api.riftcodex.com');
      expect(url.searchParams.get('size')).toBe('100');
    }
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toEqual(RIFTCODEX_HEADERS);
    }
  });

  it('stops at the last page even when Riftcodex says there are more', async () => {
    cardPages[1] = { ...cardPages[1], items: [], pages: 5 } as ReturnType<typeof fixture>;
    await sync();
    expect(requested().filter((url) => url.pathname === '/cards')).toHaveLength(2);
  });

  it('pauses between requests', async () => {
    vi.useFakeTimers();
    const running = syncCardData(db, { gapMs: 200 });
    await vi.advanceTimersByTimeAsync(0);
    expect(requested()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(requested()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await running;
    expect(requested()).toHaveLength(3);
  });

  it('groups alternate art, promo, signature and overnumbered printings into one card', async () => {
    await sync();

    const rebel = cardNamed('Jinx - Rebel');
    expect(rebel).toMatchObject({
      name: 'Jinx - Rebel',
      nameKey: 'jinx rebel',
      type: 'unit',
      supertype: 'champion',
      domains: ['chaos'],
      energy: 5,
      might: 5,
      power: 1,
      championTag: 'Jinx',
      deckable: true,
    });
    expect(rebel?.rulesText).toMatch(/^When you discard/);
    const rebelPrintings = printingsOf(rebel?.id ?? 0);
    expect(rebelPrintings.map((p) => p.publicCode).sort()).toEqual([
      'OGN-202/298',
      'OGN-202a/298',
      'PR-202/298',
    ]);
    expect(rebelPrintings.find((p) => p.publicCode === 'OGN-202a/298')).toMatchObject({
      alternateArt: true,
      collectorNumber: '202a',
      rarity: 'showcase',
      setName: 'Origins',
      tcgplayerId: 652994,
    });
    // The set's name comes from the sets list.
    expect(rebelPrintings.find((p) => p.setCode === 'PR')?.setName).toBe(
      'Riftbound Promotional Cards',
    );

    // Listed first, but the signature printing's "(Signature)" isn't part of the card's name.
    const cannon = cardNamed('Jinx - Loose Cannon');
    expect(cannon).toMatchObject({
      name: 'Jinx - Loose Cannon',
      type: 'legend',
      championTag: 'Jinx',
    });
    expect(cannon?.domains).toEqual(['fury', 'chaos']);
    expect(printingsOf(cannon?.id ?? 0).find((p) => p.signature)?.publicCode).toBe('OGN-301*/298');

    // Riftcodex writes the overnumbered printing with a comma.
    const demolitionist = cardNamed('Jinx, Demolitionist');
    expect(demolitionist?.name).toBe('Jinx - Demolitionist');
    expect(
      printingsOf(demolitionist?.id ?? 0)
        .map((p) => p.riftboundId)
        .sort(),
    ).toEqual(['ogn-030-298', 'ven-168-166']);
  });

  it('marks tokens not deckable and leaves out the colorless domain', async () => {
    await sync();

    expect(cardNamed('Gold // Buff')).toMatchObject({
      type: 'token',
      supertype: 'token',
      domains: [],
      deckable: false,
    });
    expect(cardNamed('Grove of the God-Willow')).toMatchObject({
      type: 'battlefield',
      domains: [],
      championTag: null,
      deckable: true,
    });
    const rune = cardNamed('Fury Rune');
    expect(rune).toMatchObject({ type: 'rune', supertype: 'basic', domains: ['fury'] });
    expect(
      printingsOf(rune?.id ?? 0)
        .map((p) => p.publicCode)
        .sort(),
    ).toEqual(['OGN-007/298', 'VEN-r01']);
    const token = db.select().from(printings).where(eq(printings.riftboundId, 'sfd-t03')).get();
    expect(token?.tcgplayerId).toBeNull();
  });

  it('skips and counts a record that fails the schema, and reports disagreeing printings', async () => {
    const report = await sync();

    expect(report.skipped).toBe(1);
    expect(cardNamed('Broken Record')).toBeUndefined();
    expect(report.disagreements).toEqual([
      { name: 'Acceptable Losses', field: 'domains', values: ['chaos', 'order'] },
    ]);
    expect(report).toMatchObject({ cardCount: 7, printingCount: 13, keptPrintings: 0 });
    expect(db.select().from(cardDataStatus).get()).toMatchObject({
      cardCount: 7,
      printingCount: 13,
    });
  });

  it('updates cards and printings in place and keeps their prices', async () => {
    await sync();
    const rebel = cardNamed('Jinx - Rebel');
    db.update(printings)
      .set({ priceNormal: 1250, finishes: ['foil'] })
      .where(eq(printings.riftboundId, 'ogn-202-298'))
      .run();

    const first = cardPages[0]?.items[0] as { media: { artist: string } };
    first.media.artist = 'Someone Else';
    await sync();

    expect(cardNamed('Jinx - Rebel')?.id).toBe(rebel?.id);
    expect(
      db.select().from(printings).where(eq(printings.riftboundId, 'ogn-202-298')).get(),
    ).toMatchObject({
      artist: 'Someone Else',
      priceNormal: 1250,
      finishes: ['foil'],
    });
  });

  it('keeps a printing Riftcodex drops while a copy stack points at it, and removes the rest', async () => {
    await sync();
    const inbox = db.select().from(locations).get();
    const promo = db.select().from(printings).where(eq(printings.riftboundId, 'pr-202-298')).get();
    db.insert(copyStacks)
      .values({
        printingId: promo?.riftcodexId ?? '',
        quantity: 1,
        finish: 'normal',
        condition: 'near_mint',
        language: 'en',
        locationId: inbox?.id ?? 0,
      })
      .run();

    const dropped = new Set(['pr-202-298', 'ogn-202a-298', 'ogn-280-298']);
    for (const page of cardPages) {
      page.items = page.items.filter((item) => !dropped.has(String(item.riftbound_id)));
    }
    const report = await sync();

    const left = db
      .select({ id: printings.riftboundId })
      .from(printings)
      .all()
      .map((p) => p.id);
    expect(left).toContain('pr-202-298');
    expect(left).not.toContain('ogn-202a-298');
    expect(report.keptPrintings).toBe(1);
    // A card with no printings left goes too.
    expect(cardNamed('Grove of the God-Willow')).toBeUndefined();
  });
});

describe('the 24-hour check', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');

  it('syncs with no cards, never synced, or synced 24 hours ago', () => {
    expect(needsSync(0, null, now)).toBe(true);
    expect(needsSync(0, new Date(now - HOUR).toISOString(), now)).toBe(true);
    expect(needsSync(10, null, now)).toBe(true);
    expect(needsSync(10, new Date(now - 23 * HOUR).toISOString(), now)).toBe(false);
    expect(needsSync(10, new Date(now - SYNC_AFTER_MS).toISOString(), now)).toBe(true);
  });

  it('syncs on start with no cards, then again once the sync is 24 hours old', async () => {
    vi.useFakeTimers({ now, toFake: ['setInterval', 'clearInterval', 'Date'] });
    const cardSync = new CardDataSync(db, true, { gapMs: 0 });
    expect(cardSync.status()).toMatchObject({ state: 'idle', progress: 0, cardCount: 0 });

    cardSync.start();
    await cardSync.finished();
    const cardRequests = () => requested().filter((url) => url.pathname === '/cards').length;
    expect(cardRequests()).toBe(2);
    expect(CardDataStatus.parse(cardSync.status())).toMatchObject({
      state: 'ready',
      progress: 1,
      cardsSyncedAt: new Date(now).toISOString(),
      cardCount: 7,
      printingCount: 13,
      error: null,
    });

    // Each hourly check before the 24 hours are up does nothing.
    await vi.advanceTimersByTimeAsync(23 * CHECK_INTERVAL_MS);
    await cardSync.finished();
    expect(cardRequests()).toBe(2);

    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    await cardSync.finished();
    expect(cardRequests()).toBe(4);
    cardSync.stop();
  });

  it('does not sync on start when the cards and prices are less than 24 hours old', async () => {
    await sync();
    db.update(cardDataStatus).set({ pricesUpdatedAt: new Date().toISOString() }).run();
    fetchMock.mockClear();
    const cardSync = new CardDataSync(db, true, { gapMs: 0 });
    cardSync.start();
    await cardSync.finished();
    cardSync.stop();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never calls Riftcodex when turned off', async () => {
    const cardSync = new CardDataSync(db, false);
    cardSync.start();
    await cardSync.check();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => cardSync.refresh()).toThrow(/turned off/);
  });
});

describe('the card data routes', () => {
  beforeEach(() => {
    setDb(db);
  });

  it('refresh starts a sync, answers 409 while it runs, and the status follows it', async () => {
    const cardSync = new CardDataSync(db, true, { gapMs: 0 });
    setCardDataSync(cardSync);

    const res = await client['card-data'].refresh.$post();
    expect(res.status).toBe(200);
    expect(CardDataStatus.parse(await res.json())).toMatchObject({ state: 'downloading' });

    const again = await client['card-data'].refresh.$post();
    expect(again.status).toBe(409);
    expect(ErrorBody.parse(await again.json()).error.code).toBe('refresh_running');

    await cardSync.finished();
    const status = await client['card-data'].status.$get();
    expect(CardDataStatus.parse(await status.json())).toMatchObject({
      state: 'ready',
      cardCount: 7,
    });
  });

  it('a failed sync answers error and keeps the cards loaded before', async () => {
    const cardSync = new CardDataSync(db, true, { gapMs: 0 });
    setCardDataSync(cardSync);
    await sync();
    db.update(cardDataStatus).set({ cardsSyncedAt: '2026-10-11T21:02:17.000Z' }).run();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    cardSync.refresh();
    await cardSync.finished();
    const status = CardDataStatus.parse(await (await client['card-data'].status.$get()).json());
    expect(status).toMatchObject({ state: 'error', cardCount: 7 });
    expect(status.error).toBe(
      "Couldn't reach Riftcodex, so the app is still using the card data from October 11. Check the internet connection and press Refresh card data to try again.",
    );
    expect(cardNamed('Jinx - Rebel')).toBeDefined();
  });
});

describe('looking up unknown names', () => {
  beforeEach(() => {
    vi.stubEnv('RIFTCODEX', 'on');
  });

  it('asks Riftcodex with fuzzy matching and writes what it finds', async () => {
    const result = await lookupCardsByName(db, ['jinx rebel', 'Nobody Knows Me'], { gapMs: 0 });

    const names = requested().map((url) => url.searchParams.get('fuzzy'));
    expect(names).toEqual(['jinx rebel', 'Nobody Knows Me']);
    const rebel = cardNamed('Jinx - Rebel');
    expect(result).toEqual({
      resolved: [{ name: 'jinx rebel', cardId: rebel?.id }],
      notFound: ['Nobody Knows Me'],
    });
    expect(printingsOf(rebel?.id ?? 0)).toHaveLength(3);
  });

  it('answers 503 when Riftcodex is off or unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(lookupCardsByName(db, ['Jinx - Rebel'])).rejects.toMatchObject({
      status: 503,
      code: 'riftcodex_unavailable',
    });
    vi.stubEnv('RIFTCODEX', 'off');
    await expect(lookupCardsByName(db, ['Jinx - Rebel'])).rejects.toMatchObject({ status: 503 });
  });
});
