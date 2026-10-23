import { Hono } from 'hono';
import { z } from 'zod';
import { IdParam } from '../../shared/api/common';
import { getDb } from '../db/database';
import { AppError } from '../errors';
import { swapList } from '../queries/swap-list';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const swapRoutes = new Hono().get(
  '/decks/:id/swap',
  validate('param', z.object({ id: IdParam })),
  (c) => {
    const db = getDb();
    const list = db.transaction((tx) => swapList(tx, c.req.valid('param').id));
    if (!list) {
      throw new AppError(404, 'deck_not_found', 'This deck was deleted or doesn’t exist.');
    }
    return c.json(list);
  },
);
