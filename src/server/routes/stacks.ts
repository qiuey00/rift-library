import { Hono } from 'hono';
import { LocationIdParams } from '../../shared/api/locations';
import { LocationStacksQuery, OracleIdParams, StacksQuery } from '../../shared/api/stacks';
import { parseCollectionQuery } from '../../shared/collection-query';
import { getDb } from '../db/database';
import { cardCopies, locationStacks, searchStacks } from '../queries/stacks';
import { collectionValue } from '../queries/value';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const stacksRoutes = new Hono()
  .get('/stacks', validate('query', StacksQuery), (c) => {
    const { q, sort, cursor, limit } = c.req.valid('query');
    return c.json(searchStacks(getDb(), parseCollectionQuery(q ?? ''), { sort, cursor, limit }));
  })
  .get('/collection/value', (c) => c.json(collectionValue(getDb())))
  .get(
    '/locations/:id/stacks',
    validate('param', LocationIdParams),
    validate('query', LocationStacksQuery),
    (c) =>
      c.json(
        locationStacks(
          getDb(),
          c.req.valid('param').id,
          c.req.valid('query').includeChildren === '1',
        ),
      ),
  )
  .get('/cards/:oracleId/copies', validate('param', OracleIdParams), (c) =>
    c.json(cardCopies(getDb(), c.req.valid('param').oracleId)),
  );
