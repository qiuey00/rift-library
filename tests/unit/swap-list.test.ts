import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import {
  cards,
  copyStacks,
  deckSlots,
  decks,
  locations,
  printings,
} from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { swapList } from '../../src/server/queries/swap-list';
import { createBatch, moveCopies } from '../../src/server/services/copies';
import { ErrorBody } from '../../src/shared/api/common';
import { SwapResponse } from '../../src/shared/api/swap';

const client = hc<AppType>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;
let inbox: number;
let binder: number;
let blackGreen: number;
let hearthhullBox: number;
let hearthhull: number;

const SIGNET = 'printing-arcane-signet';
const SIGNET_PROMO = 'printing-arcane-signet-promo';
const FARSEEK = 'printing-farseek';
const BALOTHS = 'printing-rampaging-baloths';
const URUG = 'printing-uurg';
const BREAKER = 'printing-world-breaker';
const HEARTHHULL = 'printing-hearthhull';

function location(
  name: string,
  type: typeof locations.$inferInsert.type,
  parentId?: number,
  position = 0,
) {
  return db
    .insert(locations)
    .values({ name, type, parentId, position })
    .returning({ id: locations.id })
    .get().id;
}

function card(scryfallId: string, name: string) {
  const oracleId = `oracle-${name}`;
  db.insert(cards)
    .values({ oracleId, name, frontFaceName: name, typeLine: 'Card', commanderLegality: 'legal' })
    .onConflictDoNothing()
    .run();
  db.insert(printings)
    .values({
      scryfallId,
      oracleId,
      setCode: 'eoc',
      setName: 'Edge of Eternities Commander',
      collectorNumber: scryfallId,
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      rarity: 'rare',
      releasedAt: '2025-08-01',
    })
    .run();
  return oracleId;
}

function stack(
  scryfallId: string,
  locationId: number,
  overrides: Partial<typeof copyStacks.$inferInsert> = {},
) {
  return db
    .insert(copyStacks)
    .values({
      scryfallId,
      quantity: 1,
      finish: 'nonfoil',
      condition: 'near_mint',
      language: 'en',
      locationId,
      ...overrides,
    })
    .returning({ id: copyStacks.id })
    .get().id;
}

/** Pulls copies from storage into the deck box the way the pick list does, setting came-from. */
function pull(stackId: number, quantity: number) {
  const batchId = createBatch(db, 'pick_list', { deckId: hearthhull });
  return moveCopies(db, stackId, quantity, hearthhullBox, {
    reason: 'assembled',
    batchId,
    deckId: hearthhull,
  }).destStackId;
}

function slot(
  oracleId: string,
  quantity = 1,
  board: 'commander' | 'main' | 'maybe' = 'main',
  pickedScryfallId: string | null = null,
) {
  return db
    .insert(deckSlots)
    .values({ deckId: hearthhull, oracleId, board, quantity, pickedScryfallId })
    .returning({ id: deckSlots.id })
    .get().id;
}

async function getSwap(deckId = hearthhull) {
  const res = await app.request(`/api/decks/${deckId}/swap`);
  expect(res.status).toBe(200);
  return SwapResponse.parse(await res.json());
}

const takeOut = (list: SwapResponse) =>
  list.takeOut.groups.map((group) => [
    group.location.path,
    group.lines.map((line) => [line.card.name, line.quantity]),
  ]);

let signet: string;
let farseek: string;
let baloths: string;
let uurg: string;
let breaker: string;
let commander: string;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  inbox = db.select().from(locations).get()?.id ?? 0;
  // Tree order: inbox, Long box › Black & Green, then Rares binder.
  binder = location('Rares binder', 'binder', undefined, 1);
  const longBox = location('Long box', 'box', undefined, 0);
  blackGreen = location('Black & Green', 'box', longBox, 0);
  hearthhullBox = location('Hearthhull deck box', 'deck_box');
  hearthhull = db
    .insert(decks)
    .values({ name: 'Hearthhull', deckBoxId: hearthhullBox })
    .returning({ id: decks.id })
    .get().id;
  signet = card(SIGNET, 'Arcane Signet');
  card(SIGNET_PROMO, 'Arcane Signet');
  farseek = card(FARSEEK, 'Farseek');
  baloths = card(BALOTHS, 'Rampaging Baloths');
  uurg = card(URUG, 'Uurg, Spawn of Turg');
  breaker = card(BREAKER, 'World Breaker');
  commander = card(HEARTHHULL, 'Hearthhull, the Worldseed');
});
afterEach(() => db.$client.close());

/** Hearthhull fully built: commander, Arcane Signet, two Farseek and Rampaging Baloths. */
function buildDeck() {
  slot(commander, 1, 'commander');
  slot(signet);
  slot(farseek, 2);
  const balothsSlot = slot(baloths);
  pull(stack(HEARTHHULL, binder), 1);
  pull(stack(SIGNET, binder), 1);
  pull(stack(FARSEEK, blackGreen, { quantity: 3 }), 2);
  pull(stack(BALOTHS, blackGreen), 1);
  return { balothsSlot };
}

describe('swapList', () => {
  it('is empty for an unchanged assembled deck', async () => {
    buildDeck();
    const list = await getSwap();
    expect(list.deck).toEqual({ id: hearthhull, name: 'Hearthhull', state: 'assembled' });
    expect(list.takeOut).toEqual({ groups: [], count: 0 });
    expect(list.pullIn).toEqual({
      groups: [],
      otherDecks: [],
      missing: [],
      basics: [],
      totals: { lines: 0, cards: 0 },
    });
    expect(list.counts).toEqual({ takeOut: 0, pullIn: 0 });
  });

  it("takes out a removed card's copies to their came-from location", async () => {
    const { balothsSlot } = buildDeck();
    db.$client.prepare('DELETE FROM deck_slots WHERE id = ?').run(balothsSlot);

    const list = await getSwap();
    expect(takeOut(list)).toEqual([['Long box › Black & Green', [['Rampaging Baloths', 1]]]]);
    const line = list.takeOut.groups[0].lines[0];
    expect(line.destination).toMatchObject({ id: blackGreen });
    expect(line.cameFrom).toMatchObject({ id: blackGreen });
    expect(list.counts).toEqual({ takeOut: 1, pullIn: 0 });
  });

  it('takes out only the extra copies when a quantity goes down', async () => {
    buildDeck();
    db.$client.prepare('UPDATE deck_slots SET quantity = 1 WHERE oracle_id = ?').run(farseek);

    const list = await getSwap();
    expect(takeOut(list)).toEqual([['Long box › Black & Green', [['Farseek', 1]]]]);
    expect(list.takeOut.count).toBe(1);
  });

  it('takes out maybe board cards in the box', async () => {
    buildDeck();
    db.$client.prepare("UPDATE deck_slots SET board = 'maybe' WHERE oracle_id = ?").run(baloths);
    expect(takeOut(await getSwap())).toEqual([
      ['Long box › Black & Green', [['Rampaging Baloths', 1]]],
    ]);
  });

  it('takes out proxies first, then printings no slot picked', async () => {
    slot(signet, 1, 'main', SIGNET);
    pull(stack(SIGNET, binder), 1);
    pull(stack(SIGNET_PROMO, binder), 1);
    stack(SIGNET, hearthhullBox, { isProxy: true });

    const list = await getSwap();
    expect(list.takeOut.groups.map((g) => g.location.id)).toEqual([inbox, binder]);
    const lines = list.takeOut.groups.flatMap((g) => g.lines);
    expect(lines.map((l) => [l.isProxy, l.printing.scryfallId])).toEqual([
      [true, SIGNET],
      [false, SIGNET_PROMO],
    ]);
    expect(list.counts.takeOut).toBe(2);
  });

  it('pulls in an added card like the pick list', async () => {
    buildDeck();
    slot(uurg);
    slot(breaker);
    const uurgStack = stack(URUG, blackGreen);
    const breakerStack = stack(BREAKER, binder);

    const list = await getSwap();
    expect(list.takeOut.count).toBe(0);
    expect(
      list.pullIn.groups.map((g) => [
        g.location.path,
        g.lines.map((l) => [l.card.name, l.suggested.stackId]),
      ]),
    ).toEqual([
      ['Long box › Black & Green', [['Uurg, Spawn of Turg', uurgStack]]],
      ['Rares binder', [['World Breaker', breakerStack]]],
    ]);
    expect(list.counts).toEqual({ takeOut: 0, pullIn: 2 });
  });

  it('is undefined for a deck that does not exist', () => {
    expect(swapList(db, 999)).toBeUndefined();
  });
});

describe('GET /api/decks/:id/swap', () => {
  it('answers 404 deck_not_found for a deleted deck', async () => {
    db.update(decks).set({ deletedAt: new Date().toISOString() }).run();
    const res = await app.request(`/api/decks/${hearthhull}/swap`);
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('deck_not_found');
  });

  it('is seen by the typed client', async () => {
    buildDeck();
    const res = await client.decks[':id'].swap.$get({ param: { id: String(hearthhull) } });
    const list: SwapResponse = await res.json();
    expect(list.counts).toEqual({ takeOut: 0, pullIn: 0 });
  });
});
