import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip, gunzipSync, constants as zlibConstants } from 'node:zlib';
import { count, getTableColumns, getTableName, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import streamArray from 'stream-json/streamers/stream-array.js';
import type { Db } from '../db/database';
import { cardDataStatus, cards, cardsStaging, printings, printingsStaging } from '../db/schema';
import {
  type CardRow,
  cardToRows,
  isPaperPrinting,
  type PrintingRow,
  ScryfallCard,
} from './card-rows';

// Loads a Scryfall Default Cards bulk file (one JSON array of card objects, or JSON Lines as
// Scryfall now serves it, gzipped or not) into `cards` and `printings`. The file is streamed one card at a time into the staging tables, then swapped in
// with one transaction, so the app keeps working on the old data while a load runs. Rows are
// only ever added or updated, never deleted: copy stacks, slots and buy list items point at them.

const BATCH_SIZE = 1000;

export interface LoadOptions {
  /** When Scryfall made the file (UTC ISO 8601), saved in `card_data_status`. */
  bulkUpdatedAt: string;
  /** Called as the file is read, with bytes read so far and the file's size. */
  onProgress?: (bytesRead: number, fileSize: number) => void;
}

export interface LoadResult {
  /** Paper printings read from the file. */
  printingsRead: number;
  /** Online-only printings left out. */
  notPaper: number;
  /** Card objects that didn't match the expected shape, left out. */
  skipped: number;
  /** Cards and printings the app has after the swap. */
  cardCount: number;
  printingCount: number;
}

export async function loadBulkFile(
  db: Db,
  file: string,
  options: LoadOptions,
): Promise<LoadResult> {
  const { size } = await stat(file);
  clearStaging(db);

  const result = { printingsRead: 0, notPaper: 0, skipped: 0 };
  let cardBatch: CardRow[] = [];
  let printingBatch: PrintingRow[] = [];
  const flush = () => {
    if (printingBatch.length === 0) return;
    writeStaging(db, cardBatch, printingBatch);
    cardBatch = [];
    printingBatch = [];
  };

  const format = await detectFormat(file);
  const source = createReadStream(file);
  if (options.onProgress) {
    const onProgress = options.onProgress;
    source.on('data', () => onProgress(source.bytesRead, size));
  }
  const stages = [
    source,
    ...(format.gzip ? [createGunzip()] : []),
    ...(format.jsonl ? [jsonLines] : [streamArray.withParserAsStream(), values]),
    async (items: AsyncIterable<unknown>) => {
      for await (const value of items) {
        const parsed = ScryfallCard.safeParse(value);
        if (!parsed.success) {
          result.skipped++;
          continue;
        }
        if (!isPaperPrinting(parsed.data)) {
          result.notPaper++;
          continue;
        }
        const rows = cardToRows(parsed.data);
        cardBatch.push(rows.card);
        printingBatch.push(rows.printing);
        result.printingsRead++;
        if (printingBatch.length >= BATCH_SIZE) flush();
      }
    },
  ];

  try {
    // The stages vary with the format, which pipeline's typings can't follow.
    await (pipeline as (...streams: unknown[]) => Promise<void>)(...stages);
    flush();
  } catch (err) {
    clearStaging(db);
    throw err;
  }

  const counts = swapIn(db, options.bulkUpdatedAt);
  return { ...result, ...counts };
}

/**
 * Scryfall's files are one JSON array of cards, or JSON Lines (one card per line), either one
 * gzipped or not. This looks at the file's first bytes to tell which.
 */
async function detectFormat(file: string) {
  const handle = await open(file);
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(16_384), 0, 16_384, 0);
    const head = buffer.subarray(0, bytesRead);
    const gzip = head[0] === 0x1f && head[1] === 0x8b;
    const text = gzip ? gunzipSync(head, { finishFlush: zlibConstants.Z_SYNC_FLUSH }) : head;
    const first = text.toString('utf8').trimStart()[0];
    return { gzip, jsonl: first !== undefined && first !== '[' };
  } finally {
    await handle.close();
  }
}

/** StreamArray's `{ key, value }` items as values. */
async function* values(items: AsyncIterable<{ value: unknown }>) {
  for await (const { value } of items) yield value;
}

/** JSON Lines into values. A line that isn't JSON yields `undefined`, which counts as broken. */
async function* jsonLines(chunks: AsyncIterable<Buffer>) {
  const decoder = new StringDecoder('utf8');
  let rest = '';
  const parse = (line: string) => {
    try {
      return JSON.parse(line) as unknown;
    } catch {
      return undefined;
    }
  };
  for await (const chunk of chunks) {
    const lines = (rest + decoder.write(chunk)).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) yield parse(line);
  }
  rest += decoder.end();
  if (rest.trim()) yield parse(rest);
}

function clearStaging(db: Db) {
  db.transaction((tx) => {
    tx.delete(cardsStaging).run();
    tx.delete(printingsStaging).run();
  });
}

/** One batch into staging. A card seen again (another printing) keeps the latest row. */
function writeStaging(db: Db, cardRows: CardRow[], printingRows: PrintingRow[]) {
  db.transaction((tx) => {
    tx.insert(cardsStaging)
      .values(cardRows)
      .onConflictDoUpdate({ target: cardsStaging.oracleId, set: excludedSet(cardsStaging) })
      .run();
    tx.insert(printingsStaging)
      .values(printingRows)
      .onConflictDoUpdate({
        target: printingsStaging.scryfallId,
        set: excludedSet(printingsStaging),
      })
      .run();
  });
}

/** Upserts staging into the live tables, updates the status row and empties staging, all at once. */
function swapIn(db: Db, bulkUpdatedAt: string) {
  return db.transaction((tx) => {
    tx.run(upsertFromStaging(cards, cardsStaging, 'oracle_id'));
    tx.run(upsertFromStaging(printings, printingsStaging, 'scryfall_id'));
    tx.delete(cardsStaging).run();
    tx.delete(printingsStaging).run();
    const cardCount = tx.select({ n: count() }).from(cards).get()?.n ?? 0;
    const printingCount = tx.select({ n: count() }).from(printings).get()?.n ?? 0;
    const status = { bulkUpdatedAt, cardCount, printingCount };
    tx.insert(cardDataStatus)
      .values({ id: 1, ...status })
      .onConflictDoUpdate({ target: cardDataStatus.id, set: status })
      .run();
    return { cardCount, printingCount };
  });
}

function columnNames(table: SQLiteTable) {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

/** `{ column: excluded.column }` for every column, for an upsert that takes the new row. */
export function excludedSet(table: SQLiteTable) {
  return Object.fromEntries(
    Object.entries(getTableColumns(table)).map(([key, column]) => [
      key,
      sql.raw(`excluded."${column.name}"`),
    ]),
  );
}

function upsertFromStaging(table: SQLiteTable, staging: SQLiteTable, key: string) {
  const names = columnNames(table);
  const list = names.map((name) => `"${name}"`).join(', ');
  const updates = names
    .filter((name) => name !== key)
    .map((name) => `"${name}" = excluded."${name}"`)
    .join(', ');
  // `WHERE true` keeps SQLite from reading ON CONFLICT as part of the SELECT.
  return sql.raw(
    `INSERT INTO "${getTableName(table)}" (${list}) SELECT ${list} FROM "${getTableName(staging)}" WHERE true ` +
      `ON CONFLICT ("${key}") DO UPDATE SET ${updates}`,
  );
}
