import { Hono } from 'hono';
import { HistoryQuery } from '../../shared/api/history';
import { getDb } from '../db/database';
import { historyDay } from '../queries/history';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const historyRoutes = new Hono().get('/history', validate('query', HistoryQuery), (c) =>
  c.json(historyDay(getDb(), c.req.valid('query'))),
);
