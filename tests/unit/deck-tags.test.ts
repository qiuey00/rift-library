import { and, eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { deckSlots, deckSlotTags } from '../../src/server/db/schema';
import { createTestDb, insertCard } from '../../src/server/db/test-db';
import { deckView } from '../../src/server/queries/decks';
import {
  createDeck,
  moveSlotBoard,
  removeSlot,
  setSlotTags,
  tagKey,
} from '../../src/server/services/decks';
import type { Board, CardType } from '../../src/shared/api/common';
import { ErrorBody } from '../../src/shared/api/common';
import { SlotRow } from '../../src/shared/api/decks';

const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

/** The card ids of the test's cards, by name. */
const cardIds = new Map<string, number>();
const card = (name: string) => cardIds.get(name) ?? 0;
const HEARTHHULL = 'Jinx, Loose Cannon';
const SOL_RING = 'Sun Disc';

let db: OpenDb;
let deckId: number;

function addCard(name: string, type: CardType = 'unit') {
  cardIds.set(name, insertCard(db, { name, type }));
}

function slotId(name: string, board: Board, deck = deckId) {
  const slot = db
    .select({ id: deckSlots.id })
    .from(deckSlots)
    .where(
      and(eq(deckSlots.deckId, deck), eq(deckSlots.cardId, card(name)), eq(deckSlots.board, board)),
    )
    .get();
  if (!slot) throw new Error(`no ${board} slot for ${name}`);
  return slot.id;
}

/** The deck view's tags per slot, as "board name". */
function tagsByCard(deck = deckId) {
  return Object.fromEntries(
    (deckView(db, deck)?.slots ?? []).map((slot) => [`${slot.board} ${slot.card.name}`, slot.tags]),
  );
}

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  addCard('Jinx, Loose Cannon', 'legend');
  addCard('Lux, Lady of Luminosity', 'legend');
  for (const name of [
    'Sun Disc',
    'Ember Signet',
    'Iron Insight',
    'Chaos Warp',
    'Adeline, Resplendent Cathar',
    'Ashaya, Soul of the Wild',
    "Avacyn's Pilgrim",
    'Beast Whisperer',
    'Unbound Volley',
  ]) {
    addCard(name);
  }
  deckId = createDeck(db, {
    name: 'Jinx Burn',
    slots: [
      { cardId: card(HEARTHHULL), board: 'legend', quantity: 1 },
      { cardId: card(SOL_RING), board: 'main', quantity: 1 },
      { cardId: card('Ember Signet'), board: 'main', quantity: 1 },
      { cardId: card('Iron Insight'), board: 'main', quantity: 1 },
      { cardId: card('Iron Insight'), board: 'maybe', quantity: 1 },
    ],
  });
});
afterEach(() => db.$client.close());

async function putTags(tags: string[], slot = slotId(SOL_RING, 'main'), deck = deckId) {
  return api.decks[':id'].slots[':slotId'].tags.$put({
    param: { id: String(deck), slotId: String(slot) },
    json: { tags },
  });
}

describe('PUT /api/decks/:id/slots/:slotId/tags', () => {
  it('replaces the slot’s tags and answers the slot, tags sorted ignoring case', async () => {
    const res = await putTags(['Ramp', 'energy rock', 'Artifact']);
    expect(res.status).toBe(200);
    const row = SlotRow.parse(await res.json());
    expect(row).toMatchObject({ id: slotId(SOL_RING, 'main'), quantity: 1 });
    expect(row.tags).toEqual(['Artifact', 'energy rock', 'Ramp']);

    const again = SlotRow.parse(await (await putTags(['Fast mana'])).json());
    expect(again.tags).toEqual(['Fast mana']);
    expect(tagsByCard()['main Sun Disc']).toEqual(['Fast mana']);
  });

  it('trims each tag and merges tags with the same key, keeping the first spelling', async () => {
    const res = await putTags(['  Card draw ', 'card-draw', 'CARD   DRAW', 'Ramp', 'ramp']);
    expect(SlotRow.parse(await res.json()).tags).toEqual(['Card draw', 'Ramp']);
    expect(db.select().from(deckSlotTags).all()).toEqual(
      expect.arrayContaining([
        { slotId: slotId(SOL_RING, 'main'), tag: 'Card draw', tagKey: 'card-draw' },
        { slotId: slotId(SOL_RING, 'main'), tag: 'Ramp', tagKey: 'ramp' },
      ]),
    );
  });

  it('clears the tags with an empty list', async () => {
    await putTags(['Ramp']);
    const res = await putTags([]);
    expect(SlotRow.parse(await res.json()).tags).toEqual([]);
    expect(db.select().from(deckSlotTags).all()).toEqual([]);
  });

  it('lets Jeff respell a tag on its slot, but joins a spelling another slot has', async () => {
    await putTags(['card draw']);
    expect(SlotRow.parse(await (await putTags(['Card Draw'])).json()).tags).toEqual(['Card Draw']);

    const signet = slotId('Ember Signet', 'main');
    const res = await putTags(['CARD-DRAW'], signet);
    expect(SlotRow.parse(await res.json()).tags).toEqual(['Card Draw']);
  });

  it('answers 404 slot_not_found for a slot of another deck', async () => {
    const other = createDeck(db, {
      name: 'Lux Control',
      slots: [{ cardId: card(SOL_RING), board: 'main', quantity: 1 }],
    });
    const res = await putTags(['Ramp'], slotId(SOL_RING, 'main', other));
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('slot_not_found');
  });

  it('answers 404 deck_not_found and 400 invalid_request', async () => {
    const missing = await putTags(['Ramp'], slotId(SOL_RING, 'main'), 999);
    expect(missing.status).toBe(404);
    expect(ErrorBody.parse(await missing.json()).error.code).toBe('deck_not_found');

    for (const tags of [['#ramp'], [''], ['x'.repeat(41)]]) {
      const res = await putTags(tags);
      expect(res.status).toBe(400);
      expect(ErrorBody.parse(await res.json()).error.code).toBe('invalid_request');
    }
  });
});

describe('tag rules', () => {
  it('keys tags in lower case with each run of spaces as -', () => {
    expect(tagKey('  Card   Draw ')).toBe('card-draw');
    expect(tagKey('token-maker')).toBe('token-maker');
  });

  it('deletes a slot’s tags with the slot', () => {
    setSlotTags(db, deckId, slotId(SOL_RING, 'main'), ['Ramp']);
    removeSlot(db, deckId, slotId(SOL_RING, 'main'));
    expect(db.select().from(deckSlotTags).all()).toEqual([]);
  });

  it('keeps the tags of both slots when a board move merges them', () => {
    setSlotTags(db, deckId, slotId('Iron Insight', 'main'), ['Ramp', 'Land search']);
    setSlotTags(db, deckId, slotId('Iron Insight', 'maybe'), ['ramp', 'Cheap']);
    const merged = moveSlotBoard(db, deckId, slotId('Iron Insight', 'main'), 'maybe');
    expect(merged).toBe(slotId('Iron Insight', 'maybe'));
    expect(tagsByCard()['maybe Iron Insight']).toEqual(['Cheap', 'Land search', 'Ramp']);
    expect(tagsByCard()['main Iron Insight']).toBeUndefined();
  });

  it('never changes a slot’s status, counts or the deck’s state', () => {
    const before = deckView(db, deckId);
    for (const slot of before?.slots ?? []) setSlotTags(db, deckId, slot.id, ['Ramp', 'Combo']);
    const after = deckView(db, deckId);
    expect(after?.deck).toEqual(before?.deck);
    expect(after?.slots.map(({ tags, ...rest }) => rest)).toEqual(
      before?.slots.map(({ tags, ...rest }) => rest),
    );
    expect(after?.slots.every((slot) => slot.tags.join() === 'Combo,Ramp')).toBe(true);
  });
});
