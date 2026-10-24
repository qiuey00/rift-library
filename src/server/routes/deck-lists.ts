import { Hono } from 'hono';
import { z } from 'zod';
import { IdParam } from '../../shared/api/common';
import {
  DeckListCreate,
  DeckListPreviewRequest,
  DeckListRequest,
  PreviewId,
} from '../../shared/api/deck-lists';
import {
  deckListCreatedSample,
  deckListPreviewSample,
  deckListUpdatedSample,
} from '../../shared/api/samples/deck-lists';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const deckListsRoutes = new Hono()
  // STUB until #19: parse the text, match names (through Riftcodex for unknown ones) and keep
  // the preview under its id.
  .post('/deck-lists/preview', validate('json', DeckListPreviewRequest), (c) =>
    c.json(deckListPreviewSample),
  )
  // STUB until #19: make the deck from the kept preview.
  .post(
    '/deck-lists/:previewId/create',
    validate('param', z.object({ previewId: PreviewId })),
    validate('json', DeckListCreate),
    (c) => c.json(deckListCreatedSample, 201),
  )
  // STUB until #19: replace the deck's slots, keeping unchanged cards' picked printing and tags.
  .post(
    '/decks/:id/deck-list',
    validate('param', z.object({ id: IdParam })),
    validate('json', DeckListRequest),
    (c) => c.json(deckListUpdatedSample),
  );
