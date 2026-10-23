import { asc, eq } from 'drizzle-orm';
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
  movementBatches,
  movements,
  printings,
} from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { ErrorBody } from '../../src/shared/api/common';
import { ProxyResult, PullResult } from '../../src/shared/api/pulls';

const client = hc<AppType>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;
let inbox: number;
let binder: number;
let hearthhullBox: number;
let atraxaBox: number;
let hearthhull: number;
let atraxa: number;
let signetSlot: number;
let soulSlot: number;

const SIGNET = 'printing-arcane-signet';
const SIGNET_OTHER = 'printing-arcane-signet-2';
const SOUL = 'printing-soul-of-windgrace';
const SOUL_JA = 'printing-soul-of-windgrace-ja';

function location(name: string, type: typeof locations.$inferInsert.type) {
  return db.insert(locations).values({ name, type }).returning({ id: locations.id }).get().id;
}

function card(oracleId: string, name: string) {
  db.insert(cards)
    .values({
      oracleId,
      name,
      frontFaceName: name,
      typeLine: 'Artifact',
      commanderLegality: 'legal',
    })
    .run();
}

function printing(scryfallId: string, oracleId: string, lang = 'en') {
  db.insert(printings)
    .values({
      scryfallId,
      oracleId,
      setCode: 'cmm',
      setName: 'Commander Masters',
      collectorNumber: '1',
      lang,
      finishes: ['nonfoil', 'foil'],
      rarity: 'uncommon',
      releasedAt: '2023-08-04',
    })
    .run();
}

function deck(name: string, deckBoxId: number) {
  return db.insert(decks).values({ name, deckBoxId }).returning({ id: decks.id }).get().id;
}

function slot(deckId: number, oracleId: string, pickedScryfallId: string | null = null) {
  return db
    .insert(deckSlots)
    .values({ deckId, oracleId, board: 'main', quantity: 1, pickedScryfallId })
    .returning({ id: deckSlots.id })
    .get().id;
}

function stack(overrides: Partial<typeof copyStacks.$inferInsert> = {}) {
  return db
    .insert(copyStacks)
    .values({
      scryfallId: SIGNET,
      quantity: 1,
      finish: 'nonfoil',
      condition: 'near_mint',
      language: 'en',
      locationId: binder,
      ...overrides,
    })
    .returning({ id: copyStacks.id })
    .get().id;
}

const stacks = () => db.select().from(copyStacks).orderBy(asc(copyStacks.id)).all();
const allMovements = () => db.select().from(movements).orderBy(asc(movements.id)).all();
const getSlot = (id: number) => db.select().from(deckSlots).where(eq(deckSlots.id, id)).get();

function pull(
  deckId: number,
  json: { slotId: number; stackId: number; quantity: number; batchId?: number },
  reason?: 'assembled' | 'swapped_in',
) {
  return client.decks[':id'].pulls.$post({
    param: { id: String(deckId) },
    json: { ...json, reason },
  });
}

function proxy(deckId: number, json: { slotId: number; scryfallId: string; batchId?: number }) {
  return client.decks[':id'].proxies.$post({
    param: { id: String(deckId) },
    json: { quantity: 1, ...json },
  });
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(ErrorBody.parse(await res.json()).error.code).toBe(code);
}

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  inbox = db.select().from(locations).get()?.id ?? 0;
  binder = location('Rares binder', 'binder');
  hearthhullBox = location('Hearthhull deck box', 'deck_box');
  atraxaBox = location('Atraxa deck box', 'deck_box');
  hearthhull = deck('Hearthhull', hearthhullBox);
  atraxa = deck('Atraxa', atraxaBox);
  card('oracle-signet', 'Arcane Signet');
  card('oracle-soul', 'Soul of Windgrace');
  printing(SIGNET, 'oracle-signet');
  printing(SIGNET_OTHER, 'oracle-signet');
  printing(SOUL, 'oracle-soul');
  printing(SOUL_JA, 'oracle-soul', 'ja');
  signetSlot = slot(hearthhull, 'oracle-signet', SIGNET_OTHER);
  soulSlot = slot(hearthhull, 'oracle-soul');
});
afterEach(() => db.$client.close());

describe('POST /api/decks/:id/pulls', () => {
  it('moves the copy into the deck box, sets came-from and the picked printing', async () => {
    const source = stack({ quantity: 3 });
    const res = await pull(hearthhull, { slotId: signetSlot, stackId: source, quantity: 1 });
    expect(res.status).toBe(200);
    const result = PullResult.parse(await res.json());
    expect(result).toMatchObject({
      message: 'Pulled Arcane Signet into Hearthhull deck box',
      otherDeck: null,
    });

    expect(stacks()).toEqual([
      expect.objectContaining({ id: source, quantity: 2, locationId: binder }),
      expect.objectContaining({
        quantity: 1,
        locationId: hearthhullBox,
        cameFromLocationId: binder,
      }),
    ]);
    expect(getSlot(signetSlot)?.pickedScryfallId).toBe(SIGNET);

    const [movement] = allMovements();
    expect(allMovements()).toHaveLength(1);
    expect(movement).toMatchObject({
      id: result.movementId,
      batchId: result.batchId,
      reason: 'assembled',
      fromLocationId: binder,
      toLocationId: hearthhullBox,
      cameFromAfter: binder,
      deckId: hearthhull,
      slotId: signetSlot,
      pickedBefore: SIGNET_OTHER,
    });
    const batch = db.select().from(movementBatches).all();
    expect(batch).toEqual([
      expect.objectContaining({ id: result.batchId, kind: 'pick_list', deckId: hearthhull }),
    ]);
  });

  it('names the quantity when several copies move', async () => {
    const source = stack({ quantity: 3 });
    const res = await pull(hearthhull, { slotId: signetSlot, stackId: source, quantity: 2 });
    expect(PullResult.parse(await res.json()).message).toBe(
      'Pulled 2 Arcane Signet into Hearthhull deck box',
    );
  });

  it('keeps the original came-from when pulling from another deck, and returns that deck', async () => {
    const borrowed = stack({ locationId: atraxaBox, cameFromLocationId: binder });
    const res = await pull(hearthhull, { slotId: signetSlot, stackId: borrowed, quantity: 1 });
    const result = PullResult.parse(await res.json());
    expect(result.otherDeck).toEqual({ id: atraxa, name: 'Atraxa' });
    expect(result.message).toBe(
      'Pulled Arcane Signet into Hearthhull deck box. Atraxa is now partly assembled.',
    );
    expect(stacks()).toEqual([
      expect.objectContaining({ locationId: hearthhullBox, cameFromLocationId: binder }),
    ]);
    expect(allMovements()[0]).toMatchObject({ fromLocationId: atraxaBox, cameFromAfter: binder });
  });

  it('answers 409 stale_copy and changes nothing when the stack has moved', async () => {
    const source = stack({ quantity: 1 });
    await expectError(
      await pull(hearthhull, { slotId: signetSlot, stackId: source, quantity: 2 }),
      409,
      'stale_copy',
    );
    await expectError(
      await pull(hearthhull, { slotId: signetSlot, stackId: 999, quantity: 1 }),
      409,
      'stale_copy',
    );
    expect(stacks()).toEqual([expect.objectContaining({ id: source, locationId: binder })]);
    expect(getSlot(signetSlot)?.pickedScryfallId).toBe(SIGNET_OTHER);
    expect(allMovements()).toEqual([]);
    expect(db.select().from(movementBatches).all()).toEqual([]);
  });

  it('lets pulls share the batch the first one returned', async () => {
    const first = stack({ quantity: 2 });
    const one = PullResult.parse(
      await (await pull(hearthhull, { slotId: signetSlot, stackId: first, quantity: 1 })).json(),
    );
    const two = PullResult.parse(
      await (
        await pull(hearthhull, {
          slotId: signetSlot,
          stackId: first,
          quantity: 1,
          batchId: one.batchId,
        })
      ).json(),
    );
    expect(two.batchId).toBe(one.batchId);
    expect(allMovements().map((m) => m.batchId)).toEqual([one.batchId, one.batchId]);
    expect(db.select().from(movementBatches).all()).toHaveLength(1);
  });

  it('records a swap batch and reason from the swap list', async () => {
    const source = stack();
    const res = await pull(
      hearthhull,
      { slotId: signetSlot, stackId: source, quantity: 1 },
      'swapped_in',
    );
    const result = PullResult.parse(await res.json());
    expect(allMovements()[0].reason).toBe('swapped_in');
    expect(db.select().from(movementBatches).get()).toMatchObject({
      id: result.batchId,
      kind: 'swap',
    });
  });

  it('refuses a batch from another deck, another card, a missing slot or deck', async () => {
    const source = stack({ quantity: 2 });
    const atraxaSlot = slot(atraxa, 'oracle-signet');
    const theirs = PullResult.parse(
      await (await pull(atraxa, { slotId: atraxaSlot, stackId: source, quantity: 1 })).json(),
    );
    const before = allMovements().length;
    await expectError(
      await pull(hearthhull, {
        slotId: signetSlot,
        stackId: source,
        quantity: 1,
        batchId: theirs.batchId,
      }),
      400,
      'batch_not_found',
    );
    await expectError(
      await pull(hearthhull, { slotId: soulSlot, stackId: source, quantity: 1 }),
      400,
      'wrong_card',
    );
    await expectError(
      await pull(hearthhull, { slotId: atraxaSlot, stackId: source, quantity: 1 }),
      404,
      'slot_not_found',
    );
    await expectError(
      await pull(999, { slotId: signetSlot, stackId: source, quantity: 1 }),
      404,
      'deck_not_found',
    );
    expect(allMovements()).toHaveLength(before);
  });

  it('refuses a copy already in this deck box', async () => {
    const inBox = stack({ locationId: hearthhullBox, cameFromLocationId: binder });
    await expectError(
      await pull(hearthhull, { slotId: signetSlot, stackId: inBox, quantity: 1 }),
      400,
      'already_there',
    );
  });
});

describe('POST /api/decks/:id/proxies', () => {
  it('adds a proxy to the deck box with no came-from and fills the slot', async () => {
    const res = await proxy(hearthhull, { slotId: soulSlot, scryfallId: SOUL_JA });
    expect(res.status).toBe(200);
    const result = ProxyResult.parse(await res.json());
    expect(result.message).toBe('Added a proxy of Soul of Windgrace to Hearthhull deck box');

    expect(stacks()).toEqual([
      expect.objectContaining({
        scryfallId: SOUL_JA,
        quantity: 1,
        isProxy: true,
        condition: 'near_mint',
        language: 'ja',
        locationId: hearthhullBox,
        cameFromLocationId: null,
      }),
    ]);
    expect(getSlot(soulSlot)?.pickedScryfallId).toBe(SOUL_JA);
    expect(allMovements()).toEqual([
      expect.objectContaining({
        id: result.movementId,
        batchId: result.batchId,
        reason: 'added',
        fromLocationId: null,
        toLocationId: hearthhullBox,
        deckId: hearthhull,
        slotId: soulSlot,
      }),
    ]);
    expect(stacks().some((s) => s.locationId === inbox)).toBe(false);
  });

  it('joins the pick list batch', async () => {
    const source = stack();
    const pulled = PullResult.parse(
      await (await pull(hearthhull, { slotId: signetSlot, stackId: source, quantity: 1 })).json(),
    );
    const res = await proxy(hearthhull, {
      slotId: soulSlot,
      scryfallId: SOUL,
      batchId: pulled.batchId,
    });
    expect(ProxyResult.parse(await res.json()).batchId).toBe(pulled.batchId);
  });

  it('refuses a printing of another card or one not in the card data', async () => {
    await expectError(
      await proxy(hearthhull, { slotId: soulSlot, scryfallId: SIGNET }),
      400,
      'wrong_card',
    );
    await expectError(
      await proxy(hearthhull, { slotId: soulSlot, scryfallId: 'nope' }),
      404,
      'printing_not_found',
    );
    expect(stacks()).toEqual([]);
  });
});
