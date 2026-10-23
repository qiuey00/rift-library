import { eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import {
  cards,
  copyStacks,
  deckSlots,
  deckSlotTags,
  decks,
  locations,
  printings,
} from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { tagKey } from '../../src/server/services/decks';
import { collectionCsvFileName } from '../../src/server/services/exports/collection-csv';
import { moxfieldLine } from '../../src/server/services/exports/moxfield-format';
import { type ManaBoxRow, parseManaBoxCsv } from '../../src/server/services/imports/manabox-parse';
import { mergeSlots, parseMoxfieldText } from '../../src/server/services/imports/moxfield-parse';
import type { Finish } from '../../src/shared/api/common';
import { ErrorBody } from '../../src/shared/api/common';
import { COLLECTION_CSV_COLUMNS, MoxfieldExport } from '../../src/shared/api/exports';

const client = hc<AppType>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;
let inbox: number;
let longBox: number;
let lands: number;
let trade: number;
let deckBox: number;
let deckId: number;

function location(name: string, type: typeof locations.$inferInsert.type, parentId?: number) {
  return db.insert(locations).values({ name, type, parentId }).returning({ id: locations.id }).get()
    .id;
}

/** A card with one printing per entry, such as ['eoc', '53']. */
function card(name: string, ...sets: [setCode: string, collectorNumber: string][]) {
  const oracleId = `oracle-${name}`;
  db.insert(cards)
    .values({
      oracleId,
      name,
      frontFaceName: name.split(' // ')[0],
      typeLine: 'Card',
      commanderLegality: 'legal',
      isBasicLand: name === 'Forest',
    })
    .run();
  for (const [setCode, collectorNumber] of sets) {
    db.insert(printings)
      .values({
        scryfallId: printingId(name, setCode, collectorNumber),
        oracleId,
        setCode,
        setName: `Set ${setCode.toUpperCase()}`,
        collectorNumber,
        lang: 'en',
        finishes: ['nonfoil', 'foil', 'etched'],
        rarity: 'rare',
        releasedAt: '2025-08-01',
      })
      .run();
  }
}

const printingId = (name: string, setCode: string, collectorNumber: string) =>
  `${name}-${setCode}-${collectorNumber}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function stack(
  scryfallId: string,
  locationId: number,
  quantity: number,
  extra: Partial<typeof copyStacks.$inferInsert> = {},
) {
  db.insert(copyStacks)
    .values({
      scryfallId,
      quantity,
      finish: 'nonfoil',
      condition: 'near_mint',
      language: 'en',
      locationId,
      ...extra,
    })
    .run();
}

function slot(values: Omit<typeof deckSlots.$inferInsert, 'deckId'>, tags: string[] = []) {
  const id = db
    .insert(deckSlots)
    .values({ deckId, ...values })
    .returning({ id: deckSlots.id })
    .get().id;
  for (const tag of tags)
    db.insert(deckSlotTags)
      .values({ slotId: id, tag, tagKey: tagKey(tag) })
      .run();
  return id;
}

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  inbox = db.select().from(locations).where(eq(locations.type, 'inbox')).get()?.id ?? 0;
  longBox = location('Long box', 'box');
  lands = location('Lands', 'box', longBox);
  trade = location('Trade binder', 'binder');
  deckBox = location('Hearthhull deck box', 'deck_box');
  deckId = db
    .insert(decks)
    .values({ name: 'Hearthhull: lands/ramp', deckBoxId: deckBox })
    .returning({ id: decks.id })
    .get().id;

  card('Hearthhull, the Worldseed', ['eoc', '1']);
  card('Arcane Signet', ['eoc', '53'], ['fic', '332']);
  card('Augur of Autumn', ['eoc', '92']);
  card('Beast Within', ['eoc', '93']);
  card('Cultivate', ['eoc', '95']);
  card('Forest', ['eoe', '276']);
  card('Harmonized Trio // Brainstorm', ['sos', '52']);
  card('Groundskeeper', ['eoc', '97']);
  card('Sol Ring', ['eoc', '57']);
});

afterEach(() => db.$client.close());

/** The Hearthhull deck with a pulled commander, hints, tags, basics and a maybe board. */
function buildDeck() {
  const etchedSignet = printingId('Arcane Signet', 'fic', '332');
  slot(
    {
      oracleId: 'oracle-Hearthhull, the Worldseed',
      board: 'commander',
      quantity: 1,
      pickedScryfallId: printingId('Hearthhull, the Worldseed', 'eoc', '1'),
    },
    ['Commander'],
  );
  stack(printingId('Hearthhull, the Worldseed', 'eoc', '1'), deckBox, 1, { finish: 'foil' });
  // Picked: the picked printing wins over the hint, and its copies in the box give the finish.
  slot(
    {
      oracleId: 'oracle-Arcane Signet',
      board: 'main',
      quantity: 1,
      pickedScryfallId: etchedSignet,
      hintSetCode: 'EOC',
      hintCollectorNumber: '53',
    },
    ['Ramp'],
  );
  stack(etchedSignet, deckBox, 1, { finish: 'etched' });
  slot(
    {
      oracleId: 'oracle-Augur of Autumn',
      board: 'main',
      quantity: 1,
      hintSetCode: 'EOC',
      hintCollectorNumber: '92',
    },
    ['Ramp', 'Card  draw'],
  );
  slot({
    oracleId: 'oracle-Beast Within',
    board: 'main',
    quantity: 1,
    hintSetCode: 'EOC',
    hintCollectorNumber: '93',
    hintFoil: true,
  });
  // No printing at all.
  slot({ oracleId: 'oracle-Cultivate', board: 'main', quantity: 1 });
  slot({
    oracleId: 'oracle-Forest',
    board: 'main',
    quantity: 8,
    hintSetCode: 'EOE',
    hintCollectorNumber: '276',
  });
  slot(
    {
      oracleId: 'oracle-Groundskeeper',
      board: 'maybe',
      quantity: 1,
      hintSetCode: 'EOC',
      hintCollectorNumber: '97',
    },
    ['Lands'],
  );
}

async function deckExport(query: { tags?: '0' | '1'; maybe?: '0' | '1' } = {}) {
  const res = await client.exports.decks[':id'].moxfield.$get({
    param: { id: String(deckId) },
    query,
  });
  expect(res.status).toBe(200);
  return MoxfieldExport.parse(await res.json());
}

describe('the Moxfield line format', () => {
  it('writes the quantity, name, printing, finish and tags as Moxfield does', () => {
    expect(
      moxfieldLine({
        quantity: 1,
        name: 'Beast Whisperer',
        printing: { setCode: 'fdc', collectorNumber: '189' },
        finish: 'nonfoil',
        tags: ['draw'],
      }),
    ).toBe('1 Beast Whisperer (FDC) 189 #draw');
    expect(moxfieldLine({ quantity: 2, name: 'Sol Ring', printing: null, finish: 'foil' })).toBe(
      '2 Sol Ring *F*',
    );
    expect(
      moxfieldLine({
        quantity: 1,
        name: 'Adeline, Resplendent Cathar',
        printing: { setCode: 'J25', collectorNumber: '57' },
        finish: 'nonfoil',
        tags: ['Token   Maker', 'Card draw'],
      }),
    ).toBe('1 Adeline, Resplendent Cathar (J25) 57 #token-maker #card-draw');
  });
});

describe('GET /api/exports/decks/:id/moxfield', () => {
  beforeEach(buildDeck);

  it('writes the commander, then the main deck by name, then SIDEBOARD: and the maybe board', async () => {
    const file = await deckExport();
    expect(file.text).toBe(
      [
        '1 Hearthhull, the Worldseed (EOC) 1 *F* #commander',
        '1 Arcane Signet (FIC) 332 *E* #ramp',
        '1 Augur of Autumn (EOC) 92 #card-draw #ramp',
        '1 Beast Within (EOC) 93 *F*',
        '1 Cultivate',
        '8 Forest (EOE) 276',
        '',
        'SIDEBOARD:',
        '1 Groundskeeper (EOC) 97 #lands',
        '',
      ].join('\n'),
    );
    expect(file).toMatchObject({
      fileName: 'Hearthhull- lands-ramp.txt',
      cardCount: 13,
      maybeCount: 1,
      lineCount: 7,
    });
  });

  it('leaves out tags with tags=0 and the maybe board with maybe=0', async () => {
    const file = await deckExport({ tags: '0', maybe: '0' });
    expect(file.text).not.toContain('#');
    expect(file.text).not.toContain('SIDEBOARD:');
    expect(file.text).not.toContain('Groundskeeper');
    expect(file).toMatchObject({ cardCount: 13, maybeCount: 0, lineCount: 6 });
  });

  it('leaves out SIDEBOARD: when the maybe board is empty', async () => {
    db.delete(deckSlots).where(eq(deckSlots.board, 'maybe')).run();
    const file = await deckExport();
    expect(file.text).not.toContain('SIDEBOARD:');
    expect(file.text.endsWith('8 Forest (EOE) 276\n')).toBe(true);
  });

  it('sends the same text as a .txt attachment', async () => {
    const res = await app.request(`/api/exports/decks/${deckId}/moxfield.txt?tags=0`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="Hearthhull- lands-ramp.txt"',
    );
    expect(await res.text()).toBe((await deckExport({ tags: '0' })).text);
  });

  it('answers 404 for a deleted or unknown deck, and 400 for a query it can’t read', async () => {
    db.update(decks).set({ deletedAt: '2026-10-20T00:00:00.000Z' }).run();
    for (const url of [
      `/api/exports/decks/${deckId}/moxfield`,
      '/api/exports/decks/99/moxfield.txt',
    ]) {
      const res = await app.request(url);
      expect(res.status).toBe(404);
      expect(ErrorBody.parse(await res.json()).error.code).toBe('deck_not_found');
    }
    expect((await app.request(`/api/exports/decks/${deckId}/moxfield?tags=yes`)).status).toBe(400);
  });

  it('reads back through the Moxfield import with the same cards, quantities, boards, hints and tags', async () => {
    const file = await deckExport();
    const parsed = parseMoxfieldText(file.text);
    expect(parsed.format).toBe('sets');
    expect(parsed.lines.filter((line) => line.kind === 'invalid')).toEqual([]);
    const slots = mergeSlots(parsed.lines, (name) => name === 'Forest');
    expect(
      slots.map((s) => [
        s.name,
        s.isCommanderProposal ? 'commander' : s.board,
        s.quantity,
        s.setCode ?? null,
        s.collectorNumber ?? null,
        s.foil,
        s.tags,
      ]),
    ).toEqual([
      ['Hearthhull, the Worldseed', 'commander', 1, 'EOC', '1', true, ['commander']],
      ['Arcane Signet', 'main', 1, 'FIC', '332', false, ['ramp']],
      ['Augur of Autumn', 'main', 1, 'EOC', '92', false, ['card-draw', 'ramp']],
      ['Beast Within', 'main', 1, 'EOC', '93', true, []],
      ['Cultivate', 'main', 1, null, null, false, []],
      ['Forest', 'main', 8, 'EOE', '276', false, []],
      ['Groundskeeper', 'maybe', 1, 'EOC', '97', false, ['lands']],
    ]);
    // Read back as the deck saves them, each tag lands on its tag key again.
    for (const s of slots) for (const tag of s.tags) expect(tagKey(tag)).toBe(tag);
  });
});

describe('GET /api/exports/locations/:id/moxfield', () => {
  beforeEach(() => {
    const signet = printingId('Arcane Signet', 'eoc', '53');
    stack(signet, trade, 2);
    stack(signet, trade, 1, { condition: 'lightly_played' });
    stack(signet, trade, 1, { finish: 'foil' });
    stack(printingId('Sol Ring', 'eoc', '57'), trade, 3, { isProxy: true });
    const inside = location('Trade binder page 2', 'binder', trade);
    stack(signet, inside, 4);
    stack(printingId('Harmonized Trio // Brainstorm', 'sos', '52'), inside, 13);
    stack(printingId('Beast Within', 'eoc', '93'), longBox, 1);
  });

  it('adds up each printing and finish in the location and inside it, leaving out proxies', async () => {
    const res = await client.exports.locations[':id'].moxfield.$get({
      param: { id: String(trade) },
    });
    expect(res.status).toBe(200);
    expect(MoxfieldExport.parse(await res.json())).toEqual({
      fileName: 'Trade binder.txt',
      text: [
        '7 Arcane Signet (EOC) 53',
        '1 Arcane Signet (EOC) 53 *F*',
        '13 Harmonized Trio // Brainstorm (SOS) 52',
        '',
      ].join('\n'),
      cardCount: 21,
      maybeCount: 0,
      lineCount: 3,
    });
  });

  it('works for any location, and sends a .txt attachment', async () => {
    const res = await app.request(`/api/exports/locations/${longBox}/moxfield.txt`);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Long box.txt"');
    expect(await res.text()).toBe('1 Beast Within (EOC) 93\n');
  });

  it('answers 404 location_not_found for an unknown or deleted location', async () => {
    const gone = location('Old box', 'box');
    db.update(locations)
      .set({ deletedAt: '2026-10-20T00:00:00.000Z' })
      .where(eq(locations.id, gone))
      .run();
    for (const id of [gone, 999]) {
      const res = await app.request(`/api/exports/locations/${id}/moxfield`);
      expect(res.status).toBe(404);
      expect(ErrorBody.parse(await res.json()).error.code).toBe('location_not_found');
    }
  });
});

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
    ['Harmonized Trio // Brainstorm', 'sos', '52', () => inbox, 1],
    [
      'Arcane Signet',
      'eoc',
      '53',
      () => lands,
      2,
      { purchasePrice: 0.85, purchaseCurrency: 'USD' },
    ],
    [
      'Beast Within',
      'eoc',
      '93',
      () => lands,
      1,
      { finish: 'foil' as Finish, condition: 'lightly_played', language: 'de' },
    ],
    ['Sol Ring', 'eoc', '57', () => longBox, 1, { isProxy: true, misprint: true, altered: true }],
    ['Arcane Signet', 'fic', '332', () => trade, 1, { finish: 'etched' as Finish }],
    ['Hearthhull, the Worldseed', 'eoc', '1', () => deckBox, 1, { cameFromLocationId: longBox }],
  ];
  beforeEach(() => {
    for (const [name, set, number, where, qty, extra] of stacks)
      stack(printingId(name, set, number), where(), qty, extra);
  });

  async function csv() {
    const res = await app.request('/api/exports/collection.csv');
    expect(res.status).toBe(200);
    return { res, text: await res.text() };
  }

  it('sends a dated CSV attachment with ManaBox’s columns, then Binder Name, Binder Type and Proxy', async () => {
    const { res, text } = await csv();
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="${collectionCsvFileName()}"`,
    );
    expect(collectionCsvFileName(new Date(2026, 9, 5, 23, 30))).toBe('rift-library-2026-10-05.csv');
    const [header, ...rows] = text.trimEnd().split('\n');
    expect(header).toBe(COLLECTION_CSV_COLUMNS.join(','));
    expect(COLLECTION_CSV_COLUMNS.slice(15)).toEqual(['Binder Name', 'Binder Type', 'Proxy']);
    // A location at a time in tree order: the inbox first, deck boxes last.
    expect(rows).toEqual([
      'Harmonized Trio // Brainstorm,SOS,Set SOS,52,normal,rare,1,,harmonized-trio-brainstorm-sos-52,,false,false,near_mint,en,,To sort,binder,false',
      'Sol Ring,EOC,Set EOC,57,normal,rare,1,,sol-ring-eoc-57,,true,true,near_mint,en,,Long box,binder,true',
      'Arcane Signet,EOC,Set EOC,53,normal,rare,2,,arcane-signet-eoc-53,0.85,false,false,near_mint,en,USD,Long box › Lands,binder,false',
      'Beast Within,EOC,Set EOC,93,foil,rare,1,,beast-within-eoc-93,,false,false,lightly_played,de,,Long box › Lands,binder,false',
      'Arcane Signet,FIC,Set FIC,332,etched,rare,1,,arcane-signet-fic-332,,false,false,near_mint,en,,Trade binder,binder,false',
      '"Hearthhull, the Worldseed",EOC,Set EOC,1,normal,rare,1,,hearthhull-the-worldseed-eoc-1,,false,false,near_mint,en,,Hearthhull deck box,binder,false',
    ]);
  });

  it('reads back through the ManaBox import with the same rows, binder names and proxies', async () => {
    const parsed = parseManaBoxCsv((await csv()).text);
    expect(parsed).toMatchObject({
      hasProxyColumn: true,
      hasBinderColumn: true,
      rowCount: 6,
      cardCount: 7,
    });
    const rows = parsed.rows.filter((row): row is ManaBoxRow => row.valid);
    expect(rows).toHaveLength(6);
    const read = rows.map((row) => [
      row.name,
      row.scryfallId,
      row.quantity,
      row.finish,
      row.condition,
      row.language,
      row.misprint,
      row.altered,
      row.purchasePrice,
      row.purchaseCurrency,
      row.isProxy,
      row.binderName,
      row.binderType,
    ]);
    const paths: Record<number, string> = {
      [inbox]: 'To sort',
      [longBox]: 'Long box',
      [lands]: 'Long box › Lands',
      [trade]: 'Trade binder',
      [deckBox]: 'Hearthhull deck box',
    };
    const written = db
      .select()
      .from(copyStacks)
      .all()
      .map((s) => [
        s.scryfallId,
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
        'binder',
      ]);
    expect(read.map(([, ...rest]) => rest).sort()).toEqual(written.sort());
    expect(read.map(([name]) => name)).toContain('Hearthhull, the Worldseed');
  });

  it('writes only the header for an empty collection', async () => {
    db.delete(copyStacks).run();
    expect((await csv()).text).toBe(`${COLLECTION_CSV_COLUMNS.join(',')}\n`);
  });
});
