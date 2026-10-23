import { Hono } from 'hono';
import { ManaBoxApplyRequest, ManaBoxPreviewRequest } from '../../shared/api/manabox';
import { getDb } from '../db/database';
import { applyManaBoxAdd, previewManaBoxAdd } from '../services/imports/manabox-add';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const manaboxRoutes = new Hono()
  .post('/imports/manabox/preview', validate('form', ManaBoxPreviewRequest), async (c) =>
    c.json(await previewManaBoxAdd(getDb(), c.req.valid('form').file)),
  )
  .post('/imports/manabox/apply', validate('json', ManaBoxApplyRequest), (c) =>
    c.json(applyManaBoxAdd(getDb(), c.req.valid('json'))),
  );
