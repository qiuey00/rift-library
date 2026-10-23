import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { isNotNull } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { api } from '../../src/client/api';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { printings } from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { loadBulkFile } from '../../src/server/scryfall/load';
import {
  BULK_DATA_URL,
  CardDataSync,
  CHECK_INTERVAL_MS,
  DOWNLOAD_FILE,
  needsDownload,
  setCardDataSync,
} from '../../src/server/scryfall/sync';
import { CardDataStatus } from '../../src/shared/api/card-data';
import { ErrorBody } from '../../src/shared/api/common';

const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'scryfall', 'default-cards.json');
const fixtureCards = JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown[];
/** The fixture as Scryfall serves Default Cards: gzipped JSON Lines. */
const JSONL_GZ = gzipSync(fixtureCards.map((card) => JSON.stringify(card)).join('\n'));

const JSONL_URI = 'https://data.scryfall.io/default-cards/default-cards-20261019.jsonl.gz';
const JSON_URI = 'https://data.scryfall.io/default-cards/default-cards-20261019.json';
const DAY = 24 * 60 * 60 * 1000;

const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

// The typed client from src/client/api.ts, pointed at the app in memory.
const client: typeof api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;
let dataDir: string;
let sync: CardDataSync;
let scryfallUpdatedAt: string;
let entry: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
/** Answers the file download; tests swap it for a failing or slow one. */
let download: () => Response;

beforeEach(async () => {
  db = createTestDb();
  dataDir = await mkdtemp(path.join(tmpdir(), 'log-sync-'));
  sync = new CardDataSync(db, dataDir);
  scryfallUpdatedAt = daysAgo(0.5);
  entry = {
    object: 'bulk_data',
    type: 'default_cards',
    updated_at: scryfallUpdatedAt,
    size: JSONL_GZ.length,
    download_uri: null,
    jsonl_download_uri: JSONL_URI,
  };
  download = () => new Response(JSONL_GZ, { status: 200 });
  fetchMock = vi.fn(async (url: string) => {
    if (url === BULK_DATA_URL) {
      const others = [{ object: 'bulk_data', type: 'oracle_cards', updated_at: daysAgo(0) }];
      return Response.json({ object: 'list', data: [...others, entry] });
    }
    if (url === entry.jsonl_download_uri || url === entry.download_uri) return download();
    throw new Error(`Unexpected request to ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  sync.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db.$client.close();
  await rm(dataDir, { recursive: true, force: true });
});

const requestedUrls = () => fetchMock.mock.calls.map(([url]) => url as string);

/** Loads the fixture as if it came from a file Scryfall made at `bulkUpdatedAt`. */
async function loadExisting(bulkUpdatedAt: string) {
  await loadBulkFile(db, FIXTURE, { bulkUpdatedAt });
  return sync.status();
}

describe('the check', () => {
  it('downloads jsonl_download_uri when there is no card data yet, then deletes the file', async () => {
    expect(sync.status()).toMatchObject({ state: 'idle', progress: 0, cardCount: 0 });

    await sync.check();

    expect(requestedUrls()).toEqual([BULK_DATA_URL, JSONL_URI]);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({
        'User-Agent': 'RiftLibrary/0.1',
        Accept: 'application/json',
      });
    }
    const status = CardDataStatus.parse(sync.status());
    expect(status).toMatchObject({
      state: 'ready',
      progress: 1,
      bulkUpdatedAt: scryfallUpdatedAt,
      error: null,
    });
    expect(status.cardCount).toBeGreaterThan(0);
    expect(status.printingCount).toBeGreaterThanOrEqual(status.cardCount);
    expect(Date.now() - Date.parse(status.lastCheckedAt ?? '')).toBeLessThan(60_000);
    expect(existsSync(path.join(dataDir, DOWNLOAD_FILE))).toBe(false);
    expect(await readdir(path.join(dataDir, 'scryfall'))).toEqual([]);
  });

  it("does not download when the loaded file is as new as Scryfall's", async () => {
    const before = await loadExisting(scryfallUpdatedAt);

    await sync.check();

    expect(requestedUrls()).toEqual([BULK_DATA_URL]);
    expect(sync.status()).toMatchObject({
      state: 'ready',
      bulkUpdatedAt: before.bulkUpdatedAt,
      cardCount: before.cardCount,
    });
    expect(sync.status().lastCheckedAt).not.toBeNull();
  });

  it('downloads whenever Scryfall has a newer file, even one a day newer', async () => {
    await loadExisting(daysAgo(1.5));

    await sync.check();

    expect(requestedUrls()).toEqual([BULK_DATA_URL, JSONL_URI]);
    expect(sync.status()).toMatchObject({ state: 'ready', bulkUpdatedAt: scryfallUpdatedAt });
  });

  it('does not download an old file again when Scryfall has nothing newer', async () => {
    const old = daysAgo(8);
    entry.updated_at = old;
    await loadExisting(old);

    await sync.check();

    expect(requestedUrls()).toEqual([BULK_DATA_URL]);
  });

  it('downloads again when the loaded card data has no prices yet', async () => {
    await loadExisting(scryfallUpdatedAt);
    db.update(printings).set({ priceUsd: null, priceUsdFoil: null, priceUsdEtched: null }).run();

    await sync.check();

    expect(requestedUrls()).toEqual([BULK_DATA_URL, JSONL_URI]);
    const priced = db.select().from(printings).where(isNotNull(printings.priceUsd)).all();
    expect(priced.length).toBeGreaterThan(0);
  });

  it('falls back to download_uri when jsonl_download_uri is missing', async () => {
    entry.jsonl_download_uri = undefined;
    entry.download_uri = JSON_URI;

    await sync.check();

    expect(requestedUrls()).toEqual([BULK_DATA_URL, JSON_URI]);
    expect(sync.status().state).toBe('ready');
  });

  it('keeps the data and records the error when the check fails, then clears it at the next one', async () => {
    const before = await loadExisting('2026-10-11T21:02:17.000Z');
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await sync.check();

    const failed = CardDataStatus.parse(sync.status());
    expect(failed).toMatchObject({
      state: 'error',
      bulkUpdatedAt: before.bulkUpdatedAt,
      cardCount: before.cardCount,
      printingCount: before.printingCount,
    });
    expect(failed.error).toContain('still using the data from October 11');
    expect(failed.lastCheckedAt).not.toBeNull();

    await sync.check();

    expect(sync.status()).toMatchObject({ state: 'ready', error: null });
  });

  it('keeps the data when the download fails part way, and deletes the partial file', async () => {
    const before = await loadExisting(daysAgo(8));
    download = () => new Response('Service Unavailable', { status: 503 });

    await sync.check();

    expect(sync.status()).toMatchObject({
      state: 'error',
      bulkUpdatedAt: before.bulkUpdatedAt,
      cardCount: before.cardCount,
    });
    expect(existsSync(path.join(dataDir, DOWNLOAD_FILE))).toBe(false);
  });

  it('reports download progress as bytes received out of the size Scryfall gives', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    download = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start: (c) => {
            controller = c;
          },
        }),
      );
    const half = Math.floor(JSONL_GZ.length / 2);

    const done = sync.check();
    await vi.waitFor(() => expect(controller).toBeDefined());
    controller.enqueue(JSONL_GZ.subarray(0, half));
    await vi.waitFor(() =>
      expect(sync.status()).toMatchObject({
        state: 'downloading',
        progress: half / JSONL_GZ.length,
      }),
    );
    controller.enqueue(JSONL_GZ.subarray(half));
    controller.close();
    await done;

    expect(sync.status()).toMatchObject({ state: 'ready', progress: 1 });
  });

  it('checks again every 24 hours', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await loadExisting(scryfallUpdatedAt);

    sync.start();
    await sync.finished();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    await sync.finished();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    await sync.finished();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never calls Scryfall when turned off', async () => {
    const off = new CardDataSync(db, dataDir, false);
    off.start();
    await off.check();
    expect(() => off.refresh()).toThrow(expect.objectContaining({ code: 'card_data_sync_off' }));
    expect(fetchMock).not.toHaveBeenCalled();
    off.stop();
  });
});

describe('needsDownload', () => {
  it('downloads with no data, no prices, or a newer file', () => {
    expect(needsDownload(0, null, '2026-10-19T21:00:00Z')).toBe(true);
    expect(needsDownload(10, null, '2026-10-19T21:00:00Z')).toBe(true);
    expect(needsDownload(10, '2026-10-18T21:00:00Z', '2026-10-19T21:00:00Z')).toBe(true);
    expect(needsDownload(10, '2026-10-19T21:00:00Z', '2026-10-19T21:00:00Z')).toBe(false);
    expect(needsDownload(10, '2026-10-19T21:00:00Z', '2026-10-19T21:00:00Z', false)).toBe(true);
  });
});

describe('card data routes through the typed client', () => {
  beforeEach(() => {
    setDb(db);
    setCardDataSync(sync);
  });
  afterEach(() => setCardDataSync(undefined));

  it('answers the real status', async () => {
    const empty = await client['card-data'].status.$get();
    expect(empty.status).toBe(200);
    expect(CardDataStatus.parse(await empty.json())).toMatchObject({ state: 'idle', cardCount: 0 });

    const loaded = await loadExisting('2026-10-18T09:05:12.000Z');
    const res = await client['card-data'].status.$get();
    expect(CardDataStatus.parse(await res.json())).toEqual(loaded);
    expect(loaded).toMatchObject({ state: 'ready', bulkUpdatedAt: '2026-10-18T09:05:12.000Z' });
  });

  it('refreshes whatever the age, and answers 409 refresh_running while one runs', async () => {
    await loadExisting(daysAgo(0.1));

    const res = await client['card-data'].refresh.$post();
    expect(res.status).toBe(200);
    expect(CardDataStatus.parse(await res.json())).toMatchObject({
      state: 'downloading',
      progress: 0,
    });

    const again = await client['card-data'].refresh.$post();
    expect(again.status).toBe(409);
    expect(ErrorBody.parse(await again.json()).error.code).toBe('refresh_running');

    await sync.finished();
    expect(requestedUrls()).toEqual([BULK_DATA_URL, JSONL_URI]);
    const done = await client['card-data'].status.$get();
    expect(CardDataStatus.parse(await done.json())).toMatchObject({
      state: 'ready',
      bulkUpdatedAt: scryfallUpdatedAt,
    });
  });
});
