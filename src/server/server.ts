import { existsSync } from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { app } from './app';
import { dataDir, openDataDatabase, setDb } from './db/database';
import { handleError } from './errors';
import { CardDataSync, setCardDataSync } from './riftcodex/sync';

/**
 * Only this computer can reach the server: other devices on the network can't, which is
 * what makes running with no sign-in safe (PLAT-4).
 */
export const HOST = '127.0.0.1';
export const PORT = 4300;

/** Where `npm run build` writes the screens. */
export const CLIENT_DIR = path.join(import.meta.dirname, '..', '..', 'dist', 'client');

/** The API plus the built screens. */
export function createSite(clientDir = CLIENT_DIR) {
  const site = new Hono();
  site.route('/', app);
  if (existsSync(clientDir)) {
    site.use('*', serveStatic({ root: clientDir }));
    // Screens are routed in the browser, so every other page address gets the app's page.
    site.get('*', serveStatic({ root: clientDir, path: 'index.html' }));
  }
  site.notFound((c) =>
    c.text(
      'The screens are not built. Run `npm start`, or open http://localhost:5173 while `npm run dev` runs.',
      404,
    ),
  );
  site.onError(handleError);
  return site;
}

/**
 * Opens `<dataDir>/library.db`, bringing its tables up to date, then starts the server on
 * 127.0.0.1 and the card data sync (now when there are no cards, then once the last sync is 24
 * hours old, unless RIFTCODEX=off). Port 0 picks a free port, which tests use. Closing the
 * server closes the database.
 */
export function startServer({
  port = PORT,
  clientDir = CLIENT_DIR,
  dataDir: dir = dataDir(),
} = {}) {
  const db = openDataDatabase(dir);
  setDb(db);
  const sync = new CardDataSync(db, process.env.RIFTCODEX !== 'off');
  setCardDataSync(sync);
  const server = serve({ fetch: createSite(clientDir).fetch, hostname: HOST, port });
  sync.start();
  server.on('close', () => {
    sync.stop();
    db.$client.close();
  });
  return server;
}
