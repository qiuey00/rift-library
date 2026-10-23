import { Hono } from 'hono';
import { z } from 'zod';
import { IdParam } from '../../shared/api/common';
import { ProxyRequest, PullRequest } from '../../shared/api/pulls';
import { getDb } from '../db/database';
import { addProxy, pullCopies } from '../services/pulls';
import { validate } from '../validate';

const DeckParam = z.object({ id: IdParam });

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const pullsRoutes = new Hono()
  .post('/decks/:id/pulls', validate('param', DeckParam), validate('json', PullRequest), (c) =>
    c.json(pullCopies(getDb(), c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/decks/:id/proxies', validate('param', DeckParam), validate('json', ProxyRequest), (c) =>
    c.json(addProxy(getDb(), c.req.valid('param').id, c.req.valid('json'))),
  );
