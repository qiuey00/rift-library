import { Hono } from 'hono';
import {
  MoxfieldUpdateApplyRequest,
  MoxfieldUpdatePreviewRequest,
} from '../../shared/api/moxfield-update';
import { getDb } from '../db/database';
import { applyMoxfieldUpdate, previewMoxfieldUpdate } from '../services/imports/moxfield-update';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const moxfieldUpdateRoutes = new Hono()
  .post(
    '/imports/moxfield/update-preview',
    validate('json', MoxfieldUpdatePreviewRequest),
    async (c) => {
      const { deckId, text, ...choices } = c.req.valid('json');
      return c.json(await previewMoxfieldUpdate(getDb(), deckId, text, choices));
    },
  )
  .post('/imports/moxfield/update-apply', validate('json', MoxfieldUpdateApplyRequest), async (c) =>
    c.json(await applyMoxfieldUpdate(getDb(), c.req.valid('json'))),
  );
