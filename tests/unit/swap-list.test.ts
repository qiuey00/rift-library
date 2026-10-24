import { eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { cards, copyStacks, deckSlots, decks, locations } from '../../src/server/db/schema';
import { createTestDb, insertCard, insertPrinting } from '../../src/server/db/test-db';
import { swapList } from '../../src/server/queries/swap-list';
import { createBatch, moveCopies } from '../../src/server/services/copies';
import { type Board, ErrorBody } from '../../src/shared/api/common';
import { SwapResponse } from '../../src/shared/api/swap';

const client = hc<AppType>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;
let inbox: number;
let binder: number;
let chaosCalm: number;
let jinxBurnBox: number;
let jinxBurn: number;

const SIGNET = 'printing-arcane-signet';
const SIGNET_PROMO = 'printing-arcane-signet-promo';
const FARSEEK = 'printing-ironInsight';
const BALOTHS = 'printing-rampaging-baloths';
const URUG = 'printing-volibearVanguard';
const BREAKER = 'printing-world-breaker';
const HEARTHHULL = 'printing-jinxBurn';

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

/** A printing of a card, adding the card the first time its name comes up. */
function card(printingId: string, name: string) {
  const known = db.select({ id: cards.id }).from(cards).where(eq(cards.name, name)).get();
  const cardId = known?.id ?? insertCard(db, { name, type: 'unit' });
  insertPrinting(db, {
    riftcodexId: printingId,
    cardId,
    collectorNumber: printingId,
    rarity: 'rare',
  });
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

/** Pulls copies from storage into the deck box the way the pick list does, setting came-from. */
function pull(stackId: number, quantity: number) {
  const batchId = createBatch(db, 'pick_list', { deckId: jinxBurn });
  return moveCopies(db, stackId, quantity, jinxBurnBox, {
    reason: 'assembled',
    batchId,
    deckId: jinxBurn,
  }).destStackId;
}

function slot(
  cardId: number,
  quantity = 1,
  board: Board = 'main',
  pickedPrintingId: string | null = null,
) {
  return db
    .insert(deckSlots)
    .values({ deckId: jinxBurn, cardId, board, quantity, pickedPrintingId })
    .returning({ id: deckSlots.id })
    .get().id;
}

async function getSwap(deckId = jinxBurn) {
  const res = await app.request(`/api/decks/${deckId}/swap`);
  expect(res.status).toBe(200);
  return SwapResponse.parse(await res.json());
}

const takeOut = (list: SwapResponse) =>
  list.takeOut.groups.map((group) => [
    group.location.path,
    group.lines.map((line) => [line.card.name, line.quantity]),
  ]);

let signet: number;
let ironInsight: number;
let baloths: number;
let volibearVanguard: number;
let breaker: number;
let legend: number;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  inbox = db.select().from(locations).get()?.id ?? 0;
  // Tree order: inbox, Long box › Chaos & Calm, then Rares binder.
  binder = location('Rares binder', 'binder', undefined, 1);
  const longBox = location('Long box', 'box', undefined, 0);
  chaosCalm = location('Chaos & Calm', 'box', longBox, 0);
  jinxBurnBox = location('Jinx Burn deck box', 'deck_box');
  jinxBurn = db
    .insert(decks)
    .values({ name: 'Jinx Burn', deckBoxId: jinxBurnBox })
    .returning({ id: decks.id })
    .get().id;
  signet = card(SIGNET, 'Ember Signet');
  card(SIGNET_PROMO, 'Ember Signet');
  ironInsight = card(FARSEEK, 'Iron Insight');
  baloths = card(BALOTHS, 'Swift Skirmisher');
  volibearVanguard = card(URUG, 'Volibear, Vanguard');
  breaker = card(BREAKER, 'Dawn Harrier');
  legend = card(HEARTHHULL, 'Jinx, Loose Cannon');
});
afterEach(() => db.$client.close());

/** Jinx Burn fully built: its Legend, Ember Signet, two Iron Insight and Swift Skirmisher. */
function buildDeck() {
  slot(legend, 1, 'legend');
  slot(signet);
  slot(ironInsight, 2);
  const balothsSlot = slot(baloths);
  pull(stack(HEARTHHULL, binder), 1);
  pull(stack(SIGNET, binder), 1);
  pull(stack(FARSEEK, chaosCalm, { quantity: 3 }), 2);
  pull(stack(BALOTHS, chaosCalm), 1);
  return { balothsSlot };
}

describe('swapList', () => {
  it('is empty for an unchanged assembled deck', async () => {
    buildDeck();
    const list = await getSwap();
    expect(list.deck).toEqual({ id: jinxBurn, name: 'Jinx Burn', state: 'assembled' });
    expect(list.takeOut).toEqual({ groups: [], count: 0 });
    expect(list.pullIn).toEqual({
      groups: [],
      otherDecks: [],
      missing: [],
      runes: [],
      totals: { lines: 0, cards: 0 },
    });
    expect(list.counts).toEqual({ takeOut: 0, pullIn: 0 });
  });

  it("takes out a removed card's copies to their came-from location", async () => {
    const { balothsSlot } = buildDeck();
    db.$client.prepare('DELETE FROM deck_slots WHERE id = ?').run(balothsSlot);

    const list = await getSwap();
    expect(takeOut(list)).toEqual([['Long box › Chaos & Calm', [['Swift Skirmisher', 1]]]]);
    const line = list.takeOut.groups[0].lines[0];
    expect(line.destination).toMatchObject({ id: chaosCalm });
    expect(line.cameFrom).toMatchObject({ id: chaosCalm });
    expect(list.counts).toEqual({ takeOut: 1, pullIn: 0 });
  });

  it('takes out only the extra copies when a quantity goes down', async () => {
    buildDeck();
    db.$client.prepare('UPDATE deck_slots SET quantity = 1 WHERE card_id = ?').run(ironInsight);

    const list = await getSwap();
    expect(takeOut(list)).toEqual([['Long box › Chaos & Calm', [['Iron Insight', 1]]]]);
    expect(list.takeOut.count).toBe(1);
  });

  it('takes out maybe board cards in the box', async () => {
    buildDeck();
    db.$client.prepare("UPDATE deck_slots SET board = 'maybe' WHERE card_id = ?").run(baloths);
    expect(takeOut(await getSwap())).toEqual([
      ['Long box › Chaos & Calm', [['Swift Skirmisher', 1]]],
    ]);
  });

  it('takes out proxies first, then printings no slot picked', async () => {
    slot(signet, 1, 'main', SIGNET);
    pull(stack(SIGNET, binder), 1);
    pull(stack(SIGNET_PROMO, binder), 1);
    stack(SIGNET, jinxBurnBox, { isProxy: true });

    const list = await getSwap();
    expect(list.takeOut.groups.map((g) => g.location.id)).toEqual([inbox, binder]);
    const lines = list.takeOut.groups.flatMap((g) => g.lines);
    expect(lines.map((l) => [l.isProxy, l.printing.printingId])).toEqual([
      [true, SIGNET],
      [false, SIGNET_PROMO],
    ]);
    expect(list.counts.takeOut).toBe(2);
  });

  it('pulls in an added card like the pick list', async () => {
    buildDeck();
    slot(volibearVanguard);
    slot(breaker);
    const volibearVanguardStack = stack(URUG, chaosCalm);
    const breakerStack = stack(BREAKER, binder);

    const list = await getSwap();
    expect(list.takeOut.count).toBe(0);
    expect(
      list.pullIn.groups.map((g) => [
        g.location.path,
        g.lines.map((l) => [l.card.name, l.suggested.stackId]),
      ]),
    ).toEqual([
      ['Long box › Chaos & Calm', [['Volibear, Vanguard', volibearVanguardStack]]],
      ['Rares binder', [['Dawn Harrier', breakerStack]]],
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
    const res = await app.request(`/api/decks/${jinxBurn}/swap`);
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('deck_not_found');
  });

  it('is seen by the typed client', async () => {
    buildDeck();
    const res = await client.decks[':id'].swap.$get({ param: { id: String(jinxBurn) } });
    const list: SwapResponse = await res.json();
    expect(list.counts).toEqual({ takeOut: 0, pullIn: 0 });
  });
});
