import { asc, eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import {
  copyStacks,
  decks,
  locations,
  movementBatches,
  movements,
} from '../../src/server/db/schema';
import { createTestDb, insertCard, insertPrinting } from '../../src/server/db/test-db';
import {
  addCopies,
  createBatch,
  moveCopies,
  removeCopies,
  StaleCopyError,
  setProxy,
} from '../../src/server/services/copies';
import { ActionResult, ErrorBody } from '../../src/shared/api/common';
import { HistoryDay } from '../../src/shared/api/history';

const client = hc<AppType>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;
let inbox: number;
let binder: number;
let box: number;
let row: number;
let deckBox: number;
let otherDeckBox: number;
let batch: number;

const SIGNET = 'printing-arcane-signet';
const SOL_RING = 'printing-sol-ring';

function location(name: string, type: typeof locations.$inferInsert.type, parentId?: number) {
  return db.insert(locations).values({ name, type, parentId }).returning({ id: locations.id }).get()
    .id;
}

function card(printingId: string, name: string) {
  const cardId = insertCard(db, { name });
  insertPrinting(db, { riftcodexId: printingId, cardId });
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
const getStack = (id: number) => db.select().from(copyStacks).where(eq(copyStacks.id, id)).get();
const allMovements = () => db.select().from(movements).orderBy(asc(movements.id)).all();
const moved = { reason: 'moved' as const };

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  inbox = db.select().from(locations).get()?.id ?? 0;
  binder = location('Rares binder', 'binder');
  box = location('Long box', 'box');
  row = location('Lands', 'box', box);
  deckBox = location('Jinx Burn deck box', 'deck_box');
  otherDeckBox = location('Lux Control deck box', 'deck_box');
  db.insert(decks).values({ name: 'Jinx Burn', deckBoxId: deckBox }).run();
  card(SIGNET, 'Ember Signet');
  card(SOL_RING, 'Sun Disc');
  batch = createBatch(db, 'move');
});
afterEach(() => db.$client.close());

describe('moveCopies', () => {
  it('splits a stack when only part moves', () => {
    const source = stack({ quantity: 3 });
    const { destStackId } = moveCopies(db, source, 1, box, { ...moved, batchId: batch });
    expect(getStack(source)?.quantity).toBe(2);
    expect(getStack(destStackId)).toMatchObject({ quantity: 1, locationId: box });
  });

  it('deletes the source row when the whole stack moves', () => {
    const source = stack({ quantity: 2 });
    const { destStackId } = moveCopies(db, source, 2, box, { ...moved, batchId: batch });
    expect(getStack(source)).toBeUndefined();
    expect(stacks()).toEqual([expect.objectContaining({ id: destStackId, quantity: 2 })]);
  });

  it('merges back into the alike stack when moved back', () => {
    const source = stack({ quantity: 3 });
    const { destStackId } = moveCopies(db, source, 1, box, { ...moved, batchId: batch });
    const back = moveCopies(db, destStackId, 1, binder, { ...moved, batchId: batch });
    expect(back.destStackId).toBe(source);
    expect(stacks()).toEqual([expect.objectContaining({ id: source, quantity: 3 })]);
  });

  it('merges stacks with no came-from location', () => {
    const there = stack({ locationId: box, quantity: 2 });
    const source = stack({ quantity: 1 });
    const { destStackId } = moveCopies(db, source, 1, box, { ...moved, batchId: batch });
    expect(destStackId).toBe(there);
    expect(stacks()).toEqual([expect.objectContaining({ id: there, quantity: 3 })]);
  });

  it('keeps stacks apart when any detail differs', () => {
    stack({ locationId: box, finish: 'foil' });
    const source = stack();
    moveCopies(db, source, 1, box, { ...moved, batchId: batch });
    expect(stacks()).toHaveLength(2);
  });

  it('keeps the destination purchase price, or takes the moving one', () => {
    const priced = stack({ locationId: box, purchasePrice: 2, purchaseCurrency: 'USD' });
    moveCopies(db, stack({ purchasePrice: 5, purchaseCurrency: 'EUR' }), 1, box, {
      ...moved,
      batchId: batch,
    });
    expect(getStack(priced)).toMatchObject({ purchasePrice: 2, purchaseCurrency: 'USD' });

    const unpriced = stack({ locationId: row });
    moveCopies(db, stack({ purchasePrice: 5, purchaseCurrency: 'EUR' }), 1, row, {
      ...moved,
      batchId: batch,
    });
    expect(getStack(unpriced)).toMatchObject({ purchasePrice: 5, purchaseCurrency: 'EUR' });
  });

  it('sets came-from into a deck box, keeps it deck box to deck box, clears it elsewhere', () => {
    const intoBox = moveCopies(db, stack(), 1, deckBox, { ...moved, batchId: batch });
    expect(getStack(intoBox.destStackId)?.cameFromLocationId).toBe(binder);

    const borrowed = moveCopies(db, intoBox.destStackId, 1, otherDeckBox, {
      ...moved,
      batchId: batch,
    });
    expect(getStack(borrowed.destStackId)?.cameFromLocationId).toBe(binder);

    const out = moveCopies(db, borrowed.destStackId, 1, box, { ...moved, batchId: batch });
    expect(getStack(out.destStackId)?.cameFromLocationId).toBeNull();
  });

  it('keeps copies with different came-from locations in separate stacks in a deck box', () => {
    moveCopies(db, stack(), 1, deckBox, { ...moved, batchId: batch });
    moveCopies(db, stack({ locationId: box }), 1, deckBox, { ...moved, batchId: batch });
    expect(stacks().map((s) => s.cameFromLocationId)).toEqual([binder, box]);
  });

  it('throws StaleCopyError and changes nothing when the stack holds too few', () => {
    const source = stack({ quantity: 1 });
    const before = stacks();
    expect(() => moveCopies(db, source, 2, box, { ...moved, batchId: batch })).toThrow(
      StaleCopyError,
    );
    expect(() => moveCopies(db, 999, 1, box, { ...moved, batchId: batch })).toThrow(
      'This copy has moved, pick another',
    );
    expect(stacks()).toEqual(before);
    expect(allMovements()).toEqual([]);
  });

  it('writes one movement with a full snapshot', () => {
    const source = stack({
      quantity: 2,
      finish: 'foil',
      condition: 'lightly_played',
      language: 'ja',
      misprint: true,
      altered: true,
      isProxy: true,
      purchasePrice: 1.5,
      purchaseCurrency: 'USD',
    });
    const result = moveCopies(db, source, 1, deckBox, {
      ...moved,
      batchId: batch,
      deckId: 1,
      slotId: 7,
      pickedBefore: 'printing-old',
    });
    expect(allMovements()).toEqual([
      expect.objectContaining({
        id: result.movementId,
        batchId: batch,
        copyStackId: result.destStackId,
        printingId: SIGNET,
        finish: 'foil',
        condition: 'lightly_played',
        language: 'ja',
        misprint: true,
        altered: true,
        isProxy: true,
        purchasePrice: 1.5,
        purchaseCurrency: 'USD',
        quantity: 1,
        fromLocationId: binder,
        toLocationId: deckBox,
        cameFromBefore: null,
        cameFromAfter: binder,
        reason: 'moved',
        deckId: 1,
        slotId: 7,
        pickedBefore: 'printing-old',
      }),
    ]);
  });
});

describe('addCopies, removeCopies and setProxy', () => {
  const details = {
    finish: 'normal' as const,
    condition: 'near_mint',
    language: 'en',
    misprint: false,
    altered: false,
    isProxy: false,
  };

  it('addCopies merges into the alike stack and writes a movement with no from', () => {
    const there = stack({ quantity: 2 });
    const result = addCopies(db, {
      printingId: SIGNET,
      quantity: 3,
      ...details,
      locationId: binder,
      reason: 'added',
      batchId: batch,
    });
    expect(result.destStackId).toBe(there);
    expect(getStack(there)?.quantity).toBe(5);
    expect(allMovements()).toEqual([
      expect.objectContaining({ fromLocationId: null, toLocationId: binder, quantity: 3 }),
    ]);
  });

  it('addCopies into a deck box leaves came-from empty', () => {
    const result = addCopies(db, {
      printingId: SIGNET,
      quantity: 1,
      ...details,
      isProxy: true,
      locationId: deckBox,
      reason: 'added',
      batchId: batch,
    });
    expect(getStack(result.destStackId)?.cameFromLocationId).toBeNull();
  });

  it('removeCopies takes copies out with a movement with no to', () => {
    const source = stack({ quantity: 2 });
    removeCopies(db, source, 2, { reason: 'location_update', batchId: batch });
    expect(stacks()).toEqual([]);
    expect(allMovements()).toEqual([
      expect.objectContaining({ fromLocationId: binder, toLocationId: null, quantity: 2 }),
    ]);
  });

  it('setProxy flips the flag and merges into an alike stack, with no movement', () => {
    const proxies = stack({ quantity: 2, isProxy: true });
    const real = stack({ quantity: 1 });
    const other = stack({ quantity: 1, locationId: box });
    expect(setProxy(db, [real, other], true)).toBe(2);
    expect(getStack(real)).toBeUndefined();
    expect(getStack(proxies)?.quantity).toBe(3);
    expect(getStack(other)?.isProxy).toBe(true);
    expect(allMovements()).toEqual([]);
  });

  it('setProxy throws StaleCopyError for a stack that is gone', () => {
    const real = stack();
    expect(() => setProxy(db, [real, 999], true)).toThrow(StaleCopyError);
    expect(getStack(real)?.isProxy).toBe(false);
  });
});

describe('copies routes', () => {
  const json = async (res: Response) => ActionResult.parse(await res.json());

  it('POST /moves moves one card in one batch', async () => {
    const source = stack();
    const res = await client.moves.$post({
      json: { moves: [{ stackId: source, quantity: 1 }], toLocationId: deckBox },
    });
    expect(res.status).toBe(200);
    const result = await json(res);
    expect(result.message).toBe('Moved Ember Signet to Jinx Burn deck box');
    const batchRow = db
      .select()
      .from(movementBatches)
      .where(eq(movementBatches.id, result.batchId ?? 0))
      .get();
    expect(batchRow).toMatchObject({ kind: 'move', deckId: 1 });
    expect(allMovements()).toEqual([
      expect.objectContaining({ batchId: result.batchId, reason: 'moved', deckId: 1 }),
    ]);
  });

  it('POST /moves counts several cards', async () => {
    const a = stack({ quantity: 4 });
    const b = stack({ printingId: SOL_RING, quantity: 8 });
    const result = await json(
      await client.moves.$post({
        json: {
          moves: [
            { stackId: a, quantity: 4 },
            { stackId: b, quantity: 8 },
          ],
          toLocationId: box,
        },
      }),
    );
    expect(result.message).toBe('Moved 12 cards to Long box');
    expect(allMovements()).toHaveLength(2);
  });

  it('POST /moves answers 409 stale_copy and moves nothing', async () => {
    const a = stack({ quantity: 2 });
    const b = stack({ printingId: SOL_RING, quantity: 1 });
    const res = await client.moves.$post({
      json: {
        moves: [
          { stackId: a, quantity: 2 },
          { stackId: b, quantity: 3 },
        ],
        toLocationId: box,
      },
    });
    expect(res.status).toBe(409);
    expect(ErrorBody.parse(await res.json()).error).toEqual({
      code: 'stale_copy',
      message: 'This copy has moved, pick another',
    });
    expect(stacks().map((s) => s.locationId)).toEqual([binder, binder]);
    expect(allMovements()).toEqual([]);
  });

  it('POST /moves answers 404 for a deleted location', async () => {
    db.update(locations)
      .set({ deletedAt: '2026-10-19T00:00:00.000Z' })
      .where(eq(locations.id, box))
      .run();
    const res = await client.moves.$post({
      json: { moves: [{ stackId: stack(), quantity: 1 }], toLocationId: box },
    });
    expect(res.status).toBe(404);
  });

  it('POST /locations/:id/move-contents moves only the location without children', async () => {
    stack({ locationId: box, quantity: 2 });
    const inRow = stack({ locationId: row, quantity: 5 });
    const result = await json(
      await client.locations[':id']['move-contents'].$post({
        param: { id: String(box) },
        json: { toLocationId: inbox, includeChildren: false },
      }),
    );
    expect(result.message).toBe('Moved 2 Ember Signet from Long box to To sort');
    expect(getStack(inRow)?.locationId).toBe(row);
    expect(stacks().filter((s) => s.locationId === inbox)).toHaveLength(1);
  });

  it('POST /locations/:id/move-contents moves children too in one batch', async () => {
    stack({ locationId: box, quantity: 2 });
    stack({ locationId: row, printingId: SOL_RING, quantity: 5 });
    const result = await json(
      await client.locations[':id']['move-contents'].$post({
        param: { id: String(box) },
        json: { toLocationId: inbox, includeChildren: true },
      }),
    );
    expect(result.message).toBe('Moved 7 cards from Long box to To sort');
    expect(stacks().every((s) => s.locationId === inbox)).toBe(true);
    expect(new Set(allMovements().map((m) => m.batchId))).toEqual(new Set([result.batchId]));
  });

  it('POST /locations/:id/move-contents answers 400 for an empty location', async () => {
    const res = await client.locations[':id']['move-contents'].$post({
      param: { id: String(box) },
      json: { toLocationId: inbox, includeChildren: true },
    });
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('nothing_to_move');
  });

  it('POST /stacks/proxy marks stacks with no batch', async () => {
    const a = stack();
    const b = stack({ locationId: box });
    const result = await json(
      await client.stacks.proxy.$post({ json: { stackIds: [a, b], isProxy: true } }),
    );
    expect(result).toEqual({ message: 'Marked 2 stacks as proxies', batchId: null });
    expect(stacks().every((s) => s.isProxy)).toBe(true);
  });

  it('POST /stacks/add adds copies in a batch of kind add', async () => {
    const result = await json(
      await client.stacks.add.$post({
        json: {
          printingId: SIGNET,
          quantity: 1,
          finish: 'normal',
          condition: 'near_mint',
          language: 'en',
          misprint: false,
          altered: false,
          isProxy: false,
          purchasePrice: 0.89,
          purchaseCurrency: 'USD',
          locationId: binder,
        },
      }),
    );
    expect(result.message).toBe('Added 1 Ember Signet to Rares binder');
    expect(db.select().from(movementBatches).all().at(-1)).toMatchObject({ kind: 'add' });
    expect(allMovements()).toEqual([
      expect.objectContaining({ reason: 'added', fromLocationId: null, toLocationId: binder }),
    ]);
    expect(stacks()).toEqual([
      expect.objectContaining({ quantity: 1, purchasePrice: 0.89, purchaseCurrency: 'USD' }),
    ]);
  });

  it('POST /stacks/add answers 404 for an unknown printing', async () => {
    const res = await client.stacks.add.$post({
      json: {
        printingId: 'no-such-printing',
        quantity: 1,
        finish: 'normal',
        condition: 'near_mint',
        language: 'en',
        misprint: false,
        altered: false,
        isProxy: false,
        locationId: binder,
      },
    });
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('printing_not_found');
  });
});

describe('quick add and removing copies (COL-5, COL-13)', () => {
  const json = async (res: Response) => ActionResult.parse(await res.json());
  const FOILLESS = 'printing-wild-shaman';

  const add = (
    overrides: { printingId?: string; finish?: 'normal' | 'foil'; quantity?: number } = {},
  ) =>
    client.stacks.add.$post({
      json: {
        printingId: SIGNET,
        quantity: 1,
        finish: 'normal',
        condition: 'near_mint',
        language: 'en',
        misprint: false,
        altered: false,
        isProxy: false,
        locationId: binder,
        ...overrides,
      },
    });

  const remove = (stackId: number, quantity: number) =>
    client.copies.remove.$post({ json: { stackId, quantity, reason: 'sold' } });

  const undo = (batchId: number) =>
    client.batches[':id'].undo.$post({ param: { id: String(batchId) } });

  beforeEach(() => {
    const cardId = insertCard(db, { name: 'Wild Shaman' });
    insertPrinting(db, { riftcodexId: FOILLESS, cardId, finishes: ['normal'] });
  });

  it('adds into the alike stack, each card in its own add batch', async () => {
    const there = stack({ quantity: 2 });
    const first = await json(await add({ quantity: 3 }));
    const second = await json(await add());
    expect(first.batchId).not.toBe(second.batchId);
    expect(stacks()).toEqual([expect.objectContaining({ id: there, quantity: 6 })]);
    expect(
      db
        .select()
        .from(movementBatches)
        .all()
        .filter((b) => b.kind === 'add')
        .map((b) => b.id),
    ).toEqual([first.batchId, second.batchId]);

    // Undo of one add takes out only those copies.
    await json(await undo(second.batchId ?? 0));
    expect(getStack(there)?.quantity).toBe(5);
  });

  it('refuses a foil of a printing that has no foil', async () => {
    const res = await add({ printingId: FOILLESS, finish: 'foil' });
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error).toEqual({
      code: 'finish_not_available',
      message: 'This printing of Wild Shaman doesn’t come in foil',
    });
    expect(stacks()).toEqual([]);
    expect(allMovements()).toEqual([]);

    expect((await add({ printingId: FOILLESS })).status).toBe(200);
  });

  it('lowers a stack in a remove batch with the reason and no to location', async () => {
    const source = stack({ quantity: 3 });
    const result = await json(await remove(source, 2));
    expect(result.message).toBe('Removed 2 Ember Signet (sold)');
    expect(getStack(source)?.quantity).toBe(1);
    expect(db.select().from(movementBatches).all().at(-1)).toMatchObject({
      id: result.batchId,
      kind: 'remove',
    });
    expect(allMovements()).toEqual([
      expect.objectContaining({
        batchId: result.batchId,
        reason: 'removed',
        removalReason: 'sold',
        fromLocationId: binder,
        toLocationId: null,
        quantity: 2,
      }),
    ]);

    // History answers the reason.
    const res = await client.history.$get({ query: { offset: '0' } });
    const day = HistoryDay.parse(await res.json());
    expect(day.entries).toEqual([
      {
        kind: 'movement',
        movement: expect.objectContaining({ reason: 'removed', removalReason: 'sold', to: null }),
      },
    ]);
  });

  it('removes all of a stack, and undo puts it back with its came-from', async () => {
    const source = stack({ quantity: 2, locationId: row, cameFromLocationId: box });
    const result = await json(await remove(source, 2));
    expect(result.message).toBe('Removed 2 Ember Signet (sold)');
    expect(stacks()).toEqual([]);

    const undone = await json(await undo(result.batchId ?? 0));
    expect(undone.message).toBe('Undid: removed 2 Ember Signet from Lands');
    expect(stacks()).toEqual([
      expect.objectContaining({ quantity: 2, locationId: row, cameFromLocationId: box }),
    ]);
    expect(allMovements().at(-1)).toMatchObject({ reason: 'undo', removalReason: null });
  });

  it('undo of a partial remove merges the copies back into their stack', async () => {
    const source = stack({ quantity: 3 });
    const result = await json(await remove(source, 1));
    await json(await undo(result.batchId ?? 0));
    expect(stacks()).toEqual([expect.objectContaining({ id: source, quantity: 3 })]);
  });

  it('refuses to remove copies in a deck box', async () => {
    const inDeck = stack({ locationId: deckBox, cameFromLocationId: binder });
    const res = await remove(inDeck, 1);
    expect(res.status).toBe(409);
    expect(ErrorBody.parse(await res.json()).error).toEqual({
      code: 'in_deck',
      message: 'These copies are in a deck. Take them out first.',
    });
    expect(getStack(inDeck)?.quantity).toBe(1);
    expect(allMovements()).toEqual([]);
  });

  it('answers 409 stale_copy when the stack no longer holds the copies', async () => {
    const source = stack({ quantity: 1 });
    expect((await remove(source, 2)).status).toBe(409);
    expect((await remove(source + 100, 1)).status).toBe(409);
    expect(getStack(source)?.quantity).toBe(1);
  });
});
