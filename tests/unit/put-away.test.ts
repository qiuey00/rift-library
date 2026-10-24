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
import { destinationFor, putAwayList } from '../../src/server/queries/put-away';
import { createBatch, moveCopies } from '../../src/server/services/copies';
import { type Board, ErrorBody } from '../../src/shared/api/common';
import { PutAwayResponse, ReturnResult } from '../../src/shared/api/put-away';

const client = hc<AppType>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;
let inbox: number;
let binder: number;
let longBox: number;
let chaosCalm: number;
let lands: number;
let jinxBurnBox: number;
let luxControlBox: number;
let jinxBurn: number;
let luxControl: number;

const SIGNET = 'printing-arcane-signet';
const FARSEEK = 'printing-ironInsight';
const BOG = 'printing-bojuka-bog';
const BRAIDS = 'printing-volibearPathfinder';
const FOREST = 'printing-calmRune';

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

function card(printingId: string, name: string, isRune = false) {
  const cardId = insertCard(db, { name, type: isRune ? 'rune' : 'unit' });
  insertPrinting(db, { riftcodexId: printingId, cardId, rarity: 'rare' });
  return cardId;
}

function stack(
  printingId: string,
  locationId: number,
  overrides: Partial<typeof copyStacks.$inferInsert> = {},
) {
  return db
    .insert(copyStacks)
    .values({
      printingId,
      quantity: 1,
      finish: 'normal',
      condition: 'near_mint',
      language: 'en',
      locationId,
      ...overrides,
    })
    .returning({ id: copyStacks.id })
    .get().id;
}

/** Pulls copies from storage into a deck box the way the pick list does, setting came-from. */
function pull(stackId: number, quantity: number, toBox: number, deckId: number) {
  const batchId = createBatch(db, 'pick_list', { deckId });
  return moveCopies(db, stackId, quantity, toBox, { reason: 'assembled', batchId, deckId })
    .destStackId;
}

function slot(
  deckId: number,
  cardId: number,
  quantity = 1,
  pickedPrintingId: string | null = null,
  board: Board = 'main',
) {
  return db
    .insert(deckSlots)
    .values({ deckId, cardId, board, quantity, pickedPrintingId })
    .returning({ id: deckSlots.id })
    .get().id;
}

const getStack = (id: number) => db.select().from(copyStacks).where(eq(copyStacks.id, id)).get();
const stacksIn = (locationId: number) =>
  db.select().from(copyStacks).where(eq(copyStacks.locationId, locationId)).all();
const allStacks = () => db.select().from(copyStacks).orderBy(asc(copyStacks.id)).all();
const allMovements = () => db.select().from(movements).orderBy(asc(movements.id)).all();

function postReturns(deckId: number, body: unknown) {
  return app.request(`/api/decks/${deckId}/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getList(deckId: number) {
  const res = await app.request(`/api/decks/${deckId}/put-away`);
  expect(res.status).toBe(200);
  return PutAwayResponse.parse(await res.json());
}

let signetCard: number;
let ironInsightCard: number;
let bogCard: number;
let runeCard: number;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  inbox = db.select().from(locations).get()?.id ?? 0;
  // Tree order: inbox, Long box (position 0) › Chaos & Calm, Lands, then Rares binder.
  binder = location('Rares binder', 'binder', undefined, 1);
  longBox = location('Long box', 'box', undefined, 0);
  lands = location('Lands', 'box', longBox, 1);
  chaosCalm = location('Chaos & Calm', 'box', longBox, 0);
  jinxBurnBox = location('Jinx Burn deck box', 'deck_box');
  luxControlBox = location('Lux Control deck box', 'deck_box');
  jinxBurn = db
    .insert(decks)
    .values({ name: 'Jinx Burn', deckBoxId: jinxBurnBox })
    .returning({ id: decks.id })
    .get().id;
  luxControl = db
    .insert(decks)
    .values({ name: 'Lux Control', deckBoxId: luxControlBox })
    .returning({ id: decks.id })
    .get().id;
  signetCard = card(SIGNET, 'Ember Signet');
  ironInsightCard = card(FARSEEK, 'Iron Insight');
  bogCard = card(BOG, 'Eager Steppe');
  card(BRAIDS, 'Volibear, Pathfinder');
  runeCard = card(FOREST, 'Calm Rune', true);
});
afterEach(() => db.$client.close());

describe('putAwayList', () => {
  it('groups every stack in the box by destination, in location-tree order', async () => {
    pull(stack(SIGNET, binder, { finish: 'foil' }), 1, jinxBurnBox, jinxBurn);
    pull(stack(BOG, lands), 1, jinxBurnBox, jinxBurn);
    pull(stack(FARSEEK, chaosCalm, { quantity: 3 }), 2, jinxBurnBox, jinxBurn);
    stack(BRAIDS, jinxBurnBox, { isProxy: true });

    const list = await getList(jinxBurn);
    expect(list.groups.map((g) => g.location.path)).toEqual([
      'To sort',
      'Long box › Chaos & Calm',
      'Long box › Lands',
      'Rares binder',
    ]);
    expect(list.groups.map((g) => g.lines.map((l) => [l.card.name, l.quantity]))).toEqual([
      [['Volibear, Pathfinder', 1]],
      [['Iron Insight', 2]],
      [['Eager Steppe', 1]],
      [['Ember Signet', 1]],
    ]);
    expect(list.totals).toEqual({ lines: 4, cards: 5 });
    const ironInsight = list.groups[1].lines[0];
    expect(ironInsight.destination).toEqual(ironInsight.cameFrom);
    expect(ironInsight.printing).toMatchObject({
      printingId: FARSEEK,
      finishes: ['normal', 'foil'],
    });
    expect(list.groups[3].lines[0].finish).toBe('foil');
    expect(list.deck).toEqual({ id: jinxBurn, name: 'Jinx Burn', state: 'not_assembled' });
  });

  it('sends copies with no came-from location to the "To sort" inbox', () => {
    const proxy = stack(BRAIDS, jinxBurnBox, { isProxy: true });
    const list = putAwayList(db, jinxBurn);
    expect(list?.groups).toHaveLength(1);
    expect(list?.groups[0].location).toMatchObject({ id: inbox, type: 'inbox' });
    expect(list?.groups[0].lines[0]).toMatchObject({
      stackId: proxy,
      cameFrom: null,
      isProxy: true,
    });
    expect(destinationFor(db, { cameFromLocationId: null })).toBe(inbox);
  });

  it('sends a copy whose came-from location was deleted to the inbox', () => {
    const inBox = pull(stack(SIGNET, binder), 1, jinxBurnBox, jinxBurn);
    db.update(locations)
      .set({ deletedAt: '2026-10-19T00:00:00Z' })
      .where(eq(locations.id, binder))
      .run();
    const line = putAwayList(db, jinxBurn)?.groups[0].lines[0];
    expect(line).toMatchObject({ stackId: inBox, destination: { id: inbox } });
    expect(line?.cameFrom).toMatchObject({ id: binder, path: 'Rares binder' });
  });

  it('sends a copy borrowed from another deck back to its original storage spot', async () => {
    const inLuxControl = pull(stack(SIGNET, binder), 1, luxControlBox, luxControl);
    const inJinxBurn = pull(inLuxControl, 1, jinxBurnBox, jinxBurn);
    const list = await getList(jinxBurn);
    expect(list.groups.map((g) => g.location.id)).toEqual([binder]);

    const res = await postReturns(jinxBurn, { lines: [{ stackId: inJinxBurn, quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(stacksIn(binder)).toMatchObject([{ printingId: SIGNET, cameFromLocationId: null }]);
    expect(stacksIn(luxControlBox)).toEqual([]);
  });

  it('works out the deck state from the box', () => {
    slot(jinxBurn, signetCard);
    slot(jinxBurn, ironInsightCard);
    db.insert(deckSlots)
      .values({
        deckId: jinxBurn,
        cardId: runeCard,
        board: 'rune',
        quantity: 8,
      })
      .run();
    expect(putAwayList(db, jinxBurn)?.deck.state).toBe('not_assembled');
    pull(stack(SIGNET, binder), 1, jinxBurnBox, jinxBurn);
    expect(putAwayList(db, jinxBurn)?.deck.state).toBe('partly_assembled');
    pull(stack(FARSEEK, chaosCalm), 1, jinxBurnBox, jinxBurn);
    expect(putAwayList(db, jinxBurn)?.deck.state).toBe('assembled');
  });

  it('counts the legend, battlefield and sideboard slots, but not the maybe board', () => {
    slot(jinxBurn, signetCard, 1, null, 'legend');
    slot(jinxBurn, ironInsightCard, 1, null, 'battlefield');
    slot(jinxBurn, bogCard, 1, null, 'sideboard');
    slot(jinxBurn, runeCard, 1, null, 'maybe');
    pull(stack(SIGNET, binder), 1, jinxBurnBox, jinxBurn);
    pull(stack(FARSEEK, chaosCalm), 1, jinxBurnBox, jinxBurn);
    expect(putAwayList(db, jinxBurn)?.deck.state).toBe('partly_assembled');
    pull(stack(BOG, lands), 1, jinxBurnBox, jinxBurn);
    const list = putAwayList(db, jinxBurn);
    expect(list?.deck.state).toBe('assembled');
    expect(list?.groups.flatMap((g) => g.lines.map((l) => l.card.name))).toEqual([
      'Iron Insight',
      'Eager Steppe',
      'Ember Signet',
    ]);
  });

  it('answers 404 for a deck that does not exist', async () => {
    const res = await app.request('/api/decks/999/put-away');
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('deck_not_found');
  });
});

describe('POST /api/decks/:id/returns', () => {
  it('returns a copy to its came-from location and clears came-from', async () => {
    const inBox = pull(stack(SIGNET, binder), 1, jinxBurnBox, jinxBurn);
    const res = await postReturns(jinxBurn, { lines: [{ stackId: inBox, quantity: 1 }] });
    expect(res.status).toBe(200);
    const result = ReturnResult.parse(await res.json());
    expect(result.message).toBe('Returned Ember Signet to Rares binder');
    expect(stacksIn(jinxBurnBox)).toEqual([]);
    expect(stacksIn(binder)).toMatchObject([{ quantity: 1, cameFromLocationId: null }]);

    const [movement] = allMovements().filter((m) => m.batchId === result.batchId);
    expect(result.movementIds).toEqual([movement.id]);
    expect(movement).toMatchObject({
      reason: 'returned',
      deckId: jinxBurn,
      fromLocationId: jinxBurnBox,
      toLocationId: binder,
      cameFromBefore: binder,
      cameFromAfter: null,
    });
    const batch = db
      .select()
      .from(movementBatches)
      .where(eq(movementBatches.id, result.batchId))
      .get();
    expect(batch).toMatchObject({ kind: 'put_away', deckId: jinxBurn });
  });

  it('merges a returned copy into the alike stack it left', async () => {
    const source = stack(FARSEEK, chaosCalm, { quantity: 3 });
    const inBox = pull(source, 1, jinxBurnBox, jinxBurn);
    await postReturns(jinxBurn, { lines: [{ stackId: inBox, quantity: 1 }] });
    expect(stacksIn(chaosCalm)).toMatchObject([{ id: source, quantity: 3 }]);
  });

  it('Send elsewhere leaves the copy there with no came-from', async () => {
    const inBox = pull(stack(SIGNET, binder), 1, jinxBurnBox, jinxBurn);
    const res = await postReturns(jinxBurn, {
      lines: [{ stackId: inBox, quantity: 1, toLocationId: lands }],
    });
    expect(res.status).toBe(200);
    expect(ReturnResult.parse(await res.json()).message).toBe(
      'Returned Ember Signet to Long box › Lands',
    );
    expect(stacksIn(binder)).toEqual([]);
    expect(stacksIn(lands)).toMatchObject([{ printingId: SIGNET, cameFromLocationId: null }]);
  });

  it('refuses a deck box as Send elsewhere destination and changes nothing', async () => {
    const inBox = pull(stack(SIGNET, binder), 1, jinxBurnBox, jinxBurn);
    const other = pull(stack(BOG, lands), 1, jinxBurnBox, jinxBurn);
    const before = allStacks();
    const moves = allMovements().length;
    const res = await postReturns(jinxBurn, {
      lines: [
        { stackId: other, quantity: 1 },
        { stackId: inBox, quantity: 1, toLocationId: luxControlBox },
      ],
    });
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('deck_box_destination');
    expect(allStacks()).toEqual(before);
    expect(allMovements()).toHaveLength(moves);
  });

  it('answers 409 stale_copy for a stack that moved or shrank, and changes nothing', async () => {
    const signet = pull(stack(SIGNET, binder), 1, jinxBurnBox, jinxBurn);
    const ironInsight = pull(stack(FARSEEK, chaosCalm, { quantity: 2 }), 2, jinxBurnBox, jinxBurn);
    const batches = db.select().from(movementBatches).all().length;
    const before = allStacks();

    for (const lines of [
      [
        { stackId: signet, quantity: 1 },
        { stackId: ironInsight, quantity: 3 },
      ],
      [
        { stackId: ironInsight, quantity: 2 },
        { stackId: ironInsight, quantity: 1 },
      ],
      [{ stackId: 9999, quantity: 1 }],
    ]) {
      const res = await postReturns(jinxBurn, { lines });
      expect(res.status).toBe(409);
      expect(ErrorBody.parse(await res.json()).error.code).toBe('stale_copy');
    }
    // A stack outside this deck's box is stale too.
    const elsewhere = stack(BOG, lands);
    const res = await postReturns(jinxBurn, { lines: [{ stackId: elsewhere, quantity: 1 }] });
    expect(res.status).toBe(409);

    expect(allStacks().filter((s) => s.id !== elsewhere)).toEqual(before);
    expect(db.select().from(movementBatches).all()).toHaveLength(batches);
  });

  it('keeps one batch across calls', async () => {
    const signet = pull(stack(SIGNET, binder), 1, jinxBurnBox, jinxBurn);
    const bog = pull(stack(BOG, lands), 1, jinxBurnBox, jinxBurn);
    const first = ReturnResult.parse(
      await (await postReturns(jinxBurn, { lines: [{ stackId: signet, quantity: 1 }] })).json(),
    );
    const second = ReturnResult.parse(
      await (
        await postReturns(jinxBurn, {
          lines: [{ stackId: bog, quantity: 1 }],
          batchId: first.batchId,
        })
      ).json(),
    );
    expect(second.batchId).toBe(first.batchId);
    const inBatch = allMovements().filter((m) => m.batchId === first.batchId);
    expect(inBatch.map((m) => m.id)).toEqual([...first.movementIds, ...second.movementIds]);
  });

  it('refuses a batch that is not this deck’s put-away', async () => {
    const signet = pull(stack(SIGNET, binder), 1, jinxBurnBox, jinxBurn);
    const other = createBatch(db, 'move');
    const res = await postReturns(jinxBurn, {
      lines: [{ stackId: signet, quantity: 1 }],
      batchId: other,
    });
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('batch_not_found');
    expect(getStack(signet)?.locationId).toBe(jinxBurnBox);
  });

  it('records swapped_out returns in a swap batch', async () => {
    const signet = pull(stack(SIGNET, binder), 1, jinxBurnBox, jinxBurn);
    const result = ReturnResult.parse(
      await (
        await postReturns(jinxBurn, {
          lines: [{ stackId: signet, quantity: 1 }],
          reason: 'swapped_out',
        })
      ).json(),
    );
    expect(
      db.select().from(movementBatches).where(eq(movementBatches.id, result.batchId)).get(),
    ).toMatchObject({ kind: 'swap', deckId: jinxBurn });
    expect(allMovements().at(-1)?.reason).toBe('swapped_out');
  });

  it('returning everything leaves the decklist and picked printings unchanged', async () => {
    slot(jinxBurn, signetCard, 1, SIGNET);
    slot(jinxBurn, ironInsightCard, 2, FARSEEK);
    slot(jinxBurn, bogCard, 1, BOG);
    pull(stack(SIGNET, binder), 1, jinxBurnBox, jinxBurn);
    pull(stack(FARSEEK, chaosCalm, { quantity: 2 }), 2, jinxBurnBox, jinxBurn);
    pull(stack(BOG, lands), 1, jinxBurnBox, jinxBurn);
    const slotsBefore = db.select().from(deckSlots).all();
    expect((await getList(jinxBurn)).deck.state).toBe('assembled');

    // Keep in box: the Bog line simply isn't sent.
    const list = await getList(jinxBurn);
    const lines = list.groups
      .flatMap((g) => g.lines)
      .filter((l) => l.card.name !== 'Eager Steppe')
      .map((l) => ({ stackId: l.stackId, quantity: l.quantity }));
    const kept = ReturnResult.parse(await (await postReturns(jinxBurn, { lines })).json());
    expect(kept.message).toBe('Returned 3 cards');
    expect((await getList(jinxBurn)).deck.state).toBe('partly_assembled');

    const rest = (await getList(jinxBurn)).groups.flatMap((g) => g.lines);
    await postReturns(jinxBurn, {
      lines: rest.map((l) => ({ stackId: l.stackId, quantity: l.quantity })),
      batchId: kept.batchId,
    });
    const after = await getList(jinxBurn);
    expect(after.groups).toEqual([]);
    expect(after.totals).toEqual({ lines: 0, cards: 0 });
    expect(after.deck.state).toBe('not_assembled');
    expect(db.select().from(deckSlots).all()).toEqual(slotsBefore);
  });

  it('works through the typed client', async () => {
    const inBox = pull(stack(SIGNET, binder), 1, jinxBurnBox, jinxBurn);
    const param = { id: String(jinxBurn) };
    const list: PutAwayResponse = await (
      await client.decks[':id']['put-away'].$get({ param })
    ).json();
    expect(list.groups[0].lines[0].stackId).toBe(inBox);
    const returned: ReturnResult = await (
      await client.decks[':id'].returns.$post({
        param,
        json: { lines: [{ stackId: inBox, quantity: 1 }], reason: 'returned' },
      })
    ).json();
    expect(returned.message).toBe('Returned Ember Signet to Rares binder');
  });

  it('answers 404 for a deck that does not exist', async () => {
    const res = await postReturns(999, { lines: [{ stackId: 1, quantity: 1 }] });
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('deck_not_found');
  });
});
