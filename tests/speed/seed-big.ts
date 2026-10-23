import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DATABASE_FILE, openDataDatabase } from '../../src/server/db/database';
import { seedBigCollection } from './big-collection';

// `npm run seed:big`: builds the made-up collection of tests/speed/big-collection.ts into
// <DATA_DIR>/library.db, in a new temp folder unless DATA_DIR names an empty one. It never
// touches a folder that already holds a database, so Jeff's real data/ is safe.

const dir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : mkdtempSync(path.join(tmpdir(), 'log-big-'));
if (existsSync(path.join(dir, DATABASE_FILE))) {
  throw new Error(`${dir} already has a database. Point DATA_DIR at an empty folder.`);
}

const started = performance.now();
const db = openDataDatabase(dir);
try {
  const made = seedBigCollection(db);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `Built ${made.cards} cards, ${made.printings} printings, ${made.copies} copies in ` +
      `${made.stacks} stacks across ${made.locations} locations, ${made.decks} decks and ` +
      `${made.movements} movements in ${seconds} s.`,
  );
  console.log(`The database is in ${dir}. Serve it with DATA_DIR set to that folder.`);
} finally {
  db.$client.close();
}
