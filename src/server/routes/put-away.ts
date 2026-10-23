import { Hono } from 'hono';
import { z } from 'zod';
import { IdParam } from '../../shared/api/common';
import { ReturnRequest } from '../../shared/api/put-away';
import { getDb } from '../db/database';
import { AppError } from '../errors';
import { putAwayList } from '../queries/put-away';
import { returnCopies } from '../services/put-away';
import { validate } from '../validate';

const DeckParam = z.object({ id: IdParam });

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const putAwayRoutes = new Hono()
  .get('/decks/:id/put-away', validate('param', DeckParam), (c) => {
    const db = getDb();
    const list = db.transaction((tx) => putAwayList(tx, c.req.valid('param').id));
    if (!list) {
      throw new AppError(404, 'deck_not_found', 'This deck was deleted or doesn’t exist.');
    }
    return c.json(list);
  })
  .post('/decks/:id/returns', validate('param', DeckParam), validate('json', ReturnRequest), (c) =>
    c.json(returnCopies(getDb(), c.req.valid('param').id, c.req.valid('json'))),
  );
