import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type OpenDb, openDataDatabase } from '../../src/server/db/database';
import { copyStacks, locations } from '../../src/server/db/schema';
import { createTestDb, insertCard, insertPrinting } from '../../src/server/db/test-db';
import { startServer } from '../../src/server/server';

const TABLES = [
  'buy_list_items',
  'card_data_status',
  'cards',
  'copy_stacks',
  'deck_slot_tags',
  'deck_slots',
  'decks',
  'locations',
  'movement_batches',
  'movements',
  'printings',
];

describe('database file', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'log-db-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const inboxes = (file: string) => {
    const client = new Database(file, { readonly: true });
    try {
      return client.prepare(`SELECT name, type FROM locations WHERE type = 'inbox'`).all();
    } finally {
      client.close();
    }
  };

  it('is created on server start with every table, in WAL mode, with one inbox, also after restarts', async () => {
    const dataDir = path.join(dir, 'not-yet-made');
    const file = path.join(dataDir, 'library.db');

    for (let start = 0; start < 2; start++) {
      const server = startServer({ port: 0, dataDir });
      await once(server, 'listening');
      await new Promise((resolve) => server.close(resolve));
    }

    expect(existsSync(file)).toBe(true);
    const client = new Database(file, { readonly: true });
    const tables = client
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name`,
      )
      .pluck()
      .all();
    expect(client.pragma('journal_mode', { simple: true })).toBe('wal');
    client.close();
    expect(tables).toEqual(TABLES);
    expect(inboxes(file)).toEqual([{ name: 'To sort', type: 'inbox' }]);
  });

  it('turns foreign keys on', () => {
    const db = openDataDatabase(dir);
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    db.$client.close();
  });
});

describe('rules in the schema', () => {
  let db: OpenDb;
  let inboxId: number;
  let boxId: number;
  let binderId: number;

  beforeEach(() => {
    db = createTestDb();
    inboxId = db.select().from(locations).get()?.id ?? 0;
    boxId = db.insert(locations).values({ name: 'Box', type: 'box' }).returning().get().id;
    binderId = db.insert(locations).values({ name: 'Binder', type: 'binder' }).returning().get().id;
    const cardId = insertCard(db, { name: 'Sun Disc', energy: 1 });
    insertPrinting(db, { riftcodexId: 'printing-sol-ring', cardId, collectorNumber: '395' });
  });
  afterEach(() => db.$client.close());

  const stack = (overrides: Partial<typeof copyStacks.$inferInsert> = {}) =>
    db
      .insert(copyStacks)
      .values({
        printingId: 'printing-sol-ring',
        quantity: 1,
        finish: 'normal',
        condition: 'near_mint',
        language: 'en',
        locationId: boxId,
        ...overrides,
      })
      .run();

  it('rejects a second alike stack in one place', () => {
    stack({ cameFromLocationId: binderId });
    expect(() => stack({ cameFromLocationId: binderId, quantity: 2 })).toThrow(/UNIQUE/);
  });

  it('rejects a second alike stack when neither has a came-from location', () => {
    stack();
    expect(() => stack({ quantity: 2 })).toThrow(/UNIQUE/);
  });

  it('allows alike stacks with different came-from locations', () => {
    stack();
    stack({ cameFromLocationId: binderId });
    stack({ cameFromLocationId: inboxId });
    expect(db.select().from(copyStacks).all()).toHaveLength(3);
  });

  it('allows stacks that differ in any detail', () => {
    stack();
    stack({ finish: 'foil' });
    stack({ condition: 'lightly_played' });
    stack({ language: 'ja' });
    stack({ misprint: true });
    stack({ altered: true });
    stack({ isProxy: true });
    stack({ locationId: binderId });
    expect(db.select().from(copyStacks).all()).toHaveLength(8);
  });

  it('rejects a stack with quantity 0', () => {
    expect(() => stack({ quantity: 0 })).toThrow(/CHECK/);
  });

  it('rejects a stack whose printing or location is missing', () => {
    expect(() => stack({ printingId: 'no-such-printing' })).toThrow(/FOREIGN KEY/);
    expect(() => stack({ locationId: 999 })).toThrow(/FOREIGN KEY/);
  });

  it('rejects a second inbox', () => {
    expect(() => db.insert(locations).values({ name: 'Inbox 2', type: 'inbox' }).run()).toThrow(
      /UNIQUE/,
    );
  });

  it('stores true/false as 0 or 1 and times as UTC ISO 8601 text', () => {
    stack({ isProxy: true });
    const row = db.$client.prepare('SELECT is_proxy, misprint, created_at FROM copy_stacks').get();
    expect(row).toEqual({
      is_proxy: 1,
      misprint: 0,
      created_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
    });
  });
});
