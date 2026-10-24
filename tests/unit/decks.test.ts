import { eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { AppType } from '../../src/server/app';
import { app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { copyStacks, deckSlots, decks, locations } from '../../src/server/db/schema';
import { createTestDb, insertCard, insertPrinting } from '../../src/server/db/test-db';
import { AppError } from '../../src/server/errors';
import { deckList, deckView } from '../../src/server/queries/decks';
import { demandWarnings } from '../../src/server/queries/demand';
import {
  addSlot,
  createDeck,
  type DeckSlotInput,
  deleteDeck,
  moveSlotBoard,
  removeSlot,
  renameDeck,
  replaceSlots,
  setLegend,
  setRunes,
  setSlotPrinting,
  setSlotQuantity,
  setSlotTags,
} from '../../src/server/services/decks';
import type { Domain, LocationType } from '../../src/shared/api/common';
import { ErrorBody } from '../../src/shared/api/common';
import { DeckList, DeckSummary, DeckView, SlotRow } from '../../src/shared/api/decks';

let db: OpenDb;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
});
afterEach(() => db.$client.close());

/** Each test card's name, by id; a card's printings are `<name>-<n>`. */
const names = new Map<number, string>();
const nameOf = (cardId: number) => names.get(cardId) ?? '';

/** A card with one printing whose printing id is `<name>-1`. */
function card(
  name: string,
  options: { rune?: boolean; legend?: boolean; domains?: Domain[] } = {},
) {
  const type = options.rune ? 'rune' : options.legend ? 'legend' : 'unit';
  const cardId = insertCard(db, { name, type, domains: options.domains ?? [] });
  names.set(cardId, name);
  printing(cardId, 1);
  return cardId;
}

function printing(cardId: number, n: number) {
  const riftcodexId = `${nameOf(cardId)}-${n}`;
  insertPrinting(db, {
    riftcodexId,
    cardId,
    setCode: 'TST',
    setName: 'Test set',
    collectorNumber: String(n),
    publicCode: `TST-${String(n).padStart(3, '0')}/100`,
    finishes: ['normal'],
    rarity: 'rare',
    imageUrl: `image-${riftcodexId}`,
  });
  return riftcodexId;
}

function place(name: string, type: LocationType = 'box', parentId: number | null = null) {
  return db.insert(locations).values({ name, type, parentId }).returning().get().id;
}

function stack(
  cardId: number,
  locationId: number,
  quantity = 1,
  options: { proxy?: boolean; printingId?: string } = {},
) {
  db.insert(copyStacks)
    .values({
      printingId: options.printingId ?? `${nameOf(cardId)}-1`,
      quantity,
      finish: 'normal',
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

const main = (cardId: number, quantity = 1): DeckSlotInput => ({
  cardId,
  board: 'main',
  quantity,
});

function view(id: number) {
  const result = deckView(db, id);
  if (!result) throw new Error('no deck');
  return DeckView.parse(result);
}

function slotFor(id: number, cardId: number, board = 'main') {
  const slot = view(id).slots.find((s) => s.card.id === cardId && s.board === board);
  if (!slot) throw new Error(`no ${nameOf(cardId)} slot`);
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
    const dariusAggro = card('dariusAggro', { legend: true, domains: ['fury', 'order'] });
    const ring = card('sol-ring');
    const { id, boxId } = deck('Darius Aggro', [
      { cardId: dariusAggro, board: 'legend', quantity: 1 },
      main(ring),
      main(ring),
    ]);
    const box = db.select().from(locations).where(eq(locations.id, boxId)).get();
    expect(box).toMatchObject({ name: 'Darius Aggro deck box', type: 'deck_box', parentId: null });

    const { deck: summary, slots } = view(id);
    expect(summary.legend?.id).toBe(dariusAggro);
    expect(summary.champion).toBeNull();
    expect(summary.domains).toEqual(['fury', 'order']);
    expect(summary.legend?.imageUrl).toBe('image-dariusAggro-1');
    expect(slots.map((s) => [s.card.id, s.board, s.quantity])).toEqual([
      [dariusAggro, 'legend', 1],
      [ring, 'main', 2],
    ]);
  });

  it('refuses a card the card data doesn’t know', () => {
    expect(refusal(() => deck('Nobody', [main(999)]))).toEqual({
      status: 400,
      code: 'card_not_found',
    });
    expect(db.select().from(decks).all()).toHaveLength(0);
  });

  it('keeps printing hints', () => {
    const ring = card('sol-ring');
    const { id } = deck('Hints', [{ ...main(ring), hint: { publicCode: 'OGN-057', foil: true } }]);
    expect(slotFor(id, ring).hint).toEqual({ publicCode: 'OGN-057', foil: true });
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
    const luxControl = deck('Lux Control', [main(ring)]);
    stack(ring, luxControl.boxId);
    const { id } = deck('Jinx Burn', [main(ring)]);
    const slot = slotFor(id, ring);
    expect(slot.status).toBe('other_decks');
    expect(slot.where.otherDecks).toEqual([{ id: luxControl.id, name: 'Lux Control' }]);
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
    const calmRuneLike = card('grimScheme');
    const { id, boxId } = deck('A', [main(calmRuneLike, 3)]);
    stack(calmRuneLike, boxId, 1);
    stack(calmRuneLike, place('Bulk'), 1);
    const slot = slotFor(id, calmRuneLike);
    expect(slot).toMatchObject({ status: 'free', inBoxQuantity: 1 });
    expect(view(id).deck.counts).toEqual({
      inBox: 1,
      free: 1,
      otherDecks: 0,
      missing: 1,
      runes: 0,
    });
  });

  it('marks basic lands as basic, counted apart', () => {
    const calmRune = card('calmRune', { rune: true });
    const { id } = deck('A', [main(calmRune, 30)]);
    expect(slotFor(id, calmRune).status).toBe('rune');
    expect(view(id).deck.counts.runes).toBe(30);
  });

  it('gives maybe board slots no status', () => {
    const ring = card('sol-ring');
    stack(ring, place('Binder'));
    const { id } = deck('A', [{ cardId: ring, board: 'maybe', quantity: 1 }]);
    expect(slotFor(id, ring, 'maybe').status).toBeNull();
    expect(view(id).deck.counts).toEqual({
      inBox: 0,
      free: 0,
      otherDecks: 0,
      missing: 0,
      runes: 0,
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
    const calmRune = card('calmRune', { rune: true });
    stack(ring, place('Binder'));
    const { id, boxId } = deck('A', [main(ring), main(signet), main(calmRune, 10)]);
    expect(view(id).deck.state).toBe('not_assembled');

    stack(ring, boxId);
    expect(view(id).deck.state).toBe('partly_assembled');

    stack(signet, boxId);
    expect(view(id).deck).toMatchObject({
      state: 'assembled',
      counts: { inBox: 2, free: 0, otherDecks: 0, missing: 0, runes: 10 },
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

    addSlot(db, id, { cardId: ring, board: 'maybe', quantity: 1 });
    expect(view(id).slots).toHaveLength(2);
  });

  it('moveSlotBoard merges when the target board already has the card', () => {
    const ring = card('sol-ring');
    const { id } = deck('A', [main(ring, 2), { cardId: ring, board: 'maybe', quantity: 1 }]);
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
    expect(row.hint).toEqual({ publicCode: 'TST-002/100', foil: true });
    expect(row.printing?.printingId).toBe(second);
    expect(row.printing?.imageUrl).toBe(`image-${nameOf(ring)}-2`);
  });

  it('setSlotPrinting clears a picked printing of another printing, keeping the copy', () => {
    const ring = card('sol-ring');
    const second = printing(ring, 2);
    const { id, boxId } = deck('A', [main(ring)]);
    stack(ring, boxId);
    db.update(deckSlots)
      .set({ pickedPrintingId: `${nameOf(ring)}-1` })
      .run();
    const slot = slotFor(id, ring).id;

    setSlotPrinting(db, id, slot, { printingId: `${nameOf(ring)}-1`, foil: false });
    expect(slotFor(id, ring).pickedPrinting?.printingId).toBe(`${nameOf(ring)}-1`);

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
      refusal(() =>
        setSlotPrinting(db, id, slot, { printingId: `${nameOf(signet)}-1`, foil: false }),
      ),
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

  it('the deck view counts the cards on each board', () => {
    const jinx = card('jinx', { legend: true, domains: ['fury', 'chaos'] });
    const blast = card('blast');
    const rune = card('fury-rune', { rune: true });
    const { id } = deck('A', [
      { cardId: jinx, board: 'legend', quantity: 1 },
      main(blast, 3),
      { cardId: rune, board: 'rune', quantity: 12 },
      { cardId: blast, board: 'maybe', quantity: 1 },
    ]);
    expect(view(id).boards).toEqual({
      legend: 1,
      champion: 0,
      main: 3,
      battlefield: 0,
      rune: 12,
      sideboard: 0,
      maybe: 1,
    });
  });

  it('setLegend replaces the Legend, leaving the other boards alone', () => {
    const dariusAggro = card('dariusAggro', { legend: true, domains: ['fury', 'order'] });
    const leeSin = card('leeSin', { legend: true, domains: ['calm', 'body'] });
    const champion = card('champion', { domains: ['calm'] });
    const { id } = deck('A', [
      { cardId: dariusAggro, board: 'legend', quantity: 1 },
      { cardId: champion, board: 'champion', quantity: 1 },
    ]);
    setLegend(db, id, leeSin);

    const { deck: summary, slots } = view(id);
    expect(summary.legend?.id).toBe(leeSin);
    expect(summary.champion?.id).toBe(champion);
    expect(summary.domains).toEqual(['calm', 'body']);
    // Board by board, so the new Legend comes first.
    expect(slots.map((s) => [s.card.id, s.board])).toEqual([
      [leeSin, 'legend'],
      [champion, 'champion'],
    ]);
    expect(refusal(() => setLegend(db, id, 999))).toEqual({ status: 400, code: 'card_not_found' });
  });

  it('replaceSlots keeps picked printings of cards that stay', () => {
    const ring = card('sol-ring');
    const signet = card('signet');
    const grasp = card('grasp');
    const { id } = deck('A', [main(ring), main(signet)]);
    db.update(deckSlots)
      .set({ pickedPrintingId: `${nameOf(ring)}-1` })
      .run();
    const ringSlot = slotFor(id, ring).id;

    replaceSlots(db, id, [main(ring, 2), main(grasp)]);
    const { slots } = view(id);
    expect(slots.map((s) => [s.card.id, s.quantity, s.pickedPrinting?.printingId])).toEqual([
      [ring, 2, `${nameOf(ring)}-1`],
      [grasp, 1, undefined],
    ]);
    expect(slotFor(id, ring).id).toBe(ringSlot);
  });

  it('renames the deck box with the deck while it has the default name', () => {
    const { id, boxId } = deck('Darius Aggro', []);
    const boxName = () => db.select().from(locations).where(eq(locations.id, boxId)).get()?.name;
    renameDeck(db, id, 'Darius Aggro Food');
    expect(boxName()).toBe('Darius Aggro Food deck box');

    db.update(locations).set({ name: 'Red box' }).where(eq(locations.id, boxId)).run();
    renameDeck(db, id, 'Darius Aggro');
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

describe('boards', () => {
  const on = (board: DeckSlotInput['board'], cardId: number, quantity = 1): DeckSlotInput => ({
    cardId,
    board,
    quantity,
  });

  it('gives each board’s slots their status, runes always available', () => {
    const jinx = card('jinx', { legend: true });
    const champ = card('champ');
    const inBox = card('inBox');
    const free = card('free');
    const elsewhere = card('elsewhere');
    const gone = card('gone');
    const field = card('field');
    const fury = card('fury', { rune: true });
    const { id, boxId } = deck('A', [
      on('legend', jinx),
      on('champion', champ),
      on('main', inBox),
      on('main', free),
      on('main', elsewhere),
      on('sideboard', gone),
      on('battlefield', field),
      on('rune', fury, 6),
      on('maybe', free),
    ]);
    const other = deck('B', [on('main', elsewhere)]);
    stack(jinx, boxId);
    stack(inBox, boxId);
    stack(champ, place('Binder'));
    stack(free, place('Long box'));
    stack(elsewhere, other.boxId);
    stack(field, boxId);

    expect(view(id).slots.map((s) => [s.board, s.card.name, s.status])).toEqual([
      ['legend', 'jinx', 'in_box'],
      ['champion', 'champ', 'free'],
      ['main', 'inBox', 'in_box'],
      ['main', 'free', 'free'],
      ['main', 'elsewhere', 'other_decks'],
      ['battlefield', 'field', 'in_box'],
      ['rune', 'fury', 'rune'],
      ['sideboard', 'gone', 'missing'],
      ['maybe', 'free', null],
    ]);
    expect(slotFor(id, elsewhere).where.otherDecks.map((d) => d.name)).toEqual(['B']);
    expect(view(id).deck.counts).toEqual({
      inBox: 3,
      free: 2,
      otherDecks: 1,
      missing: 1,
      runes: 6,
    });
  });

  it('counts demand across two decks, leaving out maybe boards and runes', () => {
    const signet = card('signet');
    const fury = card('fury', { rune: true });
    stack(signet, place('Binder'), 2);
    deck('A', [on('main', signet), on('rune', fury, 6), on('maybe', signet, 3)]);
    deck('B', [on('sideboard', signet), on('rune', fury, 6)]);
    expect(demandWarnings(db, [signet, fury]).size).toBe(0);

    deck('C', [on('main', signet)]);
    expect(demandWarnings(db, [signet, fury]).get(signet)).toMatchObject({
      demand: 3,
      owned: 2,
      shortage: 1,
    });
    expect(demandWarnings(db, [fury]).size).toBe(0);
  });

  it('is partly assembled while the sideboard is partly pulled, runes and maybe left out', () => {
    const main1 = card('main1');
    const side = card('side');
    const fury = card('fury', { rune: true });
    const maybe = card('maybe');
    const { id, boxId } = deck('A', [
      on('main', main1),
      on('sideboard', side, 2),
      on('rune', fury, 12),
      on('maybe', maybe),
    ]);
    stack(main1, boxId);
    stack(side, boxId);
    expect(view(id).deck.state).toBe('partly_assembled');
    expect(slotFor(id, side, 'sideboard')).toMatchObject({ status: 'missing', inBoxQuantity: 1 });

    stack(side, boxId, 1, { proxy: true });
    expect(view(id).deck.state).toBe('assembled');
  });

  it('merges a main deck slot into the sideboard slot, keeping both slots’ tags', () => {
    const ring = card('ring');
    const { id } = deck('A', [on('main', ring, 2), on('sideboard', ring)]);
    const mainSlot = slotFor(id, ring).id;
    const sideSlot = slotFor(id, ring, 'sideboard').id;
    setSlotTags(db, id, mainSlot, ['Removal', 'Early']);
    setSlotTags(db, id, sideSlot, ['removal', 'Matchup']);

    expect(moveSlotBoard(db, id, mainSlot, 'sideboard')).toBe(sideSlot);
    expect(view(id).slots).toHaveLength(1);
    expect(slotFor(id, ring, 'sideboard')).toMatchObject({
      quantity: 3,
      tags: ['Early', 'Matchup', 'Removal'],
    });
  });

  it('refuses to move the Legend, champion, battlefield or rune slots', () => {
    const jinx = card('jinx', { legend: true });
    const champ = card('champ');
    const field = card('field');
    const fury = card('fury', { rune: true });
    const { id } = deck('A', [
      on('legend', jinx),
      on('champion', champ),
      on('battlefield', field),
      on('rune', fury, 6),
    ]);
    expect(refusal(() => moveSlotBoard(db, id, slotFor(id, jinx, 'legend').id, 'main'))).toEqual({
      status: 400,
      code: 'board_fixed',
    });
    for (const [cardId, board] of [
      [champ, 'champion'],
      [field, 'battlefield'],
      [fury, 'rune'],
    ] as const) {
      expect(
        refusal(() => moveSlotBoard(db, id, slotFor(id, cardId, board).id, 'sideboard')),
      ).toMatchObject({ code: 'board_fixed' });
    }
    expect(view(id).slots.map((s) => s.board)).toEqual([
      'legend',
      'champion',
      'battlefield',
      'rune',
    ]);
  });

  it('sets rune counts, a count of 0 taking the rune off', () => {
    const fury = card('fury', { rune: true });
    const chaos = card('chaos', { rune: true });
    const calm = card('calm', { rune: true });
    const ring = card('ring');
    const { id } = deck('A', [on('rune', calm, 4)]);

    setRunes(db, id, [
      { cardId: fury, quantity: 6 },
      { cardId: chaos, quantity: 6 },
    ]);
    expect(view(id).boards.rune).toBe(16);

    setRunes(db, id, [
      { cardId: fury, quantity: 8 },
      { cardId: calm, quantity: 0 },
    ]);
    const runes = view(id).slots.map((s) => [s.card.name, s.quantity, s.status]);
    expect(runes).toEqual([
      ['fury', 8, 'rune'],
      ['chaos', 6, 'rune'],
    ]);
    expect(view(id).deck.counts.runes).toBe(14);

    expect(refusal(() => setRunes(db, id, [{ cardId: ring, quantity: 2 }]))).toEqual({
      status: 400,
      code: 'not_a_rune',
    });
    expect(refusal(() => setRunes(db, 999, [{ cardId: fury, quantity: 2 }]))).toEqual({
      status: 404,
      code: 'deck_not_found',
    });
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
    const dariusAggro = card('dariusAggro', { legend: true, domains: ['fury', 'order'] });
    const created = await body(
      await api.decks.$post({ json: { name: 'Darius Aggro', legendId: dariusAggro } }),
      DeckSummary,
      201,
    );
    expect(created).toMatchObject({ name: 'Darius Aggro', state: 'not_assembled', openedAt: null });
    const other = deck('Older', []);

    const param = { id: String(created.id) };
    const opened = await body(await api.decks[':id'].$get({ param }), DeckView);
    expect(opened.deck.openedAt).not.toBeNull();
    expect(opened.slots[0]).toMatchObject({ board: 'legend', status: 'missing' });

    const list = await body(await api.decks.$get(), DeckList);
    expect(list.decks.map((d) => d.id)).toEqual([created.id, other.id]);

    const renamed = await api.decks[':id'].$patch({ param, json: { name: 'Food' } });
    expect((await body(renamed, DeckSummary)).name).toBe('Food');

    expect((await api.decks[':id'].$delete({ param })).status).toBe(204);
    const gone = await api.decks[':id'].$get({ param });
    expect((await body(gone, ErrorBody, 404)).error.code).toBe('deck_not_found');
  });

  it('creates a deck with its Chosen Champion', async () => {
    const jinx = card('jinxLooseCannon', { legend: true, domains: ['fury', 'chaos'] });
    const rebel = card('jinxRebel', { domains: ['fury', 'chaos'] });
    const created = await body(
      await api.decks.$post({ json: { name: 'Jinx Burn', legendId: jinx, championId: rebel } }),
      DeckSummary,
      201,
    );
    expect(created.legend?.id).toBe(jinx);
    expect(created.champion?.id).toBe(rebel);
    const view = await body(
      await api.decks[':id'].$get({ param: { id: String(created.id) } }),
      DeckView,
    );
    expect(view.slots.map((slot) => [slot.card.id, slot.board, slot.quantity])).toEqual([
      [jinx, 'legend', 1],
      [rebel, 'champion', 1],
    ]);

    const unknown = await api.decks.$post({
      json: { name: 'Jinx Burn', legendId: jinx, championId: 9999 },
    });
    expect((await body(unknown, ErrorBody, 400)).error.code).toBe('card_not_found');
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

  it('edits slots and the Legend', async () => {
    const dariusAggro = card('dariusAggro');
    const ring = card('sol-ring');
    const { id } = deck('A', [{ cardId: dariusAggro, board: 'legend', quantity: 1 }]);
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
      json: { printing: { printingId: `${nameOf(ring)}-1`, foil: false } },
    });
    expect((await body(reprinted, SlotRow)).printing?.printingId).toBe(`${nameOf(ring)}-1`);

    const empty = await api.decks[':id'].slots[':slotId'].$patch({ param: slot, json: {} });
    expect((await body(empty, ErrorBody, 400)).error.code).toBe('invalid_request');

    const legend = await api.decks[':id'].legend.$put({ param, json: { legendId: ring } });
    expect((await body(legend, DeckView)).deck.legend?.id).toBe(ring);

    const removed = await api.decks[':id'].slots[':slotId'].$delete({ param: slot });
    expect(removed.status).toBe(204);
  });

  it('sets rune counts and refuses to move the Legend', async () => {
    const jinx = card('jinx', { legend: true });
    const fury = card('fury', { rune: true });
    const { id } = deck('A', [{ cardId: jinx, board: 'legend', quantity: 1 }]);
    const param = { id: String(id) };

    const res = await api.decks[':id'].runes.$put({
      param,
      json: { runes: [{ cardId: fury, quantity: 6 }] },
    });
    const updated = await body(res, DeckView);
    expect(updated.boards.rune).toBe(6);
    expect(updated.slots.find((s) => s.board === 'rune')?.status).toBe('rune');

    const legendSlot = updated.slots.find((s) => s.board === 'legend')?.id ?? 0;
    const moved = await api.decks[':id'].slots[':slotId'].$patch({
      param: { id: String(id), slotId: String(legendSlot) },
      json: { board: 'main' },
    });
    expect((await body(moved, ErrorBody, 400)).error).toMatchObject({
      code: 'board_fixed',
      message: 'The Legend can’t move to another board.',
    });
  });

  it('refuses to delete a deck whose box holds copies', async () => {
    const ring = card('sol-ring');
    const { id, boxId } = deck('Jinx Burn', [main(ring)]);
    stack(ring, boxId, 2);
    const res = await api.decks[':id'].$delete({ param: { id: String(id) } });
    const error = (await body(res, ErrorBody, 409)).error;
    expect(error.code).toBe('deck_box_not_empty');
    expect(error.message).toContain('Jinx Burn deck box still holds 2 cards');
  });

  it('checks ids and bodies', async () => {
    const bad = await api.decks[':id'].$get({ param: { id: 'one' } });
    expect((await body(bad, ErrorBody, 400)).error.code).toBe('invalid_request');

    for (const json of [{ name: 'Darius Aggro' }, { name: 'Darius Aggro', legendId: 'a' }]) {
      const res = await api.decks.$post({
        json: json as unknown as { name: string; legendId: number },
      });
      expect((await body(res, ErrorBody, 400)).error.code).toBe('invalid_request');
    }

    const missing = await api.decks[':id'].$patch({ param: { id: '99' }, json: { name: 'X' } });
    expect((await body(missing, ErrorBody, 404)).error.code).toBe('deck_not_found');
  });
});
