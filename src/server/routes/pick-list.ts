import { Hono } from 'hono';
import { z } from 'zod';
import { IdParam } from '../../shared/api/common';
import type { PickListResponse } from '../../shared/api/pick-list';
import { getDb } from '../db/database';
import { AppError } from '../errors';
import { assemblyDeck, pickList } from '../queries/pick-list';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const pickListRoutes = new Hono().get(
  '/decks/:id/pick-list',
  validate('param', z.object({ id: IdParam })),
  (c) => {
    const { id } = c.req.valid('param');
    const db = getDb();
    const answer = db.transaction((tx): PickListResponse | undefined => {
      const deck = assemblyDeck(tx, id);
      const list = pickList(tx, id);
      return deck && list ? { deck, pickList: list } : undefined;
    });
    if (!answer)
      throw new AppError(404, 'deck_not_found', 'This deck was deleted or doesn’t exist.');
    return c.json(answer);
  },
);
