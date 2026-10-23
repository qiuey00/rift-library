import { Hono } from 'hono';
import type { MoxfieldPreview } from '../../shared/api/moxfield';
import { MoxfieldCreateRequest, MoxfieldPreviewRequest } from '../../shared/api/moxfield';
import { getDb } from '../db/database';
import { createMoxfieldDeck, previewMoxfieldDeck } from '../services/imports/moxfield';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const moxfieldRoutes = new Hono()
  .post('/imports/moxfield/preview', validate('json', MoxfieldPreviewRequest), async (c) => {
    const { text, ...choices } = c.req.valid('json');
    const { cardLineCount, skippedCount, lineCards, slotTags, ...preview } =
      await previewMoxfieldDeck(getDb(), text, choices);
    return c.json(preview satisfies MoxfieldPreview);
  })
  .post('/imports/moxfield/create', validate('json', MoxfieldCreateRequest), async (c) =>
    c.json(await createMoxfieldDeck(getDb(), c.req.valid('json'))),
  );
