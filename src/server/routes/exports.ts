import { Hono } from 'hono';
import { z } from 'zod';
import { IdParam } from '../../shared/api/common';
import { DeckExportQuery, type MoxfieldExport } from '../../shared/api/exports';
import { getDb } from '../db/database';
import { collectionCsv, collectionCsvFileName } from '../services/exports/collection-csv';
import { deckMoxfieldExport, locationMoxfieldExport } from '../services/exports/moxfield';
import { validate } from '../validate';

const idParam = validate('param', z.object({ id: IdParam }));

/** The headers that make the browser save `body` as a file named `fileName`. */
function attachment(type: string, fileName: string) {
  return {
    'Content-Type': `${type}; charset=utf-8`,
    'Content-Disposition': `attachment; filename="${fileName.replaceAll('"', '')}"`,
  };
}

const textFile = (file: MoxfieldExport) =>
  new Response(file.text, { headers: attachment('text/plain', file.fileName) });

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
export const exportsRoutes = new Hono()
  .get('/exports/collection.csv', (c) =>
    c.body(streamOf(collectionCsv(getDb())), 200, attachment('text/csv', collectionCsvFileName())),
  )
  .get('/exports/decks/:id/moxfield', idParam, validate('query', DeckExportQuery), (c) =>
    c.json(deckMoxfieldExport(getDb(), c.req.valid('param').id, c.req.valid('query'))),
  )
  .get('/exports/decks/:id/moxfield.txt', idParam, validate('query', DeckExportQuery), (c) =>
    textFile(deckMoxfieldExport(getDb(), c.req.valid('param').id, c.req.valid('query'))),
  )
  .get('/exports/locations/:id/moxfield', idParam, (c) =>
    c.json(locationMoxfieldExport(getDb(), c.req.valid('param').id)),
  )
  .get('/exports/locations/:id/moxfield.txt', idParam, (c) =>
    textFile(locationMoxfieldExport(getDb(), c.req.valid('param').id)),
  );
