import { Hono } from 'hono';
import { z } from 'zod';
import { IdParam } from '../../shared/api/common';
import {
  DeckCommanders,
  DeckRename,
  NewDeck,
  SlotChange,
  SlotInput,
  SlotTags,
} from '../../shared/api/decks';
import { getDb } from '../db/database';
import { AppError } from '../errors';
import { deckList, deckSummary, deckView, slotRow } from '../queries/decks';
import {
  addSlot,
  createDeck,
  deleteDeck,
  markOpened,
  moveSlotBoard,
  removeSlot,
  renameDeck,
  setCommanders,
  setSlotPrinting,
  setSlotQuantity,
  setSlotTags,
} from '../services/decks';
import { validate } from '../validate';

const deckParam = validate('param', z.object({ id: IdParam }));
const slotParam = validate('param', z.object({ id: IdParam, slotId: IdParam }));

function found<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new AppError(404, 'deck_not_found', 'This deck was deleted or doesn’t exist.');
  }
  return value;
}

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const decksRoutes = new Hono()
  .get('/decks', (c) => c.json({ decks: deckList(getDb()) }))
  .post('/decks', validate('json', NewDeck), (c) => {
    const { name, commanders } = c.req.valid('json');
    const db = getDb();
    const id = createDeck(db, {
      name,
      slots: commanders.map((oracleId) => ({ oracleId, board: 'commander', quantity: 1 })),
    });
    return c.json(found(deckSummary(db, id)), 201);
  })
  .get('/decks/:id', deckParam, (c) => {
    const { id } = c.req.valid('param');
    const db = getDb();
    markOpened(db, id);
    return c.json(found(deckView(db, id)));
  })
  .patch('/decks/:id', deckParam, validate('json', DeckRename), (c) => {
    const { id } = c.req.valid('param');
    const db = getDb();
    renameDeck(db, id, c.req.valid('json').name);
    return c.json(found(deckSummary(db, id)));
  })
  .put('/decks/:id/commanders', deckParam, validate('json', DeckCommanders), (c) => {
    const { id } = c.req.valid('param');
    const db = getDb();
    setCommanders(db, id, c.req.valid('json').oracleIds);
    return c.json(found(deckView(db, id)));
  })
  .post('/decks/:id/slots', deckParam, validate('json', SlotInput), (c) => {
    const { id } = c.req.valid('param');
    const db = getDb();
    const slotId = addSlot(db, id, c.req.valid('json'));
    return c.json(found(slotRow(db, id, slotId)));
  })
  .patch('/decks/:id/slots/:slotId', slotParam, validate('json', SlotChange), (c) => {
    const { id, slotId } = c.req.valid('param');
    const { quantity, board, printing } = c.req.valid('json');
    const db = getDb();
    const endId = db.transaction((tx) => {
      if (quantity !== undefined) setSlotQuantity(tx, id, slotId, quantity);
      const movedId = board !== undefined ? moveSlotBoard(tx, id, slotId, board) : slotId;
      if (printing !== undefined) setSlotPrinting(tx, id, movedId, printing);
      return movedId;
    });
    return c.json(found(slotRow(db, id, endId)));
  })
  .put('/decks/:id/slots/:slotId/tags', slotParam, validate('json', SlotTags), (c) => {
    const { id, slotId } = c.req.valid('param');
    const db = getDb();
    setSlotTags(db, id, slotId, c.req.valid('json').tags);
    return c.json(found(slotRow(db, id, slotId)));
  })
  .delete('/decks/:id/slots/:slotId', slotParam, (c) => {
    const { id, slotId } = c.req.valid('param');
    removeSlot(getDb(), id, slotId);
    return c.body(null, 204);
  })
  .delete('/decks/:id', deckParam, (c) => {
    deleteDeck(getDb(), c.req.valid('param').id);
    return c.body(null, 204);
  });
