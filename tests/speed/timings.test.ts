import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { createTestDb } from '../../src/server/db/test-db';
import { type BigCollection, seedBigCollection } from './big-collection';

// How long the server takes to answer the screens' requests with a collection the size of
// Jeff's (PLAT-6). Each action runs a few times to warm up, then the median of several runs
// must fit its budget. The times include routing, checking and turning the answer into JSON.

const WARM_UP = 2;
const RUNS = 7;

let db: OpenDb;
let big: BigCollection;
/** The day with the most movements, as History's `before`. */
let busiestDay: string;
const timings: { action: string; budget: number; median: number }[] = [];

beforeAll(() => {
  db = createTestDb();
  big = seedBigCollection(db);
  setDb(db);
  busiestDay =
    db.$client
      .prepare<[], { day: string }>(
        'SELECT substr(created_at, 1, 10) AS day FROM movements GROUP BY day ORDER BY count(*) DESC LIMIT 1',
      )
      .get()?.day ?? '';
});

afterAll(() => {
  console.table(timings);
  db.$client.close();
});

async function get(url: string) {
  const res = await app.request(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`${url} answered ${res.status}: ${body}`);
  return JSON.parse(body) as unknown;
}

/** The median time of `action` in milliseconds, after warming up. */
async function median(action: () => Promise<unknown>) {
  for (let i = 0; i < WARM_UP; i += 1) await action();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now();
    await action();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(RUNS / 2)] as number;
}

async function check(action: string, budget: number, run: () => Promise<unknown>) {
  const ms = Math.round((await median(run)) * 10) / 10;
  timings.push({ action, budget, median: ms });
  expect(ms, `${action} took ${ms} ms`).toBeLessThan(budget);
}

describe('with about 10,000 copies', () => {
  it('builds a collection the size of Jeff’s', () => {
    expect(big.cards).toBe(35_000);
    expect(big.printings).toBeGreaterThan(90_000);
    expect(big.locations).toBe(40);
    expect(big.stacks).toBe(7_000);
    expect(big.copies).toBeGreaterThan(9_000);
    expect(big.decks).toBe(15);
    expect(big.movements).toBeGreaterThan(49_000);
  });

  it('searches cards within 100 ms', async () => {
    await check('card search "dra"', 100, () => get('/api/cards/search?q=dra'));
    await check('card search "ember golem"', 100, () => get('/api/cards/search?q=ember%20golem'));
    await check('commander search', 100, () =>
      get('/api/cards/search?q=a&commander=1&identity=BG'),
    );
  });

  it('answers a Collection filter page within 200 ms', async () => {
    await check('Collection, first page', 200, () => get('/api/stacks'));
    await check('Collection, t:creature c:g', 200, () =>
      get(`/api/stacks?q=${encodeURIComponent('t:creature c:g')}`),
    );
    const first = (await get('/api/stacks?limit=1000')) as { nextCursor: string };
    await check('Collection, a later page', 200, () =>
      get(`/api/stacks?cursor=${first.nextCursor}`),
    );
    await check('Collection, loc:"Closet"', 200, () =>
      get(`/api/stacks?q=${encodeURIComponent('loc:Closet')}`),
    );
  });

  it('works out a deck view and its checks within 300 ms', async () => {
    for (const [label, id] of [
      ['assembled', big.deckId],
      ['not assembled', big.unassembledDeckId],
    ] as const) {
      await check(`deck view and checks, ${label}`, 300, () =>
        Promise.all([get(`/api/decks/${id}`), get(`/api/decks/${id}/checks`)]),
      );
    }
  });

  it('works out a pick list within 300 ms', async () => {
    await check('pick list, not assembled', 300, () =>
      get(`/api/decks/${big.unassembledDeckId}/pick-list`),
    );
    await check('pick list, assembled', 300, () => get(`/api/decks/${big.deckId}/pick-list`));
  });

  it('exports the collection CSV within 2 seconds, a location at a time', async () => {
    const chunks: number[] = [];
    await check('collection CSV export', 2000, async () => {
      const res = await app.request('/api/exports/collection.csv');
      if (!res.ok || !res.body) throw new Error(`The CSV export answered ${res.status}`);
      chunks.length = 0;
      for await (const chunk of res.body) chunks.push(chunk.byteLength);
    });
    // Streamed: the file arrives in many pieces, none of them close to the whole file.
    const size = chunks.reduce((sum, bytes) => sum + bytes, 0);
    expect(chunks.length).toBeGreaterThan(big.locations / 2);
    expect(Math.max(...chunks)).toBeLessThan(size / 4);
  });

  it('shows one day of History within 200 ms', async () => {
    await check('History, today', 200, () => get('/api/history?offset=0'));
    await check('History, busiest day', 200, () =>
      get(`/api/history?offset=0&before=${busiestDay}`),
    );
    await check('History, one card', 200, () =>
      get(`/api/history?offset=0&card=${big.busyOracleId}`),
    );
  });

  it('works out values and trade locations within 200 ms', async () => {
    await check('location tree with values', 200, () => get('/api/locations/tree'));
    await check('Collection, sorted by value', 200, () => get('/api/stacks?sort=value'));
    const first = (await get('/api/stacks?sort=value&limit=1000')) as { nextCursor: string };
    await check('Collection, sorted by value, a later page', 200, () =>
      get(`/api/stacks?sort=value&cursor=${first.nextCursor}`),
    );
    await check('Collection, trade:yes', 200, () =>
      get(`/api/stacks?q=${encodeURIComponent('trade:yes')}`),
    );
    await check('collection value', 200, () => get('/api/collection/value'));
  });
});
