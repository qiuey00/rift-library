import { Hono } from 'hono';
import { z } from 'zod';
import { IdParam } from '../../shared/api/common';
import {
  DeckListCreate,
  DeckListPreviewRequest,
  DeckListRequest,
  PreviewId,
} from '../../shared/api/deck-lists';
import { getDb } from '../db/database';
import { createFromPreview, previewDeckList, updateFromDeckList } from '../services/deck-lists';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const deckListsRoutes = new Hono()
  .post('/deck-lists/preview', validate('json', DeckListPreviewRequest), async (c) =>
    c.json(await previewDeckList(getDb(), c.req.valid('json'))),
  )
  .post(
    '/deck-lists/:previewId/create',
    validate('param', z.object({ previewId: PreviewId })),
    validate('json', DeckListCreate),
    (c) =>
      c.json(createFromPreview(getDb(), c.req.valid('param').previewId, c.req.valid('json')), 201),
  )
  .post(
    '/decks/:id/deck-list',
    validate('param', z.object({ id: IdParam })),
    validate('json', DeckListRequest),
    async (c) =>
      c.json(await updateFromDeckList(getDb(), c.req.valid('param').id, c.req.valid('json'))),
  );
