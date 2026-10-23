import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openDataDatabase } from '../../src/server/db/database';
import { cards, printings } from '../../src/server/db/schema';

// Browser tests' global setup: writes the made-up card data in tests/fixtures/cards.json into
// the test database in DATA_DIR, so flow tests have cards and printings while the app has no
// card data source of its own (until #7).
// playwright.config.ts runs it as part of the web server command, because Playwright starts
// the web server before its own `globalSetup` and the cards must be there before the app is.

const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'cards.json');

type Fixture = {
  cards: (typeof cards.$inferInsert)[];
  printings: (typeof printings.$inferInsert)[];
};

if (!process.env.DATA_DIR) {
  throw new Error(
    'Set DATA_DIR to a temp folder: the setup never loads into the real data folder.',
  );
}
const fixture: Fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const db = openDataDatabase(process.env.DATA_DIR);
try {
  db.transaction((tx) => {
    for (const card of fixture.cards) tx.insert(cards).values(card).onConflictDoNothing().run();
    for (const printing of fixture.printings)
      tx.insert(printings).values(printing).onConflictDoNothing().run();
  });
  console.log(
    `Loaded ${fixture.cards.length} cards and ${fixture.printings.length} printings for the browser tests.`,
  );
} finally {
  db.$client.close();
}
