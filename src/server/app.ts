import { Hono } from 'hono';
import { errorBody, handleError } from './errors';
import { buyListRoutes } from './routes/buy-list';
import { cardDataRoutes } from './routes/card-data';
import { cardsRoutes } from './routes/cards';
import { copiesRoutes } from './routes/copies';
import { deckChecksRoutes } from './routes/deck-checks';
import { decksRoutes } from './routes/decks';
import { exportsRoutes } from './routes/exports';
import { historyRoutes } from './routes/history';
import { locationsRoutes } from './routes/locations';
import { manaboxRoutes } from './routes/manabox';
import { manaboxUpdateRoutes } from './routes/manabox-update';
import { moxfieldRoutes } from './routes/moxfield';
import { moxfieldUpdateRoutes } from './routes/moxfield-update';
import { pickListRoutes } from './routes/pick-list';
import { pullsRoutes } from './routes/pulls';
import { putAwayRoutes } from './routes/put-away';
import { stacksRoutes } from './routes/stacks';
import { swapRoutes } from './routes/swap';
import { undoRoutes } from './routes/undo';

// The API. Every area's routes live in their own module under ./routes and are all mounted
// at /api here, in one chain, so AppType carries every route for the typed client.
// Area issues edit their own route module, never this list.
export const app = new Hono()
  .get('/api/health', (c) => c.json({ ok: true }))
  .route('/api', cardDataRoutes)
  .route('/api', cardsRoutes)
  .route('/api', locationsRoutes)
  .route('/api', copiesRoutes)
  .route('/api', stacksRoutes)
  .route('/api', undoRoutes)
  .route('/api', historyRoutes)
  .route('/api', manaboxRoutes)
  .route('/api', manaboxUpdateRoutes)
  .route('/api', moxfieldRoutes)
  .route('/api', moxfieldUpdateRoutes)
  .route('/api', decksRoutes)
  .route('/api', deckChecksRoutes)
  .route('/api', buyListRoutes)
  .route('/api', pickListRoutes)
  .route('/api', pullsRoutes)
  .route('/api', putAwayRoutes)
  .route('/api', swapRoutes)
  .route('/api', exportsRoutes);

export type AppType = typeof app;

// Anything else under /api answers in the shared error shape rather than with a page.
app.all('/api/*', (c) =>
  c.json(errorBody('not_found', `There is nothing at ${c.req.method} ${c.req.path}.`), 404),
);
app.onError(handleError);
