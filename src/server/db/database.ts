import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { and, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

/** The database or a transaction on it: what queries and services take. */
export type Db = BaseSQLiteDatabase<'sync', Database.RunResult, typeof schema>;

/** An open database, as `openDatabase` returns it. `$client` is the better-sqlite3 handle. */
export type OpenDb = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

/** The app's folder, which holds `data` unless DATA_DIR says otherwise. */
const APP_DIR = path.join(import.meta.dirname, '..', '..', '..');

export const DATABASE_FILE = 'library.db';

/** Where the database lives: the DATA_DIR environment variable, or `data` in the app's folder. */
export function dataDir() {
  return path.resolve(process.env.DATA_DIR || path.join(APP_DIR, 'data'));
}

/**
 * Opens a database file (or ':memory:'), brings its tables up to date with the migrations,
 * and makes sure the "To sort" inbox exists.
 */
export function openDatabase(file: string): OpenDb {
  const client = new Database(file);
  try {
    client.pragma('journal_mode = WAL');
    // Migrations that rebuild a table need foreign keys off while they run, as SQLite advises.
    client.pragma('foreign_keys = OFF');
    const db = drizzle({ client, schema });
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    const broken = client.pragma('foreign_key_check') as unknown[];
    if (broken.length > 0) {
      throw new Error(`A migration left ${broken.length} rows pointing at missing rows.`);
    }
    client.pragma('foreign_keys = ON');
    ensureInbox(db);
    return db;
  } catch (err) {
    client.close();
    throw err;
  }
}

/** Opens `<dir>/library.db`, creating the folder if it is missing. */
export function openDataDatabase(dir = dataDir()): OpenDb {
  mkdirSync(dir, { recursive: true });
  return openDatabase(path.join(dir, DATABASE_FILE));
}

/** There is always exactly one "To sort" inbox (LOC-1). */
function ensureInbox(db: Db) {
  const { locations } = schema;
  db.update(locations)
    .set({ deletedAt: null })
    .where(and(eq(locations.type, 'inbox'), isNotNull(locations.deletedAt)))
    .run();
  db.insert(locations).values({ name: 'To sort', type: 'inbox' }).onConflictDoNothing().run();
}

let current: OpenDb | undefined;

/** The database the running server uses, opened by `startServer`. */
export function getDb(): OpenDb {
  if (!current) {
    throw new Error('The database is not open yet. startServer opens it, or call setDb in tests.');
  }
  return current;
}

/** Sets the database the server uses, such as a fresh one from `createTestDb()` in tests. */
export function setDb(db: OpenDb) {
  current = db;
}
