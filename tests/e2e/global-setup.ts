import path from 'node:path';
import { openDataDatabase } from '../../src/server/db/database';
import { loadBulkFile } from '../../src/server/scryfall/load';

// Browser tests' global setup: loads the hand-made Scryfall fixtures into the test database
// in DATA_DIR, so flow tests have cards and printings without calling Scryfall. The flow
// fixture holds every printing in Jeff's ManaBox sample and the Hearthhull decklist, trimmed
// to the fields the app reads.
// playwright.config.ts runs it as part of the web server command, because Playwright starts
// the web server before its own `globalSetup` and the cards must be there before the app is.

const E2E_FIXTURES = ['default-cards.json', 'flow-cards.json'].map((file) =>
  path.join(import.meta.dirname, '..', 'fixtures', 'scryfall', file),
);

/** When the fixture's "file" was made, as card data status reports it. */
const E2E_BULK_UPDATED_AT = '2026-10-18T09:05:12.000Z';

if (!process.env.DATA_DIR) {
  throw new Error(
    'Set DATA_DIR to a temp folder: the setup never loads into the real data folder.',
  );
}
const db = openDataDatabase(process.env.DATA_DIR);
try {
  // Loads only ever add rows, so the second file adds to the first.
  let result: Awaited<ReturnType<typeof loadBulkFile>> | undefined;
  for (const file of E2E_FIXTURES) {
    result = await loadBulkFile(db, file, { bulkUpdatedAt: E2E_BULK_UPDATED_AT });
  }
  if (!result) throw new Error('No fixtures to load.');
  console.log(
    `Loaded ${result.cardCount} cards and ${result.printingCount} printings for the browser tests.`,
  );
} finally {
  db.$client.close();
}
