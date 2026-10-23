import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { openDatabase } from '../../src/server/db/database';
import { createTestDb } from '../../src/server/db/test-db';
import { DeckView, SlotRow, SlotTags, Tag } from '../../src/shared/api/decks';
import {
  COLLECTION_CSV_COLUMNS,
  DeckExportQuery,
  MoxfieldExport,
} from '../../src/shared/api/exports';
import { LocationNode, UpdateLocationBody } from '../../src/shared/api/locations';
import { PickListResponse } from '../../src/shared/api/pick-list';
import { deckViewSample, slotTagsSample } from '../../src/shared/api/samples/decks';
import * as exportsSamples from '../../src/shared/api/samples/exports';
import { tradeBinderNode } from '../../src/shared/api/samples/locations';
import { pickListSample } from '../../src/shared/api/samples/pick-list';
import { collectionValueSample } from '../../src/shared/api/samples/stacks';
import { CollectionValue, StacksQuery } from '../../src/shared/api/stacks';

// The Next release contract (#133): the new schemas, samples and migration.

describe('Next release samples', () => {
  it.each([
    ['collection value', CollectionValue, collectionValueSample],
    ['trade binder', LocationNode, tradeBinderNode],
    ['pick list', PickListResponse, pickListSample],
    ['deck view', DeckView, deckViewSample],
    ['tagged slot', SlotRow, slotTagsSample],
    ['Hearthhull export', MoxfieldExport, exportsSamples.hearthhullMoxfieldExportSample],
    [
      'Hearthhull export without tags or maybe board',
      MoxfieldExport,
      exportsSamples.hearthhullPlainMoxfieldExportSample,
    ],
    ['Trade binder export', MoxfieldExport, exportsSamples.tradeBinderMoxfieldExportSample],
  ] as const)('the %s sample parses', (_name, schema, sample) => {
    expect((schema as z.ZodType).parse(sample)).toEqual(sample);
  });

  it('has one pick-list line from the Trade binder', () => {
    const lines = pickListSample.pickList.groups.flatMap((group) => group.lines);
    const fromTrade = lines.filter((line) => line.fromTrade);
    expect(fromTrade.map((line) => line.suggested.location.name)).toEqual(['Trade binder']);
    expect(pickListSample.pickList.totals.lines).toBe(
      lines.length + pickListSample.pickList.otherDecks.length,
    );
  });

  it('tags the Hearthhull slots with Ramp, Card draw and Removal', () => {
    const tagged = (tag: string) =>
      deckViewSample.slots
        .filter((slot) => slot.tags.includes(tag))
        .map((slot) => slot.card.name)
        .sort();
    expect(tagged('Ramp')).toEqual([
      'Arcane Signet',
      'Augur of Autumn',
      'Cultivate',
      'Farseek',
      'Sol Ring',
    ]);
    expect(tagged('Card draw')).toEqual([
      'Aftermath Analyst',
      'Augur of Autumn',
      'Tireless Tracker',
    ]);
    expect(tagged('Removal')).toEqual(['Beast Within', 'Blasphemous Act', 'Infernal Grasp']);
    for (const slot of deckViewSample.slots) {
      expect(slot.tags).toEqual(
        [...slot.tags].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
      );
    }
  });

  it('counts the cards and lines in each Moxfield export', () => {
    const exports = [
      exportsSamples.hearthhullMoxfieldExportSample,
      exportsSamples.hearthhullPlainMoxfieldExportSample,
      exportsSamples.tradeBinderMoxfieldExportSample,
    ];
    for (const file of exports) {
      const cardLines = file.text.split('\n').filter((line) => /^\d+ /.test(line));
      expect(cardLines).toHaveLength(file.lineCount);
      const quantities = cardLines.map((line) => Number.parseInt(line, 10));
      expect(quantities.reduce((sum, n) => sum + n, 0)).toBe(file.cardCount + file.maybeCount);
    }
    const hearthhull = exportsSamples.hearthhullMoxfieldExportSample.text;
    expect(hearthhull).toContain('1 Arcane Signet (EOC) 53 #ramp\n');
    expect(hearthhull).toContain('1 Augur of Autumn (EOC) 92 #card-draw #ramp\n');
    // Moxfield writes tags in lower case with hyphens for spaces, such as #token-maker.
    for (const tag of hearthhull.match(/#\S+/g) ?? []) expect(tag).toMatch(/^#[a-z0-9-]+$/);
    expect(exportsSamples.hearthhullPlainMoxfieldExportSample.text).not.toContain('#');
    expect(exportsSamples.tradeBinderMoxfieldExportSample.text).toContain(
      '1 Jeweled Lotus (EOC) 160 *F*\n',
    );
    expect(exportsSamples.tradeBinderMoxfieldExportSample.cardCount).toBe(
      tradeBinderNode.totalCount,
    );
  });

  it('writes the CSV header and three rows', () => {
    const [header, ...rows] = exportsSamples.collectionCsvSample.trimEnd().split('\n');
    expect(header).toBe(COLLECTION_CSV_COLUMNS.join(','));
    expect(rows).toHaveLength(3);
  });
});

describe('Next release request checks', () => {
  it('reads tags, merging nothing itself but trimming and refusing #', () => {
    expect(Tag.parse('  Card draw ')).toBe('Card draw');
    expect(Tag.safeParse('#Ramp').success).toBe(false);
    expect(Tag.safeParse('   ').success).toBe(false);
    expect(Tag.safeParse('x'.repeat(41)).success).toBe(false);
    expect(
      SlotTags.safeParse({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }).success,
    ).toBe(false);
    expect(SlotTags.parse({ tags: [] })).toEqual({ tags: [] });
  });

  it('defaults the stacks sort to name and the deck export to tags and maybe board', () => {
    expect(StacksQuery.parse({}).sort).toBe('name');
    expect(StacksQuery.safeParse({ sort: 'price' }).success).toBe(false);
    expect(DeckExportQuery.parse({})).toEqual({ tags: '1', maybe: '1' });
  });

  it('takes forTrade alone as a location change', () => {
    expect(UpdateLocationBody.parse({ forTrade: true })).toEqual({ forTrade: true });
  });
});

describe('Next release migration', () => {
  const migrations = path.join(import.meta.dirname, '../../src/server/db/migrations');
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'log-migrate-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('applies to a fresh database', () => {
    const db = createTestDb();
    const columns = (table: string) =>
      (db.$client.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
    expect(columns('locations')).toContain('for_trade');
    for (const table of ['printings', 'printings_staging']) {
      expect(columns(table)).toEqual(
        expect.arrayContaining(['price_usd', 'price_usd_foil', 'price_usd_etched']),
      );
    }
    expect(columns('deck_slot_tags')).toEqual(['slot_id', 'tag', 'tag_key']);
  });

  it('applies to an existing database, keeping its rows', () => {
    // A database as the MVP left it: every migration before this one.
    const before = path.join(dir, 'before');
    cpSync(migrations, before, { recursive: true });
    const journalFile = path.join(before, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8'));
    const last = journal.entries.pop();
    rmSync(path.join(before, `${last.tag}.sql`));
    writeFileSync(journalFile, JSON.stringify(journal));

    const file = path.join(dir, 'library.db');
    const old = new Database(file);
    migrate(drizzle({ client: old }), { migrationsFolder: before });
    old.prepare(`INSERT INTO locations (name, type) VALUES ('Rares binder', 'binder')`).run();
    old.close();

    const db = openDatabase(file);
    const rows = db.$client
      .prepare('SELECT name, for_trade AS forTrade FROM locations ORDER BY id')
      .all();
    expect(rows).toEqual(expect.arrayContaining([{ name: 'Rares binder', forTrade: 0 }]));
    db.$client.close();
  });
});
