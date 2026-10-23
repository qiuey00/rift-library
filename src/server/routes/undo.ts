import { Hono } from 'hono';
import { UndoParams } from '../../shared/api/undo';
import { getDb } from '../db/database';
import { undoBatch, undoMovement } from '../services/undo';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const undoRoutes = new Hono()
  .post('/movements/:id/undo', validate('param', UndoParams), (c) =>
    c.json(undoMovement(getDb(), c.req.valid('param').id)),
  )
  .post('/batches/:id/undo', validate('param', UndoParams), (c) =>
    c.json(undoBatch(getDb(), c.req.valid('param').id)),
  );
