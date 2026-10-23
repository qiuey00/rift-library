import { eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { AppType } from '../../src/server/app';
import { app } from '../../src/server/app';
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
import { AppError } from '../../src/server/errors';
import { deckList, deckView } from '../../src/server/queries/decks';
import {
  addSlot,
  createDeck,
  type DeckSlotInput,
  deleteDeck,
  moveSlotBoard,
  removeSlot,
  renameDeck,
  replaceSlots,
  setCommanders,
  setSlotPrinting,
  setSlotQuantity,
} from '../../src/server/services/decks';
import type { LocationType } from '../../src/shared/api/common';
import { ErrorBody } from '../../src/shared/api/common';
import { DeckList, DeckSummary, DeckView, SlotRow } from '../../src/shared/api/decks';

let db: OpenDb;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
});
afterEach(() => db.$client.close());

/** A card with one printing whose printing id is `<oracleId>-1`. */
function card(oracleId: string, options: { basic?: boolean; colors?: string } = {}) {
  db.insert(cards)
    .values({
      oracleId,
      name: oracleId,
      frontFaceName: oracleId,
      typeLine: options.basic ? 'Basic Land — Forest' : 'Creature',
      colorIdentity: options.colors ?? '',
      commanderLegality: 'legal',
      isBasicLand: options.basic ?? false,
      canBeCommander: !options.basic,
    })
    .run();
  printing(oracleId, 1);
  return oracleId;
}

function printing(oracleId: string, n: number, releasedAt = '2024-01-01') {
  db.insert(printings)
    .values({
      printingId: `${oracleId}-${n}`,
      oracleId,
      setCode: 'tst',
      setName: 'Test set',
      collectorNumber: String(n),
      lang: 'en',
      finishes: ['nonfoil'],
      rarity: 'rare',
      releasedAt,
      imageSmall: `small-${oracleId}-${n}`,
      imageNormal: `normal-${oracleId}-${n}`,
    })
    .run();
  return `${oracleId}-${n}`;
}

function place(name: string, type: LocationType = 'box', parentId: number | null = null) {
  return db.insert(locations).values({ name, type, parentId }).returning().get().id;
}

function stack(
  oracleId: string,
  locationId: number,
  quantity = 1,
  options: { proxy?: boolean; printingId?: string } = {},
) {
  db.insert(copyStacks)
    .values({
      printingId: options.printingId ?? `${oracleId}-1`,
      quantity,
      finish: 'nonfoil',
      condition: 'near_mint',
      language: 'en',
      isProxy: options.proxy ?? false,
      locationId,
    })
    .run();
}

function deck(name: string, slots: DeckSlotInput[]) {
  const id = createDeck(db, { name, slots });
  const row = db.select().from(decks).where(eq(decks.id, id)).get();
  return { id, boxId: row?.deckBoxId ?? 0 };
}

const main = (oracleId: string, quantity = 1): DeckSlotInput => ({
  oracleId,
  board: 'main',
  quantity,
});

function view(id: number) {
  const result = deckView(db, id);
  if (!result) throw new Error('no deck');
  return DeckView.parse(result);
}

function slotFor(id: number, oracleId: string, board = 'main') {
  const slot = view(id).slots.find((s) => s.card.oracleId === oracleId && s.board === board);
  if (!slot) throw new Error(`no ${oracleId} slot`);
  return slot;
}

function refusal(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return { status: err.status, code: err.code };
    throw err;
  }
  throw new Error('not refused');
}

describe('creating decks', () => {
  it('creates a top-level deck box named after the deck, then the slots', () => {
    const korvold = card('korvold', { colors: 'BRG' });
    const ring = card('sol-ring');
    const { id, boxId } = deck('Korvold', [
      { oracleId: korvold, board: 'commander', quantity: 1 },
      main(ring),
      main(ring),
    ]);
    const box = db.select().from(locations).where(eq(locations.id, boxId)).get();
    expect(box).toMatchObject({ name: 'Korvold deck box', type: 'deck_box', parentId: null });

    const { deck: summary, slots } = view(id);
    expect(summary.commanders.map((c) => c.oracleId)).toEqual([korvold]);
    expect(summary.colorIdentity).toBe('BRG');
    expect(summary.commanders[0].imageSmall).toBe('small-korvold-1');
    expect(slots.map((s) => [s.card.oracleId, s.board, s.quantity])).toEqual([
      [korvold, 'commander', 1],
      [ring, 'main', 2],
    ]);
  });

  it('refuses a card the card data doesn’t know', () => {
    expect(refusal(() => deck('Nobody', [main('nope')]))).toEqual({
      status: 400,
      code: 'card_not_found',
    });
    expect(db.select().from(decks).all()).toHaveLength(0);
  });

  it('keeps printing hints', () => {
    const ring = card('sol-ring');
    const { id } = deck('Hints', [
      { ...main(ring), hint: { setCode: 'eoc', collectorNumber: '57', foil: true } },
    ]);
    expect(slotFor(id, ring).hint).toEqual({ setCode: 'eoc', collectorNumber: '57', foil: true });
  });
});

describe('slot status', () => {
  it('is in_box when copies in the deck box fill the slot', () => {
    const ring = card('sol-ring');
    const { id, boxId } = deck('A', [main(ring)]);
    stack(ring, boxId);
    expect(slotFor(id, ring)).toMatchObject({ status: 'in_box', inBoxQuantity: 1 });
  });

  it('is free with the storage spots best first, with paths and colors', () => {
    const ring = card('sol-ring');
    const closet = db
      .insert(locations)
      .values({ name: 'Closet', type: 'box', color: '#ff0000' })
      .returning()
      .get().id;
    const tray = place('Row A', 'tray', closet);
    const binder = place('Binder', 'binder');
    const inbox = db.select().from(locations).where(eq(locations.type, 'inbox')).get()?.id ?? 0;
    stack(ring, binder, 1);
    stack(ring, tray, 3);
    stack(ring, inbox, 1);
    const { id } = deck('A', [main(ring)]);

    const slot = slotFor(id, ring);
    expect(slot.status).toBe('free');
    expect(slot.where.freeCount).toBe(5);
    expect(slot.where.locations.map((l) => [l.name, l.path, l.color])).toEqual([
      ['Row A', 'Closet › Row A', '#ff0000'],
      ['To sort', 'To sort', null],
      ['Binder', 'Binder', null],
    ]);
  });

  it('counts copies of any printing', () => {
    const ring = card('sol-ring');
    const other = printing(ring, 2);
    stack(ring, place('Binder'), 1, { printingId: other });
    const { id } = deck('A', [main(ring)]);
    expect(slotFor(id, ring).status).toBe('free');
  });

  it('is other_decks when copies sit only in other decks’ boxes, naming them', () => {
    const ring = card('sol-ring');
    const atraxa = deck('Atraxa', [main(ring)]);
    stack(ring, atraxa.boxId);
    const { id } = deck('Hearthhull', [main(ring)]);
    const slot = slotFor(id, ring);
    expect(slot.status).toBe('other_decks');
    expect(slot.where.otherDecks).toEqual([{ id: atraxa.id, name: 'Atraxa' }]);
    expect(view(id).deck.counts.otherDecks).toBe(1);
  });

  it('is missing when there is no copy outside this deck’s box', () => {
    const ring = card('sol-ring');
    const { id } = deck('A', [main(ring)]);
    expect(slotFor(id, ring)).toMatchObject({ status: 'missing', where: { locations: [] } });
  });

  it('lets a proxy fill a slot', () => {
    const ring = card('sol-ring');
    const { id, boxId } = deck('A', [main(ring)]);
    stack(ring, boxId, 1, { proxy: true });
    expect(slotFor(id, ring)).toMatchObject({ status: 'in_box', inBoxProxy: true });
  });

  it('says how many are in the box when it holds part of a slot, and describes the rest', () => {
    const forestLike = card('cultivate');
    const { id, boxId } = deck('A', [main(forestLike, 3)]);
    stack(forestLike, boxId, 1);
    stack(forestLike, place('Bulk'), 1);
    const slot = slotFor(id, forestLike);
    expect(slot).toMatchObject({ status: 'free', inBoxQuantity: 1 });
    expect(view(id).deck.counts).toEqual({
      inBox: 1,
      free: 1,
      otherDecks: 0,
      missing: 1,
      basics: 0,
    });
  });

  it('marks basic lands as basic, counted apart', () => {
    const forest = card('forest', { basic: true });
    const { id } = deck('A', [main(forest, 30)]);
    expect(slotFor(id, forest).status).toBe('basic');
    expect(view(id).deck.counts.basics).toBe(30);
  });

  it('gives maybe board slots no status', () => {
    const ring = card('sol-ring');
    stack(ring, place('Binder'));
    const { id } = deck('A', [{ oracleId: ring, board: 'maybe', quantity: 1 }]);
    expect(slotFor(id, ring, 'maybe').status).toBeNull();
    expect(view(id).deck.counts).toEqual({
      inBox: 0,
      free: 0,
      otherDecks: 0,
      missing: 0,
      basics: 0,
    });
  });

  it('shows the last copy free to two decks that both want it (no reservations)', () => {
    const ring = card('sol-ring');
    stack(ring, place('Binder'));
    const a = deck('A', [main(ring)]);
    const b = deck('B', [main(ring)]);
    expect(slotFor(a.id, ring).status).toBe('free');
    expect(slotFor(b.id, ring).status).toBe('free');
  });
});

describe('deck state and counts', () => {
  it('goes from not assembled to partly to assembled, leaving basics out', () => {
    const ring = card('sol-ring');
    const signet = card('signet');
    const forest = card('forest', { basic: true });
    stack(ring, place('Binder'));
    const { id, boxId } = deck('A', [main(ring), main(signet), main(forest, 10)]);
    expect(view(id).deck.state).toBe('not_assembled');

    stack(ring, boxId);
    expect(view(id).deck.state).toBe('partly_assembled');

    stack(signet, boxId);
    expect(view(id).deck).toMatchObject({
      state: 'assembled',
      counts: { inBox: 2, free: 0, otherDecks: 0, missing: 0, basics: 10 },
    });
  });

  it('counts every copy in the box, needed or not', () => {
    const ring = card('sol-ring');
    const extra = card('extra');
    const { id, boxId } = deck('A', [main(ring)]);
    stack(ring, boxId, 2);
    stack(extra, boxId, 1);
    expect(view(id).deck).toMatchObject({ boxCopyCount: 3, counts: { inBox: 1 } });
    expect(slotFor(id, ring).inBoxQuantity).toBe(1);
  });
});

describe('editing slots', () => {
  it('addSlot merges into the slot for that card and board', () => {
    const ring = card('sol-ring');
    const { id } = deck('A', [main(ring)]);
    const first = slotFor(id, ring).id;
    expect(addSlot(db, id, main(ring, 2))).toBe(first);
    expect(slotFor(id, ring).quantity).toBe(3);

    addSlot(db, id, { oracleId: ring, board: 'maybe', quantity: 1 });
    expect(view(id).slots).toHaveLength(2);
  });

  it('moveSlotBoard merges when the target board already has the card', () => {
    const ring = card('sol-ring');
    const { id } = deck('A', [main(ring, 2), { oracleId: ring, board: 'maybe', quantity: 1 }]);
    const maybe = slotFor(id, ring, 'maybe').id;
    const ends = moveSlotBoard(db, id, maybe, 'main');
    expect(ends).toBe(slotFor(id, ring).id);
    expect(view(id).slots.map((s) => [s.board, s.quantity])).toEqual([['main', 3]]);
  });

  it('moveSlotBoard moves a slot to an empty board', () => {
    const ring = card('sol-ring');
    const { id } = deck('A', [main(ring)]);
    const slot = slotFor(id, ring).id;
    expect(moveSlotBoard(db, id, slot, 'maybe')).toBe(slot);
    expect(slotFor(id, ring, 'maybe').status).toBeNull();
  });

  it('moving a slot to the maybe board takes it out of the counts, and back puts it in', () => {
    const ring = card('sol-ring');
    const { id, boxId } = deck('A', [main(ring)]);
    stack(ring, boxId);
    const slot = slotFor(id, ring).id;
    expect(view(id).deck.counts.inBox).toBe(1);

    moveSlotBoard(db, id, slot, 'maybe');
    expect(view(id).deck.counts).toMatchObject({ inBox: 0, missing: 0 });
    expect(slotFor(id, ring, 'maybe').inBoxQuantity).toBe(0);

    moveSlotBoard(db, id, slot, 'main');
    expect(view(id).deck.counts.inBox).toBe(1);
    expect(slotFor(id, ring).status).toBe('in_box');
  });

  it('setSlotPrinting makes the printing the hint and the decklist’s printing', () => {
    const ring = card('sol-ring');
    const second = printing(ring, 2);
    const { id } = deck('A', [main(ring)]);
    const slot = slotFor(id, ring).id;
    expect(slotFor(id, ring).printing).toBeNull();

    setSlotPrinting(db, id, slot, { printingId: second, foil: true });
    const row = slotFor(id, ring);
    expect(row.hint).toEqual({ setCode: 'tst', collectorNumber: '2', foil: true });
    expect(row.printing?.printingId).toBe(second);
    expect(row.printing?.imageNormal).toBe(`normal-${ring}-2`);
  });

  it('setSlotPrinting clears a picked printing of another printing, keeping the copy', () => {
    const ring = card('sol-ring');
    const second = printing(ring, 2);
    const { id, boxId } = deck('A', [main(ring)]);
    stack(ring, boxId);
    db.update(deckSlots)
      .set({ pickedPrintingId: `${ring}-1` })
      .run();
    const slot = slotFor(id, ring).id;

    setSlotPrinting(db, id, slot, { printingId: `${ring}-1`, foil: false });
    expect(slotFor(id, ring).pickedPrinting?.printingId).toBe(`${ring}-1`);

    setSlotPrinting(db, id, slot, { printingId: second, foil: false });
    const row = slotFor(id, ring);
    expect(row.pickedPrinting).toBeNull();
    expect(row.printing?.printingId).toBe(second);
    expect(row).toMatchObject({ status: 'in_box', inBoxQuantity: 1 });
  });

  it('setSlotPrinting refuses a printing of another card or one not in the card data', () => {
    const ring = card('sol-ring');
    const signet = card('signet');
    const { id } = deck('A', [main(ring)]);
    const slot = slotFor(id, ring).id;
    expect(
      refusal(() => setSlotPrinting(db, id, slot, { printingId: `${signet}-1`, foil: false })),
    ).toEqual({ status: 400, code: 'wrong_card' });
    expect(
      refusal(() => setSlotPrinting(db, id, slot, { printingId: 'nope', foil: false })),
    ).toEqual({ status: 404, code: 'printing_not_found' });
  });

  it('sets quantities and removes slots', () => {
    const ring = card('sol-ring');
    const { id } = deck('A', [main(ring)]);
    const slot = slotFor(id, ring).id;
    setSlotQuantity(db, id, slot, 4);
    expect(slotFor(id, ring).quantity).toBe(4);
    removeSlot(db, id, slot);
    expect(view(id).slots).toHaveLength(0);
  });

  it('refuses a slot of another deck', () => {
    const ring = card('sol-ring');
    const a = deck('A', [main(ring)]);
    const b = deck('B', []);
    expect(refusal(() => removeSlot(db, b.id, slotFor(a.id, ring).id))).toEqual({
      status: 404,
      code: 'slot_not_found',
    });
  });

  it('setCommanders swaps commanders, moving one up from the main board', () => {
    const korvold = card('korvold', { colors: 'BRG' });
    const tymna = card('tymna', { colors: 'WB' });
    const thrasios = card('thrasios', { colors: 'GU' });
    const { id } = deck('A', [{ oracleId: korvold, board: 'commander', quantity: 1 }, main(tymna)]);
    db.update(deckSlots)
      .set({ pickedPrintingId: `${tymna}-1` })
      .where(eq(deckSlots.oracleId, tymna))
      .run();
    setCommanders(db, id, [tymna, thrasios]);

    const { deck: summary, slots } = view(id);
    expect(summary.commanders.map((c) => c.oracleId).sort()).toEqual([thrasios, tymna]);
    expect(summary.colorIdentity).toBe('WUBG');
    expect(slots.map((s) => [s.card.oracleId, s.board])).toEqual([
      [tymna, 'commander'],
      [thrasios, 'commander'],
    ]);
    expect(slotFor(id, tymna, 'commander').pickedPrinting?.printingId).toBe(`${tymna}-1`);
  });

  it('replaceSlots keeps picked printings of cards that stay', () => {
    const ring = card('sol-ring');
    const signet = card('signet');
    const grasp = card('grasp');
    const { id } = deck('A', [main(ring), main(signet)]);
    db.update(deckSlots)
      .set({ pickedPrintingId: `${ring}-1` })
      .run();
    const ringSlot = slotFor(id, ring).id;

    replaceSlots(db, id, [main(ring, 2), main(grasp)]);
    const { slots } = view(id);
    expect(slots.map((s) => [s.card.oracleId, s.quantity, s.pickedPrinting?.printingId])).toEqual([
      [ring, 2, `${ring}-1`],
      [grasp, 1, undefined],
    ]);
    expect(slotFor(id, ring).id).toBe(ringSlot);
  });

  it('renames the deck box with the deck while it has the default name', () => {
    const { id, boxId } = deck('Korvold', []);
    const boxName = () => db.select().from(locations).where(eq(locations.id, boxId)).get()?.name;
    renameDeck(db, id, 'Korvold Food');
    expect(boxName()).toBe('Korvold Food deck box');

    db.update(locations).set({ name: 'Red box' }).where(eq(locations.id, boxId)).run();
    renameDeck(db, id, 'Korvold');
    expect(boxName()).toBe('Red box');
  });
});

describe('deleting decks', () => {
  it('is refused while the deck box holds copies', () => {
    const ring = card('sol-ring');
    const { id, boxId } = deck('A', [main(ring)]);
    stack(ring, boxId);
    expect(refusal(() => deleteDeck(db, id))).toEqual({
      status: 409,
      code: 'deck_box_not_empty',
    });
  });

  it('leaves deleted decks out everywhere', () => {
    const ring = card('sol-ring');
    const gone = deck('Gone', [main(ring)]);
    const { id } = deck('Kept', [main(ring)]);
    deleteDeck(db, gone.id);
    expect(deckList(db).map((d) => d.name)).toEqual(['Kept']);
    expect(deckView(db, gone.id)).toBeUndefined();
    expect(
      db.select().from(locations).where(eq(locations.id, gone.boxId)).get()?.deletedAt,
    ).not.toBeNull();
    // A stray copy left in a deleted deck's box doesn't make it "another deck".
    stack(ring, gone.boxId);
    expect(slotFor(id, ring).status).toBe('missing');
  });
});

// The same typed client the screens use (src/client/api.ts), answered by the app in memory.
const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

async function body<T extends z.ZodType>(res: Response, schema: T, status = 200) {
  expect(res.status).toBe(status);
  return schema.parse(await res.json());
}

describe('decks routes', () => {
  it('creates, opens, lists, renames and deletes a deck', async () => {
    const korvold = card('korvold', { colors: 'BRG' });
    const created = await body(
      await api.decks.$post({ json: { name: 'Korvold', commanders: [korvold] } }),
      DeckSummary,
      201,
    );
    expect(created).toMatchObject({ name: 'Korvold', state: 'not_assembled', openedAt: null });
    const other = deck('Older', []);

    const param = { id: String(created.id) };
    const opened = await body(await api.decks[':id'].$get({ param }), DeckView);
    expect(opened.deck.openedAt).not.toBeNull();
    expect(opened.slots[0]).toMatchObject({ board: 'commander', status: 'missing' });

    const list = await body(await api.decks.$get(), DeckList);
    expect(list.decks.map((d) => d.id)).toEqual([created.id, other.id]);

    const renamed = await api.decks[':id'].$patch({ param, json: { name: 'Food' } });
    expect((await body(renamed, DeckSummary)).name).toBe('Food');

    expect((await api.decks[':id'].$delete({ param })).status).toBe(204);
    const gone = await api.decks[':id'].$get({ param });
    expect((await body(gone, ErrorBody, 404)).error.code).toBe('deck_not_found');
  });

  it('lists opened decks newest first, never-opened last', async () => {
    const a = deck('A', []);
    const b = deck('B', []);
    const c = deck('C', []);
    await api.decks[':id'].$get({ param: { id: String(b.id) } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await api.decks[':id'].$get({ param: { id: String(a.id) } });
    const list = await body(await api.decks.$get(), DeckList);
    expect(list.decks.map((d) => d.id)).toEqual([a.id, b.id, c.id]);
  });

  it('edits slots and commanders', async () => {
    const korvold = card('korvold');
    const ring = card('sol-ring');
    const { id } = deck('A', [{ oracleId: korvold, board: 'commander', quantity: 1 }]);
    const param = { id: String(id) };

    const added = await body(
      await api.decks[':id'].slots.$post({ param, json: main(ring) }),
      SlotRow,
    );
    expect(added).toMatchObject({ quantity: 1, status: 'missing' });

    const slot = { id: String(id), slotId: String(added.id) };
    const changed = await api.decks[':id'].slots[':slotId'].$patch({
      param: slot,
      json: { quantity: 2, board: 'maybe' },
    });
    expect(await body(changed, SlotRow)).toMatchObject({
      quantity: 2,
      board: 'maybe',
      status: null,
    });

    const reprinted = await api.decks[':id'].slots[':slotId'].$patch({
      param: slot,
      json: { printing: { printingId: `${ring}-1`, foil: false } },
    });
    expect((await body(reprinted, SlotRow)).printing?.printingId).toBe(`${ring}-1`);

    const empty = await api.decks[':id'].slots[':slotId'].$patch({ param: slot, json: {} });
    expect((await body(empty, ErrorBody, 400)).error.code).toBe('invalid_request');

    const commanders = await api.decks[':id'].commanders.$put({
      param,
      json: { oracleIds: [ring] },
    });
    expect((await body(commanders, DeckView)).deck.commanders.map((c) => c.oracleId)).toEqual([
      ring,
    ]);

    const removed = await api.decks[':id'].slots[':slotId'].$delete({ param: slot });
    expect(removed.status).toBe(204);
  });

  it('refuses to delete a deck whose box holds copies', async () => {
    const ring = card('sol-ring');
    const { id, boxId } = deck('Hearthhull', [main(ring)]);
    stack(ring, boxId, 2);
    const res = await api.decks[':id'].$delete({ param: { id: String(id) } });
    const error = (await body(res, ErrorBody, 409)).error;
    expect(error.code).toBe('deck_box_not_empty');
    expect(error.message).toContain('Hearthhull deck box still holds 2 cards');
  });

  it('checks ids and bodies', async () => {
    const bad = await api.decks[':id'].$get({ param: { id: 'one' } });
    expect((await body(bad, ErrorBody, 400)).error.code).toBe('invalid_request');

    for (const commanders of [[], ['a', 'b', 'c']]) {
      const res = await api.decks.$post({ json: { name: 'Korvold', commanders } });
      expect((await body(res, ErrorBody, 400)).error.code).toBe('invalid_request');
    }

    const missing = await api.decks[':id'].$patch({ param: { id: '99' }, json: { name: 'X' } });
    expect((await body(missing, ErrorBody, 404)).error.code).toBe('deck_not_found');
  });
});
