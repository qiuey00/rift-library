import { Hono } from 'hono';
import { z } from 'zod';
import { IdParam } from '../../shared/api/common';
import { DeckListExportQuery } from '../../shared/api/exports';
import { deckExportSample, locationExportSample } from '../../shared/api/samples/deck-lists';
import { getDb } from '../db/database';
import { collectionCsv, collectionCsvFileName } from '../services/exports/collection-csv';
import { validate } from '../validate';

/** The headers that make the browser save `body` as a file named `fileName`. */
function attachment(type: string, fileName: string) {
  return {
    'Content-Type': `${type}; charset=utf-8`,
    'Content-Disposition': `attachment; filename="${fileName.replaceAll('"', '')}"`,
  };
}

/** Sends each piece the generator writes as it is asked for, so the file never sits in memory. */
function streamOf(pieces: Generator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    pull(controller) {
      const next = pieces.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    cancel() {
      pieces.return(undefined);
    },
  });
}

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
const idParam = validate('param', z.object({ id: IdParam }));
const deckListQuery = validate('query', DeckListExportQuery);

export const exportsRoutes = new Hono()
  .get('/exports/collection.csv', (c) =>
    c.body(streamOf(collectionCsv(getDb())), 200, attachment('text/csv', collectionCsvFileName())),
  )
  // STUB until #20: write the deck's list (EXP-1).
  .get('/exports/decks/:id/deck-list', idParam, deckListQuery, (c) => c.json(deckExportSample))
  // STUB until #20.
  .get('/exports/decks/:id/deck-list.txt', idParam, deckListQuery, (c) =>
    c.body(deckExportSample.text, 200, attachment('text/plain', deckExportSample.fileName)),
  )
  // STUB until #20: write the location's list (EXP-2).
  .get('/exports/locations/:id/deck-list', idParam, (c) => c.json(locationExportSample))
  // STUB until #20.
  .get('/exports/locations/:id/deck-list.txt', idParam, (c) =>
    c.body(locationExportSample.text, 200, attachment('text/plain', locationExportSample.fileName)),
  );
