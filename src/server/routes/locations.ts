import { Hono } from 'hono';
import {
  CreateLocationBody,
  LocationIdParams,
  type LocationTree,
  UpdateLocationBody,
} from '../../shared/api/locations';
import { getDb } from '../db/database';
import { locationTree } from '../queries/location-tree';
import {
  createLocation,
  deleteLocation,
  LocationNotEmpty,
  updateLocation,
} from '../services/locations';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const locationsRoutes = new Hono()
  .get('/locations/tree', (c) => c.json({ nodes: locationTree(getDb()) } satisfies LocationTree))
  .post('/locations', validate('json', CreateLocationBody), (c) =>
    c.json(createLocation(getDb(), c.req.valid('json'))),
  )
  .patch(
    '/locations/:id',
    validate('param', LocationIdParams),
    validate('json', UpdateLocationBody),
    (c) => c.json(updateLocation(getDb(), c.req.valid('param').id, c.req.valid('json'))),
  )
  .delete('/locations/:id', validate('param', LocationIdParams), (c) => {
    try {
      deleteLocation(getDb(), c.req.valid('param').id);
    } catch (err) {
      // The shared error handler only sends code and message; this one also carries the count.
      if (err instanceof LocationNotEmpty) return c.json(err.body(), 409);
      throw err;
    }
    return c.body(null, 204);
  });
