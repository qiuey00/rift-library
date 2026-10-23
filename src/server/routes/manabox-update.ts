import { Hono } from 'hono';
import {
  ManaBoxUpdateApplyRequest,
  ManaBoxUpdatePreviewRequest,
} from '../../shared/api/manabox-update';
import { getDb } from '../db/database';
import { applyManaBoxUpdate, previewManaBoxUpdate } from '../services/imports/manabox-update';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const manaboxUpdateRoutes = new Hono()
  .post(
    '/imports/manabox/update-preview',
    validate('form', ManaBoxUpdatePreviewRequest),
    async (c) => {
      const { file, locationId } = c.req.valid('form');
      return c.json(await previewManaBoxUpdate(getDb(), file, locationId));
    },
  )
  .post('/imports/manabox/update-apply', validate('json', ManaBoxUpdateApplyRequest), (c) =>
    c.json(applyManaBoxUpdate(getDb(), c.req.valid('json'))),
  );
