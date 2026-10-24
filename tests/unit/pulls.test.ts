import { asc, eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import {
  copyStacks,
  deckSlots,
  decks,
  locations,
  movementBatches,
  movements,
} from '../../src/server/db/schema';
import { createTestDb, insertCard, insertPrinting } from '../../src/server/db/test-db';
import { ErrorBody } from '../../src/shared/api/common';
import { ProxyResult, PullResult } from '../../src/shared/api/pulls';

const client = hc<AppType>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;
let inbox: number;
let binder: number;
let jinxBurnBox: number;
let luxControlBox: number;
let jinxBurn: number;
let luxControl: number;
let signetSlot: number;
let soulSlot: number;

const SIGNET = 'printing-arcane-signet';
const SIGNET_OTHER = 'printing-arcane-signet-2';
const SOUL = 'printing-soul-of-windgrace';
const SOUL_ALT = 'printing-swift-ox-alt';

function location(name: string, type: typeof locations.$inferInsert.type) {
  return db.insert(locations).values({ name, type }).returning({ id: locations.id }).get().id;
}

const SIGNET_CARD = 1;
const SOUL_CARD = 2;

function card(id: number, name: string) {
  insertCard(db, { id, name });
}

function printing(riftcodexId: string, cardId: number) {
  insertPrinting(db, {
    riftcodexId,
    cardId,
    setCode: 'VEN',
    setName: 'Vendetta',
    rarity: 'uncommon',
  });
}

function deck(name: string, deckBoxId: number) {
  return db.insert(decks).values({ name, deckBoxId }).returning({ id: decks.id }).get().id;
}

function slot(deckId: number, cardId: number, pickedPrintingId: string | null = null) {
  return db
    .insert(deckSlots)
    .values({ deckId, cardId, board: 'main', quantity: 1, pickedPrintingId })
    .returning({ id: deckSlots.id })
    .get().id;
}

function stack(overrides: Partial<typeof copyStacks.$inferInsert> = {}) {
  return db
    .insert(copyStacks)
    .values({
      printingId: SIGNET,
      quantity: 1,
      finish: 'normal',
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

function proxy(deckId: number, json: { slotId: number; printingId: string; batchId?: number }) {
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
  jinxBurnBox = location('Jinx Burn deck box', 'deck_box');
  luxControlBox = location('Lux Control deck box', 'deck_box');
  jinxBurn = deck('Jinx Burn', jinxBurnBox);
  luxControl = deck('Lux Control', luxControlBox);
  card(SIGNET_CARD, 'Ember Signet');
  card(SOUL_CARD, 'Swift Ox');
  printing(SIGNET, SIGNET_CARD);
  printing(SIGNET_OTHER, SIGNET_CARD);
  printing(SOUL, SOUL_CARD);
  printing(SOUL_ALT, SOUL_CARD);
  signetSlot = slot(jinxBurn, SIGNET_CARD, SIGNET_OTHER);
  soulSlot = slot(jinxBurn, SOUL_CARD);
});
afterEach(() => db.$client.close());

describe('POST /api/decks/:id/pulls', () => {
  it('moves the copy into the deck box, sets came-from and the picked printing', async () => {
    const source = stack({ quantity: 3 });
    const res = await pull(jinxBurn, { slotId: signetSlot, stackId: source, quantity: 1 });
    expect(res.status).toBe(200);
    const result = PullResult.parse(await res.json());
    expect(result).toMatchObject({
      message: 'Pulled Ember Signet into Jinx Burn deck box',
      otherDeck: null,
    });

    expect(stacks()).toEqual([
      expect.objectContaining({ id: source, quantity: 2, locationId: binder }),
      expect.objectContaining({
        quantity: 1,
        locationId: jinxBurnBox,
        cameFromLocationId: binder,
      }),
    ]);
    expect(getSlot(signetSlot)?.pickedPrintingId).toBe(SIGNET);

    const [movement] = allMovements();
    expect(allMovements()).toHaveLength(1);
    expect(movement).toMatchObject({
      id: result.movementId,
      batchId: result.batchId,
      reason: 'assembled',
      fromLocationId: binder,
      toLocationId: jinxBurnBox,
      cameFromAfter: binder,
      deckId: jinxBurn,
      slotId: signetSlot,
      pickedBefore: SIGNET_OTHER,
    });
    const batch = db.select().from(movementBatches).all();
    expect(batch).toEqual([
      expect.objectContaining({ id: result.batchId, kind: 'pick_list', deckId: jinxBurn }),
    ]);
  });

  it('names the quantity when several copies move', async () => {
    const source = stack({ quantity: 3 });
    const res = await pull(jinxBurn, { slotId: signetSlot, stackId: source, quantity: 2 });
    expect(PullResult.parse(await res.json()).message).toBe(
      'Pulled 2 Ember Signet into Jinx Burn deck box',
    );
  });

  it('keeps the original came-from when pulling from another deck, and returns that deck', async () => {
    const borrowed = stack({ locationId: luxControlBox, cameFromLocationId: binder });
    const res = await pull(jinxBurn, { slotId: signetSlot, stackId: borrowed, quantity: 1 });
    const result = PullResult.parse(await res.json());
    expect(result.otherDeck).toEqual({ id: luxControl, name: 'Lux Control' });
    expect(result.message).toBe(
      'Pulled Ember Signet into Jinx Burn deck box. Lux Control is now partly assembled.',
    );
    expect(stacks()).toEqual([
      expect.objectContaining({ locationId: jinxBurnBox, cameFromLocationId: binder }),
    ]);
    expect(allMovements()[0]).toMatchObject({
      fromLocationId: luxControlBox,
      cameFromAfter: binder,
    });
  });

  it('answers 409 stale_copy and changes nothing when the stack has moved', async () => {
    const source = stack({ quantity: 1 });
    await expectError(
      await pull(jinxBurn, { slotId: signetSlot, stackId: source, quantity: 2 }),
      409,
      'stale_copy',
    );
    await expectError(
      await pull(jinxBurn, { slotId: signetSlot, stackId: 999, quantity: 1 }),
      409,
      'stale_copy',
    );
    expect(stacks()).toEqual([expect.objectContaining({ id: source, locationId: binder })]);
    expect(getSlot(signetSlot)?.pickedPrintingId).toBe(SIGNET_OTHER);
    expect(allMovements()).toEqual([]);
    expect(db.select().from(movementBatches).all()).toEqual([]);
  });

  it('lets pulls share the batch the first one returned', async () => {
    const first = stack({ quantity: 2 });
    const one = PullResult.parse(
      await (await pull(jinxBurn, { slotId: signetSlot, stackId: first, quantity: 1 })).json(),
    );
    const two = PullResult.parse(
      await (
        await pull(jinxBurn, {
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
      jinxBurn,
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
    const luxControlSlot = slot(luxControl, SIGNET_CARD);
    const theirs = PullResult.parse(
      await (
        await pull(luxControl, { slotId: luxControlSlot, stackId: source, quantity: 1 })
      ).json(),
    );
    const before = allMovements().length;
    await expectError(
      await pull(jinxBurn, {
        slotId: signetSlot,
        stackId: source,
        quantity: 1,
        batchId: theirs.batchId,
      }),
      400,
      'batch_not_found',
    );
    await expectError(
      await pull(jinxBurn, { slotId: soulSlot, stackId: source, quantity: 1 }),
      400,
      'wrong_card',
    );
    await expectError(
      await pull(jinxBurn, { slotId: luxControlSlot, stackId: source, quantity: 1 }),
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
    const inBox = stack({ locationId: jinxBurnBox, cameFromLocationId: binder });
    await expectError(
      await pull(jinxBurn, { slotId: signetSlot, stackId: inBox, quantity: 1 }),
      400,
      'already_there',
    );
  });
});

describe('POST /api/decks/:id/proxies', () => {
  it('adds a proxy to the deck box with no came-from and fills the slot', async () => {
    const res = await proxy(jinxBurn, { slotId: soulSlot, printingId: SOUL_ALT });
    expect(res.status).toBe(200);
    const result = ProxyResult.parse(await res.json());
    expect(result.message).toBe('Added a proxy of Swift Ox to Jinx Burn deck box');

    expect(stacks()).toEqual([
      expect.objectContaining({
        printingId: SOUL_ALT,
        quantity: 1,
        isProxy: true,
        condition: 'near_mint',
        language: 'en',
        locationId: jinxBurnBox,
        cameFromLocationId: null,
      }),
    ]);
    expect(getSlot(soulSlot)?.pickedPrintingId).toBe(SOUL_ALT);
    expect(allMovements()).toEqual([
      expect.objectContaining({
        id: result.movementId,
        batchId: result.batchId,
        reason: 'added',
        fromLocationId: null,
        toLocationId: jinxBurnBox,
        deckId: jinxBurn,
        slotId: soulSlot,
      }),
    ]);
    expect(stacks().some((s) => s.locationId === inbox)).toBe(false);
  });

  it('joins the pick list batch', async () => {
    const source = stack();
    const pulled = PullResult.parse(
      await (await pull(jinxBurn, { slotId: signetSlot, stackId: source, quantity: 1 })).json(),
    );
    const res = await proxy(jinxBurn, {
      slotId: soulSlot,
      printingId: SOUL,
      batchId: pulled.batchId,
    });
    expect(ProxyResult.parse(await res.json()).batchId).toBe(pulled.batchId);
  });

  it('refuses a printing of another card or one not in the card data', async () => {
    await expectError(
      await proxy(jinxBurn, { slotId: soulSlot, printingId: SIGNET }),
      400,
      'wrong_card',
    );
    await expectError(
      await proxy(jinxBurn, { slotId: soulSlot, printingId: 'nope' }),
      404,
      'printing_not_found',
    );
    expect(stacks()).toEqual([]);
  });
});
