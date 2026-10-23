import { eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { beforeEach, describe, expect, it } from 'vitest';
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
import { pickList } from '../../src/server/queries/pick-list';
import type { Board, Finish, LocationType } from '../../src/shared/api/common';
import { type PickList, PickListResponse } from '../../src/shared/api/pick-list';

// The pick list worked out from rows inserted straight into a fresh database.

const client = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
});

function inboxId() {
  return db
    .select()
    .from(locations)
    .all()
    .find((l) => l.type === 'inbox')?.id as number;
}

function location(name: string, type: LocationType = 'binder', parentId?: number, position = 0) {
  return db.insert(locations).values({ name, type, parentId, position }).returning().get().id;
}

function card(name: string, options: { basic?: boolean; allowsMany?: boolean } = {}) {
  const oracleId = `oracle-${name}`;
  db.insert(cards)
    .values({
      oracleId,
      name,
      frontFaceName: name,
      typeLine: options.basic ? 'Basic Land — Forest' : 'Creature',
      commanderLegality: 'legal',
      isBasicLand: options.basic ?? false,
      allowsMany: options.allowsMany ?? false,
    })
    .run();
  return oracleId;
}

function printing(oracleId: string, setCode: string, collectorNumber: string) {
  const scryfallId = `${oracleId}-${setCode}-${collectorNumber}`;
  db.insert(printings)
    .values({
      scryfallId,
      oracleId,
      setCode,
      setName: setCode.toUpperCase(),
      collectorNumber,
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      rarity: 'rare',
      releasedAt: '2025-01-01',
    })
    .run();
  return scryfallId;
}

function stack(
  scryfallId: string,
  locationId: number,
  options: { quantity?: number; isProxy?: boolean; finish?: Finish; cameFrom?: number } = {},
) {
  return db
    .insert(copyStacks)
    .values({
      scryfallId,
      locationId,
      quantity: options.quantity ?? 1,
      finish: options.finish ?? 'nonfoil',
      condition: 'near_mint',
      language: 'en',
      isProxy: options.isProxy ?? false,
      cameFromLocationId: options.cameFrom,
    })
    .returning()
    .get().id;
}

function deck(name: string) {
  const deckBoxId = location(`${name} box`, 'deck_box');
  const id = db.insert(decks).values({ name, deckBoxId }).returning().get().id;
  return { id, deckBoxId };
}

function slot(
  deckId: number,
  oracleId: string,
  options: {
    board?: Board;
    quantity?: number;
    hint?: [string, string, boolean?];
    picked?: string;
  } = {},
) {
  return db
    .insert(deckSlots)
    .values({
      deckId,
      oracleId,
      board: options.board ?? 'main',
      quantity: options.quantity ?? 1,
      pickedScryfallId: options.picked,
      hintSetCode: options.hint?.[0],
      hintCollectorNumber: options.hint?.[1],
      hintFoil: options.hint?.[2] ?? false,
    })
    .returning()
    .get().id;
}

function list(deckId: number): PickList {
  const result = pickList(db, deckId);
  if (!result) throw new Error('no pick list');
  return result;
}

const lineOf = (pick: PickList, slotId: number) =>
  pick.groups.flatMap((g) => g.lines).filter((line) => line.slotId === slotId);

describe('pickList', () => {
  it('groups lines by location in location-tree order, with cards to pull in each', () => {
    const shelf = location('Shelf', 'box', undefined, 2);
    const binder = location('Binder', 'binder', undefined, 1);
    const inner = location('Row A', 'tray', shelf, 0);
    const a = card('Alpha');
    const b = card('Beta');
    const c = card('Gamma');
    stack(printing(a, 'aaa', '1'), shelf);
    stack(printing(b, 'bbb', '1'), inner, { quantity: 2 });
    stack(printing(c, 'ccc', '1'), binder);
    const { id } = deck('Test');
    slot(id, a);
    slot(id, b, { quantity: 2 });
    slot(id, c);

    const pick = list(id);
    expect(pick.groups.map((g) => g.location.path)).toEqual(['Binder', 'Shelf', 'Shelf › Row A']);
    expect(pick.groups.map((g) => g.cardCount)).toEqual([1, 1, 2]);
    expect(pick.totals).toEqual({ lines: 3, cards: 4 });
    expect(PickListResponse.shape.pickList.parse(pick)).toEqual(pick);
  });

  it('suggests the hinted printing first, foil when the hint says foil', () => {
    const binder = location('Binder');
    const a = card('Alpha');
    const other = stack(printing(a, 'old', '5'), binder);
    const hintedPrinting = printing(a, 'new', '7');
    const nonfoil = stack(hintedPrinting, binder);
    const foil = stack(hintedPrinting, binder, { finish: 'foil' });
    const { id } = deck('Test');
    const plain = slot(id, a, { hint: ['NEW', '7'] });
    const { id: foilDeck } = deck('Foil');
    const shiny = slot(foilDeck, a, { hint: ['new', '7', true] });

    const [line] = lineOf(list(id), plain);
    expect(line.suggested.stackId).toBe(nonfoil);
    expect(line.alternatives.map((s) => s.stackId)).toEqual([foil, other]);
    expect(lineOf(list(foilDeck), shiny)[0].suggested.stackId).toBe(foil);
  });

  it('prefers the picked printing over the hint', () => {
    const binder = location('Binder');
    const a = card('Alpha');
    stack(printing(a, 'new', '7'), binder);
    const pickedPrinting = printing(a, 'old', '5');
    const picked = stack(pickedPrinting, binder);
    const { id } = deck('Test');
    const s = slot(id, a, { hint: ['new', '7'], picked: pickedPrinting });
    expect(lineOf(list(id), s)[0].suggested.stackId).toBe(picked);
  });

  it('suggests a real copy before a proxy', () => {
    const first = location('First', 'binder', undefined, 0);
    const second = location('Second', 'binder', undefined, 1);
    const a = card('Alpha');
    const p = printing(a, 'aaa', '1');
    const proxy = stack(p, first, { isProxy: true });
    const real = stack(p, second);
    const { id } = deck('Test');
    const s = slot(id, a);
    const [line] = lineOf(list(id), s);
    expect(line.suggested.stackId).toBe(real);
    expect(line.alternatives.map((r) => r.stackId)).toEqual([proxy]);
  });

  it('prefers a location already on the route', () => {
    const first = location('First', 'binder', undefined, 0);
    const second = location('Second', 'binder', undefined, 1);
    const third = location('Third', 'binder', undefined, 2);
    const a = card('Alpha');
    const b = card('Beta');
    // Alpha sits in fewer places, so it is placed first and puts Second on the route.
    stack(printing(a, 'aaa', '1'), second);
    stack(printing(a, 'aaa', '2'), third);
    stack(printing(b, 'bbb', '1'), first);
    const there = stack(printing(b, 'bbb', '2'), second);
    stack(printing(b, 'bbb', '3'), third);
    const { id } = deck('Test');
    const beta = slot(id, b);
    slot(id, a);
    const pick = list(id);
    expect(lineOf(pick, beta)[0].suggested.stackId).toBe(there);
    expect(pick.groups.map((g) => g.location.name)).toEqual(['Second']);
  });

  it('a slot whose copies all sit in one location is placed before earlier slots', () => {
    const first = location('First', 'binder', undefined, 0);
    const second = location('Second', 'binder', undefined, 1);
    const a = card('Alpha');
    const b = card('Beta');
    stack(printing(b, 'bbb', '1'), first);
    const inSecond = stack(printing(b, 'bbb', '2'), second);
    stack(printing(a, 'aaa', '1'), second);
    stack(printing(a, 'aaa', '2'), second);
    const { id } = deck('Test');
    const beta = slot(id, b);
    slot(id, a);
    const pick = list(id);
    expect(lineOf(pick, beta)[0].suggested.stackId).toBe(inSecond);
    expect(pick.groups.map((g) => g.location.name)).toEqual(['Second']);
  });

  it('drops filled slots and counts copies already in the box, any printing', () => {
    const binder = location('Binder');
    const a = card('Alpha');
    const b = card('Beta');
    stack(printing(a, 'aaa', '1'), binder);
    stack(printing(b, 'bbb', '1'), binder, { quantity: 3 });
    const { id, deckBoxId } = deck('Test');
    slot(id, a);
    const beta = slot(id, b, { quantity: 3 });
    stack(printing(a, 'aaa', '2'), deckBoxId, { cameFrom: binder, isProxy: true });
    stack(printing(b, 'bbb', '2'), deckBoxId, { cameFrom: binder });

    const pick = list(id);
    expect(pick.groups.flatMap((g) => g.lines).map((l) => [l.slotId, l.quantity])).toEqual([
      [beta, 2],
    ]);
  });

  it('ignores the maybe board', () => {
    const binder = location('Binder');
    const a = card('Alpha');
    stack(printing(a, 'aaa', '1'), binder);
    const { id } = deck('Test');
    slot(id, a, { board: 'maybe' });
    expect(list(id)).toEqual({
      groups: [],
      otherDecks: [],
      missing: [],
      basics: [],
      totals: { lines: 0, cards: 0 },
    });
  });

  it('lists basic lands at the end as counts to add', () => {
    const forest = card('Forest', { basic: true });
    const island = card('Island', { basic: true });
    printing(forest, 'fdn', '1');
    const { id } = deck('Test');
    slot(id, island, { quantity: 9 });
    slot(id, forest, { quantity: 12 });
    slot(id, forest, { board: 'commander', quantity: 1 });
    const pick = list(id);
    expect(pick.basics.map((b) => [b.card.name, b.quantity])).toEqual([
      ['Forest', 13],
      ['Island', 9],
    ]);
    expect(pick.groups).toEqual([]);
    expect(pick.totals).toEqual({ lines: 0, cards: 0 });
  });

  it('offers the last copy from another deck’s box when two decks want it', () => {
    const binder = location('Binder');
    const a = card('Alpha');
    const p = printing(a, 'aaa', '1');
    const first = deck('First');
    slot(first.id, a);
    const copy = stack(p, first.deckBoxId, { cameFrom: binder });
    const second = deck('Second');
    const wants = slot(second.id, a);

    const pick = list(second.id);
    expect(pick.groups).toEqual([]);
    expect(pick.missing).toEqual([]);
    expect(pick.otherDecks).toHaveLength(1);
    expect(pick.otherDecks[0]).toMatchObject({
      slotId: wants,
      quantity: 1,
      suggested: { stackId: copy, inDeck: { deckId: first.id, deckName: 'First' } },
      fromDeck: { id: first.id, name: 'First', becomesPartly: true },
    });
    expect(pick.totals).toEqual({ lines: 1, cards: 1 });
  });

  it('says the other deck stays as it is when it isn’t assembled', () => {
    const a = card('Alpha');
    const b = card('Beta');
    const first = deck('First');
    slot(first.id, a);
    slot(first.id, b); // not in the box, so First is partly assembled
    stack(printing(a, 'aaa', '1'), first.deckBoxId);
    const second = deck('Second');
    slot(second.id, a);
    expect(list(second.id).otherDecks[0].fromDeck?.becomesPartly).toBe(false);
  });

  it('uses storage first and only takes the rest from other decks', () => {
    const binder = location('Binder');
    const a = card('Alpha', { allowsMany: true });
    const p = printing(a, 'aaa', '1');
    const free = stack(p, binder, { quantity: 2 });
    const other = deck('Other');
    const boxed = stack(p, other.deckBoxId, { quantity: 5 });
    const { id } = deck('Test');
    const s = slot(id, a, { quantity: 4 });
    const pick = list(id);
    expect(lineOf(pick, s).map((l) => [l.suggested.stackId, l.quantity])).toEqual([[free, 2]]);
    expect(pick.otherDecks.map((l) => [l.suggested.stackId, l.quantity, l.key])).toEqual([
      [boxed, 2, `${s}-2`],
    ]);
  });

  it('asks for the full quantity of a card that allows any number, one line per stack', () => {
    const first = location('First', 'binder', undefined, 0);
    const second = location('Second', 'binder', undefined, 1);
    const rats = card('Relentless Rats', { allowsMany: true });
    const p = printing(rats, 'rat', '1');
    const many = stack(p, first, { quantity: 12 });
    const few = stack(p, second, { quantity: 6 });
    const { id } = deck('Rats');
    const s = slot(id, rats, { quantity: 15 });
    const pick = list(id);
    const lines = lineOf(pick, s);
    expect(lines.map((l) => [l.key, l.suggested.stackId, l.quantity])).toEqual([
      [`${s}-1`, many, 12],
      [`${s}-2`, few, 3],
    ]);
    expect(lines[0].alternatives).toEqual([]);
    expect(pick.totals).toEqual({ lines: 2, cards: 15 });
  });

  it('lists missing copies with the printing hint', () => {
    const binder = location('Binder');
    const a = card('Alpha');
    const b = card('Beta');
    stack(printing(b, 'bbb', '1'), binder);
    const { id } = deck('Test');
    const alpha = slot(id, a, { hint: ['eoc', '126'] });
    const beta = slot(id, b, { quantity: 3 });
    const pick = list(id);
    expect(pick.missing.map((m) => [m.slotId, m.quantity, m.hint])).toEqual([
      [alpha, 1, { setCode: 'eoc', collectorNumber: '126', foil: false }],
      [beta, 2, null],
    ]);
  });

  it('treats the "to sort" inbox as storage and skips deleted locations', () => {
    const gone = location('Gone');
    const a = card('Alpha');
    const p = printing(a, 'aaa', '1');
    stack(p, gone);
    db.update(locations)
      .set({ deletedAt: '2026-10-19T00:00:00Z' })
      .where(eq(locations.id, gone))
      .run();
    const inInbox = stack(p, inboxId());
    const { id } = deck('Test');
    slot(id, a, { quantity: 2 });
    const pick = list(id);
    expect(pick.groups.map((g) => g.location.type)).toEqual(['inbox']);
    expect(pick.groups[0].lines[0].suggested.stackId).toBe(inInbox);
    expect(pick.missing.map((m) => m.quantity)).toEqual([1]);
  });
});

describe('pickList with trade locations', () => {
  function tradeLocation(name: string, parentId?: number) {
    const id = location(name, 'binder', parentId, 0);
    db.update(locations).set({ forTrade: true }).where(eq(locations.id, id)).run();
    return id;
  }

  it('suggests a free copy in storage before a trade copy, even the listed printing', () => {
    const trade = tradeLocation('Trade binder');
    const binder = location('Binder', 'binder', undefined, 1);
    const a = card('Alpha');
    const listed = printing(a, 'eoc', '1');
    const tradeCopy = stack(listed, trade);
    const storageCopy = stack(printing(a, 'fdc', '2'), binder);
    const { id } = deck('Test');
    const s = slot(id, a, { hint: ['eoc', '1'] });
    const [line] = lineOf(list(id), s);
    expect(line.suggested.stackId).toBe(storageCopy);
    expect(line.fromTrade).toBe(false);
    expect(line.alternatives.map((row) => [row.stackId, row.location.forTrade])).toEqual([
      [tradeCopy, true],
    ]);
  });

  it('suggests a copy in another deck’s box before a trade copy', () => {
    const trade = tradeLocation('Trade binder');
    const a = card('Alpha');
    const p = printing(a, 'aaa', '1');
    stack(p, trade);
    const first = deck('First');
    slot(first.id, a);
    const boxed = stack(p, first.deckBoxId);
    const second = deck('Second');
    slot(second.id, a);
    const pick = list(second.id);
    expect(pick.groups).toEqual([]);
    expect(pick.otherDecks.map((line) => [line.suggested.stackId, line.fromTrade])).toEqual([
      [boxed, false],
    ]);
  });

  it('suggests a trade copy, marked fromTrade, when it is the only one free', () => {
    const trade = tradeLocation('Trade binder');
    const inside = location('Trade box', 'box', trade);
    const a = card('Alpha');
    const b = card('Beta');
    const tradeCopy = stack(printing(a, 'aaa', '1'), trade);
    const insideCopy = stack(printing(b, 'bbb', '1'), inside);
    const { id } = deck('Test');
    const alpha = slot(id, a);
    const beta = slot(id, b);
    const pick = list(id);
    expect(lineOf(pick, alpha).map((l) => [l.suggested.stackId, l.fromTrade])).toEqual([
      [tradeCopy, true],
    ]);
    // Inside a location for trade counts as for trade too.
    expect(lineOf(pick, beta).map((l) => [l.suggested.stackId, l.fromTrade])).toEqual([
      [insideCopy, true],
    ]);
    expect(pick.missing).toEqual([]);
  });

  it('takes trade copies only for what storage and other decks can’t fill', () => {
    const binder = location('Binder', 'binder', undefined, 0);
    const trade = tradeLocation('Trade binder');
    const a = card('Alpha', { allowsMany: true });
    const p = printing(a, 'aaa', '1');
    const fromBinder = stack(p, binder, { quantity: 2 });
    const fromTrade = stack(p, trade, { quantity: 5 });
    const { id } = deck('Test');
    const s = slot(id, a, { quantity: 4 });
    expect(lineOf(list(id), s).map((l) => [l.suggested.stackId, l.quantity, l.fromTrade])).toEqual([
      [fromBinder, 2, false],
      [fromTrade, 2, true],
    ]);
  });
});

describe('GET /api/decks/:id/pick-list', () => {
  it('answers the deck with its state and pick list, matching the schema', async () => {
    const binder = location('Binder');
    const a = card('Alpha');
    const b = card('Beta');
    stack(printing(a, 'aaa', '1'), binder);
    const { id, deckBoxId } = deck('Test');
    slot(id, a);
    slot(id, b);
    stack(printing(b, 'bbb', '1'), deckBoxId);

    const res = await client.decks[':id']['pick-list'].$get({ param: { id: String(id) } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(PickListResponse.parse(body)).toEqual(body);
    expect(body.deck).toEqual({ id, name: 'Test', state: 'partly_assembled', deckBoxId });
    expect(body.pickList.totals).toEqual({ lines: 1, cards: 1 });
  });

  it('answers 404 for a deck that doesn’t exist', async () => {
    const res = await app.request('/api/decks/99/pick-list');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('deck_not_found');
  });
});
