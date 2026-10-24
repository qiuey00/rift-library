import { Hono } from 'hono';
import {
  AddCopiesBody,
  MoveContentsBody,
  MoveCopiesBody,
  RemoveCopiesBody,
  SetProxyBody,
} from '../../shared/api/copies';
import { LocationIdParams } from '../../shared/api/locations';
import { removeCopiesResultSample } from '../../shared/api/samples/copies';
import { getDb } from '../db/database';
import { addToCollection, markProxy, moveContents, moveStacks } from '../services/moves';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const copiesRoutes = new Hono()
  .post('/moves', validate('json', MoveCopiesBody), (c) =>
    c.json(moveStacks(getDb(), c.req.valid('json'))),
  )
  .post(
    '/locations/:id/move-contents',
    validate('param', LocationIdParams),
    validate('json', MoveContentsBody),
    (c) => c.json(moveContents(getDb(), c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/stacks/proxy', validate('json', SetProxyBody), (c) => {
    const { stackIds, isProxy } = c.req.valid('json');
    return c.json(markProxy(getDb(), stackIds, isProxy));
  })
  .post('/stacks/add', validate('json', AddCopiesBody), (c) =>
    c.json(addToCollection(getDb(), c.req.valid('json'))),
  )
  // STUB until #10
  .post('/copies/remove', validate('json', RemoveCopiesBody), (c) =>
    c.json(removeCopiesResultSample),
  );
