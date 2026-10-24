import { count } from 'drizzle-orm';
import { Hono } from 'hono';
import type { CardDataStatus } from '../../shared/api/card-data';
import { getDb } from '../db/database';
import { cards, printings } from '../db/schema';
import { errorBody } from '../errors';

/** The status with nothing loading: whatever cards the database already holds. */
function status(): CardDataStatus {
  const db = getDb();
  return {
    state: 'ready',
    progress: 1,
    cardsSyncedAt: null,
    pricesUpdatedAt: null,
    cardCount: db.select({ n: count() }).from(cards).get()?.n ?? 0,
    printingCount: db.select({ n: count() }).from(printings).get()?.n ?? 0,
    error: null,
  };
}

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
// STUB until #7: there is no card data source yet, so nothing downloads and refresh refuses.
export const cardDataRoutes = new Hono()
  .get('/card-data/status', (c) => c.json(status()))
  .post('/card-data/refresh', (c) =>
    c.json(
      errorBody(
        'card_data_unavailable',
        'Card data can’t be refreshed yet: loading cards from Riftcodex comes in a later update.',
      ),
      503,
    ),
  );
