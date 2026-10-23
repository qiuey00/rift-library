import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenDb } from '../../src/server/db/database';
import { cards, printings } from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import {
  type CardIdentifier,
  COLLECTION_URL,
  lookupCards,
  ScryfallUnavailableError,
} from '../../src/server/scryfall/lookup';

const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'scryfall', 'default-cards.json');
const fixtureCards = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string>[];
const byId = (id: string) => fixtureCards.find((card) => card.id === id) as Record<string, string>;

const HEARTHHULL = '6b913e79-a9f6-44d4-bb37-c4f6f66b8151';
const HEARTHHULL_ORACLE = '8d6f82d9-5c5b-4c41-8857-c0936f2d894c';
const BLACK_LOTUS_ONLINE = 'bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd';
const DELVER = '6904ea20-e504-47da-95a0-08739fdde260';

/** Answers like Scryfall's collection endpoint, from the fixture cards. */
function scryfallAnswer(identifiers: CardIdentifier[]) {
  const data: unknown[] = [];
  const notFound: CardIdentifier[] = [];
  for (const identifier of identifiers) {
    const card = fixtureCards.find((candidate) =>
      'id' in identifier
        ? candidate.id === identifier.id
        : 'name' in identifier
          ? candidate.name === identifier.name ||
            candidate.name.split(' // ').includes(identifier.name)
          : candidate.set === identifier.set.toLowerCase() &&
            candidate.collector_number === identifier.collector_number,
    );
    if (card) data.push(card);
    else notFound.push(identifier);
  }
  return { object: 'list', not_found: notFound, data };
}

let db: OpenDb;
let fetchMock: ReturnType<typeof vi.fn>;
let requestTimes: number[];

beforeEach(() => {
  db = createTestDb();
  requestTimes = [];
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    requestTimes.push(Date.now());
    const { identifiers } = JSON.parse(init.body as string) as { identifiers: CardIdentifier[] };
    return new Response(JSON.stringify(scryfallAnswer(identifiers)), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  db.$client.close();
});

describe('lookupCards', () => {
  it('asks for 160 identifiers in 3 requests of at most 75, at least 100 ms apart', async () => {
    vi.useFakeTimers();
    const identifiers: CardIdentifier[] = Array.from({ length: 160 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    }));
    identifiers[0] = { id: HEARTHHULL };
    identifiers[100] = { id: DELVER };

    const lookup = lookupCards(db, identifiers);
    await vi.runAllTimersAsync();
    const result = await lookup;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map(
      ([, init]) => (JSON.parse(init.body) as { identifiers: unknown[] }).identifiers.length,
    );
    expect(sizes).toEqual([75, 75, 10]);
    expect(requestTimes[1] - requestTimes[0]).toBeGreaterThanOrEqual(100);
    expect(requestTimes[2] - requestTimes[1]).toBeGreaterThanOrEqual(100);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(COLLECTION_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'User-Agent': 'RiftLibrary/0.1',
      Accept: 'application/json',
    });

    expect(result.resolved.map((r) => r.scryfallId)).toEqual([HEARTHHULL, DELVER]);
    expect(result.not_found).toHaveLength(158);
  });

  it('writes the cards it finds and returns their ids', async () => {
    const result = await lookupCards(db, [
      { id: HEARTHHULL },
      { name: 'Insectile Aberration' },
      { set: 'C16', collector_number: '46' },
      { name: 'A Card Nobody Printed' },
    ]);

    expect(result.resolved).toEqual([
      { identifier: { id: HEARTHHULL }, scryfallId: HEARTHHULL, oracleId: HEARTHHULL_ORACLE },
      {
        identifier: { name: 'Insectile Aberration' },
        scryfallId: DELVER,
        oracleId: byId(DELVER).oracle_id,
      },
      {
        identifier: { set: 'C16', collector_number: '46' },
        scryfallId: '21e27b91-c7f1-4709-aa0d-8b5d81b22a0a',
        oracleId: byId('21e27b91-c7f1-4709-aa0d-8b5d81b22a0a').oracle_id,
      },
    ]);
    expect(result.not_found).toEqual([{ name: 'A Card Nobody Printed' }]);

    const card = db.select().from(cards).where(eq(cards.oracleId, HEARTHHULL_ORACLE)).get();
    expect(card).toMatchObject({ name: 'Hearthhull, the Worldseed', canBeCommander: true });
    const printing = db.select().from(printings).where(eq(printings.scryfallId, HEARTHHULL)).get();
    expect(printing).toMatchObject({ setCode: 'eoc', collectorNumber: '1' });
    expect(db.select().from(printings).all()).toHaveLength(3);
  });

  it('updates a card it already has', async () => {
    await lookupCards(db, [{ id: HEARTHHULL }]);
    const renamed = { ...byId(HEARTHHULL), set_name: 'Edge of Eternities Commander (new)' };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ object: 'list', not_found: [], data: [renamed] })),
    );
    await lookupCards(db, [{ id: HEARTHHULL }]);

    const rows = db.select().from(printings).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].setName).toBe('Edge of Eternities Commander (new)');
  });

  it('counts an online-only printing as not found', async () => {
    const result = await lookupCards(db, [{ id: BLACK_LOTUS_ONLINE }]);
    expect(result).toEqual({ resolved: [], not_found: [{ id: BLACK_LOTUS_ONLINE }] });
    expect(db.select().from(printings).all()).toHaveLength(0);
  });

  it('makes no request for no identifiers', async () => {
    expect(await lookupCards(db, [])).toEqual({ resolved: [], not_found: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws ScryfallUnavailableError when the network fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const error = await lookupCards(db, [{ id: HEARTHHULL }]).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ScryfallUnavailableError);
    expect(error).toMatchObject({
      status: 503,
      code: 'scryfall_unavailable',
      message: "Couldn't reach Scryfall; unknown cards are listed to fix or skip",
    });
  });

  it('throws ScryfallUnavailableError when Scryfall answers with an error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 503 }));
    await expect(lookupCards(db, [{ id: HEARTHHULL }])).rejects.toBeInstanceOf(
      ScryfallUnavailableError,
    );
  });

  it('never calls Scryfall with SCRYFALL_LOOKUP=off, as in the browser tests', async () => {
    vi.stubEnv('SCRYFALL_LOOKUP', 'off');
    await expect(lookupCards(db, [{ id: HEARTHHULL }])).rejects.toBeInstanceOf(
      ScryfallUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
