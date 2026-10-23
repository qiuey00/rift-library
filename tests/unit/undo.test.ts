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
import { AppError } from '../../src/server/errors';
import { addCopies, createBatch, moveCopies, removeCopies } from '../../src/server/services/copies';
import { undoBatch, undoMovement } from '../../src/server/services/undo';
import { ActionResult, ErrorBody } from '../../src/shared/api/common';

const client = hc<AppType>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;
let binder: number;
let box: number;
let deckBox: number;
let deck: number;

const SIGNET = 'printing-arcane-signet';
const SIGNET_FOIL_ART = 'printing-arcane-signet-2';
const SOL_RING = 'printing-sol-ring';

function location(name: string, type: typeof locations.$inferInsert.type) {
  return db.insert(locations).values({ name, type }).returning({ id: locations.id }).get().id;
}

function card(scryfallId: string, name: string, oracleId = `oracle-${scryfallId}`) {
  db.insert(cards)
    .values({
      oracleId,
      name,
      frontFaceName: name,
      typeLine: 'Artifact',
      commanderLegality: 'legal',
    })
    .onConflictDoNothing()
    .run();
  db.insert(printings)
    .values({
      scryfallId,
      oracleId,
      setCode: 'cmm',
      setName: 'Commander Masters',
      collectorNumber: '1',
      lang: 'en',
      finishes: ['nonfoil', 'foil'],
      rarity: 'uncommon',
      releasedAt: '2023-08-04',
    })
    .run();
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
const where = () => stacks().map((s) => [s.locationId, s.quantity, s.cameFromLocationId]);

function move(stackId: number, quantity: number, to: number, kind: 'move' | 'pick_list' = 'move') {
  const batchId = createBatch(db, kind);
  return { batchId, ...moveCopies(db, stackId, quantity, to, { reason: 'moved', batchId }) };
}

function expectCannotUndo(fn: () => unknown, message: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('cannot_undo');
    expect((err as AppError).message).toBe(message);
    return;
  }
  throw new Error('expected cannot_undo');
}

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  binder = location('Rares binder', 'binder');
  box = location('Long box', 'box');
  deckBox = location('Hearthhull deck box', 'deck_box');
  deck = db
    .insert(decks)
    .values({ name: 'Hearthhull', deckBoxId: deckBox })
    .returning({ id: decks.id })
    .get().id;
  card(SIGNET, 'Arcane Signet');
  card(SIGNET_FOIL_ART, 'Arcane Signet', `oracle-${SIGNET}`);
  card(SOL_RING, 'Sol Ring');
});
afterEach(() => db.$client.close());

describe('undoMovement', () => {
  it('moves copies back with a reverse movement in an undo batch', () => {
    const { movementId } = move(stack(), 1, box);
    const result = undoMovement(db, movementId);
    expect(result).toEqual({ message: 'Undid: moved Arcane Signet to Long box', batchId: null });
    expect(where()).toEqual([[binder, 1, null]]);

    const [original, reverse] = allMovements();
    expect(original.undoneAt).not.toBeNull();
    expect(reverse).toMatchObject({
      reason: 'undo',
      undoesMovementId: original.id,
      fromLocationId: box,
      toLocationId: binder,
      quantity: 1,
      undoneAt: null,
    });
    const batch = db
      .select()
      .from(movementBatches)
      .where(eq(movementBatches.id, reverse.batchId))
      .get();
    expect(batch?.kind).toBe('undo');
  });

  it('merges a partial move back into its stack', () => {
    const source = stack({ quantity: 4 });
    const { movementId } = move(source, 3, box);
    expect(where()).toEqual([
      [binder, 1, null],
      [box, 3, null],
    ]);
    expect(undoMovement(db, movementId).message).toBe('Undid: moved 3 Arcane Signet to Long box');
    expect(where()).toEqual([[binder, 4, null]]);
  });

  it('removes an added copy', () => {
    const batchId = createBatch(db, 'add');
    const { movementId } = addCopies(db, {
      scryfallId: SIGNET,
      quantity: 2,
      locationId: binder,
      finish: 'foil',
      condition: 'near_mint',
      language: 'en',
      misprint: false,
      altered: false,
      isProxy: false,
      reason: 'added',
      batchId,
    });
    expect(undoMovement(db, movementId).message).toBe(
      'Undid: added 2 Arcane Signet to Rares binder',
    );
    expect(stacks()).toEqual([]);
    expect(allMovements()[1]).toMatchObject({
      reason: 'undo',
      fromLocationId: binder,
      toLocationId: null,
      undoesMovementId: movementId,
    });
  });

  it('recreates a removed stack with its details, came-from and price', () => {
    const source = stack({
      locationId: deckBox,
      cameFromLocationId: box,
      finish: 'etched',
      condition: 'lightly_played',
      language: 'ja',
      misprint: true,
      altered: true,
      isProxy: true,
      purchasePrice: 2.5,
      purchaseCurrency: 'USD',
    });
    const before = stacks()[0];
    const { movementId } = removeCopies(db, source, 1, {
      reason: 'moved',
      batchId: createBatch(db, 'move'),
    });
    expect(stacks()).toEqual([]);
    expect(undoMovement(db, movementId).message).toBe(
      'Undid: removed Arcane Signet from Hearthhull deck box',
    );
    const [after] = stacks();
    const { id: _a, createdAt: _b, updatedAt: _c, ...rest } = before;
    expect(after).toMatchObject(rest);
    expect(allMovements()[1]).toMatchObject({
      reason: 'undo',
      fromLocationId: null,
      toLocationId: deckBox,
      cameFromAfter: box,
    });
  });

  it('undoes a pull: copy back in storage, came-from cleared, picked printing restored', () => {
    const slot = db
      .insert(deckSlots)
      .values({ deckId: deck, oracleId: `oracle-${SIGNET}`, board: 'main', quantity: 1 })
      .returning({ id: deckSlots.id })
      .get().id;
    const source = stack({ locationId: box });
    const batchId = createBatch(db, 'pick_list', { deckId: deck });
    const { movementId } = moveCopies(db, source, 1, deckBox, {
      reason: 'assembled',
      batchId,
      deckId: deck,
      slotId: slot,
      pickedBefore: null,
    });
    db.update(deckSlots).set({ pickedScryfallId: SIGNET }).where(eq(deckSlots.id, slot)).run();
    expect(where()).toEqual([[deckBox, 1, box]]);

    expect(undoMovement(db, movementId).message).toBe(
      'Undid: pulled Arcane Signet into Hearthhull deck box',
    );
    expect(where()).toEqual([[box, 1, null]]);
    const slotRow = db.select().from(deckSlots).where(eq(deckSlots.id, slot)).get();
    expect(slotRow?.pickedScryfallId).toBeNull();
    expect(allMovements()[1]).toMatchObject({ slotId: slot, deckId: deck, reason: 'undo' });
  });

  it('restores an earlier picked printing and came-from exactly', () => {
    const slot = db
      .insert(deckSlots)
      .values({
        deckId: deck,
        oracleId: `oracle-${SIGNET}`,
        board: 'main',
        quantity: 1,
        pickedScryfallId: SIGNET,
      })
      .returning({ id: deckSlots.id })
      .get().id;
    // A borrowed copy in another deck box keeps its came-from; moving it back must keep it.
    const otherBox = location('Atraxa deck box', 'deck_box');
    const source = stack({
      scryfallId: SIGNET_FOIL_ART,
      locationId: otherBox,
      cameFromLocationId: binder,
    });
    const { movementId } = moveCopies(db, source, 1, deckBox, {
      reason: 'swapped_in',
      batchId: createBatch(db, 'swap'),
      slotId: slot,
      pickedBefore: SIGNET,
    });
    db.update(deckSlots)
      .set({ pickedScryfallId: SIGNET_FOIL_ART })
      .where(eq(deckSlots.id, slot))
      .run();
    undoMovement(db, movementId);
    expect(where()).toEqual([[otherBox, 1, binder]]);
    expect(db.select().from(deckSlots).get()?.pickedScryfallId).toBe(SIGNET);
  });

  it('refuses when the copies moved since, and changes nothing', () => {
    const { movementId, destStackId } = move(stack(), 1, box);
    move(destStackId, 1, deckBox);
    const before = { stacks: stacks(), movements: allMovements() };
    expectCannotUndo(
      () => undoMovement(db, movementId),
      'Arcane Signet has moved since. It is now in Hearthhull deck box.',
    );
    expect({ stacks: stacks(), movements: allMovements() }).toEqual(before);
  });

  it('refuses when the copies left the collection', () => {
    const { movementId, destStackId } = move(stack(), 1, box);
    removeCopies(db, destStackId, 1, { reason: 'moved', batchId: createBatch(db, 'move') });
    expectCannotUndo(
      () => undoMovement(db, movementId),
      'Arcane Signet has moved since. It is no longer in your collection.',
    );
  });

  it('refuses when the from location was deleted', () => {
    const { movementId } = move(stack(), 1, box);
    db.update(locations).set({ deletedAt: '2026-10-19' }).where(eq(locations.id, binder)).run();
    expectCannotUndo(
      () => undoMovement(db, movementId),
      'Arcane Signet can’t go back, because Rares binder no longer exists.',
    );
    expect(where()).toEqual([[box, 1, null]]);
  });

  it('refuses a movement already undone', () => {
    const { movementId } = move(stack(), 1, box);
    undoMovement(db, movementId);
    expectCannotUndo(() => undoMovement(db, movementId), 'This change was already undone');
  });

  it('refuses to undo an undo row with 400', () => {
    const { movementId } = move(stack(), 1, box);
    undoMovement(db, movementId);
    const undoRow = allMovements()[1];
    expect(() => undoMovement(db, undoRow.id)).toThrow(
      expect.objectContaining({ status: 400, code: 'cannot_undo' }),
    );
  });
});

describe('undoBatch', () => {
  it('undoes a batch newest first, so chained moves unwind', () => {
    const batchId = createBatch(db, 'pick_list', { deckId: deck });
    const first = moveCopies(db, stack(), 1, box, { reason: 'moved', batchId });
    moveCopies(db, first.destStackId, 1, deckBox, { reason: 'assembled', batchId, deckId: deck });
    moveCopies(db, stack({ scryfallId: SOL_RING }), 1, deckBox, {
      reason: 'assembled',
      batchId,
      deckId: deck,
    });

    const result = undoBatch(db, batchId);
    expect(result).toEqual({ message: 'Undid: pick list · Hearthhull · 3 cards', batchId: null });
    expect(where()).toEqual([
      [binder, 1, null],
      [binder, 1, null],
    ]);
    const reverses = allMovements().slice(3);
    expect(reverses.map((m) => m.undoesMovementId)).toEqual([3, 2, 1]);
    expect(new Set(reverses.map((m) => m.batchId)).size).toBe(1);
  });

  it('skips movements already undone', () => {
    const batchId = createBatch(db, 'move');
    const a = moveCopies(db, stack(), 1, box, { reason: 'moved', batchId });
    moveCopies(db, stack({ scryfallId: SOL_RING }), 1, box, { reason: 'moved', batchId });
    undoMovement(db, a.movementId);
    expect(undoBatch(db, batchId).message).toBe('Undid: moved Sol Ring to Long box');
    expect(allMovements().filter((m) => m.reason === 'undo')).toHaveLength(2);
    expectCannotUndo(() => undoBatch(db, batchId), 'This change was already undone');
  });

  it('changes nothing when any movement in the batch moved since', () => {
    const batchId = createBatch(db, 'move');
    moveCopies(db, stack(), 1, box, { reason: 'moved', batchId });
    const ring = moveCopies(db, stack({ scryfallId: SOL_RING }), 1, box, {
      reason: 'moved',
      batchId,
    });
    move(ring.destStackId, 1, deckBox);
    const before = { stacks: stacks(), movements: allMovements() };
    expectCannotUndo(
      () => undoBatch(db, batchId),
      'Sol Ring has moved since. It is now in Hearthhull deck box.',
    );
    expect({ stacks: stacks(), movements: allMovements() }).toEqual(before);
  });

  it('refuses an undo batch with 400', () => {
    const { movementId } = move(stack(), 1, box);
    undoMovement(db, movementId);
    const undoBatchId = allMovements()[1].batchId;
    expect(() => undoBatch(db, undoBatchId)).toThrow(
      expect.objectContaining({ status: 400, code: 'cannot_undo' }),
    );
  });
});

describe('undo routes', () => {
  it('POST /movements/:id/undo answers an ActionResult', async () => {
    const { movementId } = move(stack(), 1, box);
    const res = await client.movements[':id'].undo.$post({ param: { id: String(movementId) } });
    expect(res.status).toBe(200);
    expect(ActionResult.parse(await res.json())).toEqual({
      message: 'Undid: moved Arcane Signet to Long box',
      batchId: null,
    });
  });

  it('POST /batches/:id/undo answers 409 cannot_undo when copies moved since', async () => {
    const { batchId, destStackId } = move(stack(), 1, box);
    move(destStackId, 1, deckBox);
    const res = await client.batches[':id'].undo.$post({ param: { id: String(batchId) } });
    expect(res.status).toBe(409);
    expect(ErrorBody.parse(await res.json()).error).toEqual({
      code: 'cannot_undo',
      message: 'Arcane Signet has moved since. It is now in Hearthhull deck box.',
    });
  });

  it('answers 404 for an unknown movement or batch', async () => {
    const m = await client.movements[':id'].undo.$post({ param: { id: '999' } });
    const b = await client.batches[':id'].undo.$post({ param: { id: '999' } });
    expect([m.status, b.status]).toEqual([404, 404]);
  });
});
