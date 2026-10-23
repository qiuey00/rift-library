import { Hono } from 'hono';
import { getCardDataSync } from '../scryfall/sync';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const cardDataRoutes = new Hono()
  .get('/card-data/status', (c) => c.json(getCardDataSync().status()))
  .post('/card-data/refresh', (c) => c.json(getCardDataSync().refresh()));
