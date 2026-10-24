import { eq } from 'drizzle-orm';
import Papa from 'papaparse';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { copyStacks, locations } from '../../src/server/db/schema';
import { createTestDb, insertCard, insertPrinting } from '../../src/server/db/test-db';
import { collectionCsvFileName } from '../../src/server/services/exports/collection-csv';
import type { Finish } from '../../src/shared/api/common';
import { COLLECTION_CSV_COLUMNS } from '../../src/shared/api/exports';

let db: OpenDb;
let inbox: number;
let longBox: number;
let lands: number;
let trade: number;
let deckBox: number;

function location(name: string, type: typeof locations.$inferInsert.type, parentId?: number) {
  return db.insert(locations).values({ name, type, parentId }).returning({ id: locations.id }).get()
    .id;
}

/** A card with one printing per entry, such as ['eoc', '53']. */
function card(name: string, ...sets: [setCode: string, collectorNumber: string][]) {
  const cardId = insertCard(db, { name, type: name === 'Calm Rune' ? 'rune' : 'gear' });
  for (const [setCode, collectorNumber] of sets) {
    insertPrinting(db, {
      riftcodexId: printingKey(name, setCode, collectorNumber),
      cardId,
      setCode,
      setName: `Set ${setCode.toUpperCase()}`,
      collectorNumber,
      rarity: 'rare',
    });
  }
}

const printingKey = (name: string, setCode: string, collectorNumber: string) =>
  `${name}-${setCode}-${collectorNumber}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function stack(
  printingId: string,
  locationId: number,
  quantity: number,
  extra: Partial<typeof copyStacks.$inferInsert> = {},
) {
  db.insert(copyStacks)
    .values({
      printingId,
      quantity,
      finish: 'normal',
      condition: 'near_mint',
      language: 'en',
      locationId,
      ...extra,
    })
    .run();
}

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  inbox = db.select().from(locations).where(eq(locations.type, 'inbox')).get()?.id ?? 0;
  longBox = location('Long box', 'box');
  lands = location('Lands', 'box', longBox);
  trade = location('Trade binder', 'binder');
  deckBox = location('Jinx Burn deck box', 'deck_box');

  card('Jinx, Loose Cannon', ['eoc', '1']);
  card('Ember Signet', ['eoc', '53'], ['fic', '332']);
  card('Copper Mender', ['eoc', '92']);
  card('Unbound Volley', ['eoc', '93']);
  card('Grim Scheme', ['eoc', '95']);
  card('Calm Rune', ['eoe', '276']);
  card('Gilded Whelp', ['sos', '52']);
  card('Hextech Captain', ['eoc', '97']);
  card('Sun Disc', ['eoc', '57']);
});

afterEach(() => db.$client.close());

describe('GET /api/exports/collection.csv', () => {
  type Stack = [
    name: string,
    set: string,
    number: string,
    location: () => number,
    qty: number,
    extra?: Partial<typeof copyStacks.$inferInsert>,
  ];
  const stacks: Stack[] = [
    ['Gilded Whelp', 'sos', '52', () => inbox, 1],
    ['Ember Signet', 'eoc', '53', () => lands, 2, { purchasePrice: 0.85, purchaseCurrency: 'USD' }],
    [
      'Unbound Volley',
      'eoc',
      '93',
      () => lands,
      1,
      { finish: 'foil' as Finish, condition: 'lightly_played', language: 'de' },
    ],
    ['Sun Disc', 'eoc', '57', () => longBox, 1, { isProxy: true, misprint: true, altered: true }],
    ['Ember Signet', 'fic', '332', () => trade, 1, { finish: 'foil' as Finish }],
    ['Jinx, Loose Cannon', 'eoc', '1', () => deckBox, 1, { cameFromLocationId: longBox }],
  ];
  beforeEach(() => {
    for (const [name, set, number, where, qty, extra] of stacks)
      stack(printingKey(name, set, number), where(), qty, extra);
  });

  async function csv() {
    const res = await app.request('/api/exports/collection.csv');
    expect(res.status).toBe(200);
    return { res, text: await res.text() };
  }

  it('sends a dated CSV attachment, one row per copy stack, ending with Location and Proxy', async () => {
    const { res, text } = await csv();
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="${collectionCsvFileName()}"`,
    );
    expect(collectionCsvFileName(new Date(2026, 9, 5, 23, 30))).toBe('rift-library-2026-10-05.csv');
    const [header, ...rows] = text.trimEnd().split('\n');
    expect(header).toBe(COLLECTION_CSV_COLUMNS.join(','));
    expect(COLLECTION_CSV_COLUMNS.slice(-2)).toEqual(['Location', 'Proxy']);
    // A location at a time in tree order: the inbox first, deck boxes last.
    expect(rows).toEqual([
      'Gilded Whelp,SOS,Set SOS,52,normal,rare,1,gilded-whelp-sos-52,,false,false,near_mint,en,,To sort,false',
      'Sun Disc,EOC,Set EOC,57,normal,rare,1,sun-disc-eoc-57,,true,true,near_mint,en,,Long box,true',
      'Ember Signet,EOC,Set EOC,53,normal,rare,2,ember-signet-eoc-53,0.85,false,false,near_mint,en,USD,Long box › Lands,false',
      'Unbound Volley,EOC,Set EOC,93,foil,rare,1,unbound-volley-eoc-93,,false,false,lightly_played,de,,Long box › Lands,false',
      'Ember Signet,FIC,Set FIC,332,foil,rare,1,ember-signet-fic-332,,false,false,near_mint,en,,Trade binder,false',
      '"Jinx, Loose Cannon",EOC,Set EOC,1,normal,rare,1,jinx-loose-cannon-eoc-1,,false,false,near_mint,en,,Jinx Burn deck box,false',
    ]);
  });

  it('reads back with Papa Parse into the same stacks, locations and proxies', async () => {
    const parsed = Papa.parse<Record<(typeof COLLECTION_CSV_COLUMNS)[number], string>>(
      (await csv()).text,
      { header: true, skipEmptyLines: true },
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.meta.fields).toEqual([...COLLECTION_CSV_COLUMNS]);
    const read = parsed.data.map((row) => [
      row['Printing ID'],
      Number(row.Quantity),
      row.Foil === 'normal' ? 'normal' : row.Foil,
      row.Condition,
      row.Language,
      row.Misprint === 'true',
      row.Altered === 'true',
      row['Purchase price'] === '' ? null : Number(row['Purchase price']),
      row['Purchase price currency'] || null,
      row.Proxy === 'true',
      row.Location,
    ]);
    const paths: Record<number, string> = {
      [inbox]: 'To sort',
      [longBox]: 'Long box',
      [lands]: 'Long box › Lands',
      [trade]: 'Trade binder',
      [deckBox]: 'Jinx Burn deck box',
    };
    const written = db
      .select()
      .from(copyStacks)
      .all()
      .map((s) => [
        s.printingId,
        s.quantity,
        s.finish,
        s.condition,
        s.language,
        s.misprint,
        s.altered,
        s.purchasePrice,
        s.purchaseCurrency,
        s.isProxy,
        paths[s.locationId],
      ]);
    expect(read.sort()).toEqual(written.sort());
    expect(parsed.data.map((row) => row.Name)).toContain('Jinx, Loose Cannon');
  });

  it('writes only the header for an empty collection', async () => {
    db.delete(copyStacks).run();
    expect((await csv()).text).toBe(`${COLLECTION_CSV_COLUMNS.join(',')}\n`);
  });
});
