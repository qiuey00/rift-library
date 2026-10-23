import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import {
  binderMappings,
  cards,
  copyStacks,
  imports,
  locations,
  movementBatches,
  movements,
  printings,
} from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { lookupCards, ScryfallUnavailableError } from '../../src/server/scryfall/lookup';
import { matchManaBoxRows } from '../../src/server/services/imports/manabox-match';
import { type ManaBoxRow, parseManaBoxCsv } from '../../src/server/services/imports/manabox-parse';
import { PREVIEW_LIFETIME_MS } from '../../src/server/services/imports/previews';
import { ErrorBody } from '../../src/shared/api/common';
import {
  type ManaBoxApplyRequest,
  ManaBoxApplyResult,
  ManaBoxPreview,
} from '../../src/shared/api/manabox';

vi.mock('../../src/server/scryfall/lookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/server/scryfall/lookup')>()),
  lookupCards: vi.fn(),
}));
const lookup = vi.mocked(lookupCards);

const fixtures = path.join(import.meta.dirname, '..', 'fixtures');
const SAMPLE = readFileSync(path.join(fixtures, 'manabox-sample.csv'), 'utf8');
const BINDERS = readFileSync(path.join(fixtures, 'manabox-binders.csv'), 'utf8');

// The two rows of Jeff's sample that Scryfall doesn't know.
const SYLVAN_LIBRARY = '26a7c62c-12ed-493c-ba95-0f55fec83686';
const FOLLOW_THE_LUMARETS = 'f9488480-2b6c-40bc-a93e-29fb1292a2e4';
const ORACLE = '00000000-0000-4000-8000-000000000001';

let db: OpenDb;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  db.insert(cards)
    .values({
      oracleId: ORACLE,
      name: 'Test card',
      frontFaceName: 'Test card',
      typeLine: 'Instant',
      commanderLegality: 'legal',
    })
    .run();
  lookup.mockReset();
  lookup.mockImplementation(async (_db, identifiers) => ({ resolved: [], not_found: identifiers }));
});

afterEach(() => {
  vi.useRealTimers();
});

function addPrinting(
  scryfallId: string,
  setCode = 'tst',
  collectorNumber = scryfallId,
  lang = 'en',
) {
  db.insert(printings)
    .values({
      scryfallId,
      oracleId: ORACLE,
      setCode,
      setName: 'Test set',
      collectorNumber,
      lang,
      finishes: ['nonfoil', 'foil', 'etched'],
      rarity: 'rare',
      releasedAt: '2026-01-01',
    })
    .onConflictDoNothing()
    .run();
}

/** Puts every printing a file names into the card data, except the ones given. */
function knowPrintings(csv: string, except: string[] = []) {
  for (const row of parseManaBoxCsv(csv).rows) {
    if (row.scryfallId && !except.includes(row.scryfallId)) addPrinting(row.scryfallId);
  }
}

function addLocation(name: string, type: 'binder' | 'box' | 'deck_box' = 'binder') {
  return db.insert(locations).values({ name, type }).returning({ id: locations.id }).get().id;
}

async function preview(csv: string, fileName = 'manabox.csv') {
  const form = new FormData();
  form.append('file', new File([csv], fileName, { type: 'text/csv' }));
  return app.request('/api/imports/manabox/preview', { method: 'POST', body: form });
}

async function previewOk(csv: string, fileName?: string) {
  const res = await preview(csv, fileName);
  expect(res.status).toBe(200);
  return ManaBoxPreview.parse(await res.json());
}

function apply(body: Partial<ManaBoxApplyRequest> & { previewId: string }) {
  return app.request('/api/imports/manabox/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ allProxies: false, fixes: {}, skips: [], ...body }),
  });
}

async function applyOk(body: Partial<ManaBoxApplyRequest> & { previewId: string }) {
  const res = await apply(body);
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(200);
  return ManaBoxApplyResult.parse(json);
}

async function errorOf(res: Response) {
  return { status: res.status, code: ErrorBody.parse(await res.json()).error.code };
}

const inbox = () =>
  db.select().from(locations).where(eq(locations.type, 'inbox')).get()?.id as number;

const totalIn = (locationId: number) =>
  db
    .select()
    .from(copyStacks)
    .where(eq(copyStacks.locationId, locationId))
    .all()
    .reduce((sum, stack) => sum + stack.quantity, 0);

describe('ManaBox add copies preview', () => {
  it("counts Jeff's sample and lists the rows Scryfall doesn't know", async () => {
    knowPrintings(SAMPLE, [SYLVAN_LIBRARY, FOLLOW_THE_LUMARETS]);
    const result = await previewOk(SAMPLE, 'manabox-sample.csv');

    expect(result).toMatchObject({
      fileName: 'manabox-sample.csv',
      hasBinderColumn: false,
      hasProxyColumn: false,
      rowCount: 258,
      cardCount: 389,
      binders: [],
      invalidRows: [],
      lookupFailed: false,
    });
    expect(result.unknownRows).toEqual([
      {
        row: 27,
        name: 'Sylvan Library',
        setCode: 'SPG',
        collectorNumber: '155',
        scryfallId: SYLVAN_LIBRARY,
        quantity: 1,
      },
      {
        row: 231,
        name: 'Follow the Lumarets',
        setCode: 'SOS',
        collectorNumber: '148',
        scryfallId: FOLLOW_THE_LUMARETS,
        quantity: 2,
      },
    ]);
    // Only the unknown rows go to Scryfall, once each.
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0]?.[1]).toEqual([
      { id: SYLVAN_LIBRARY },
      { id: FOLLOW_THE_LUMARETS },
    ]);
    // The preview writes nothing.
    expect(db.select().from(copyStacks).all()).toHaveLength(0);
    expect(db.select().from(imports).all()).toHaveLength(0);
  });

  it('keeps rows Scryfall finds out of the unknown rows', async () => {
    knowPrintings(SAMPLE, [SYLVAN_LIBRARY, FOLLOW_THE_LUMARETS]);
    lookup.mockImplementation(async (_db, identifiers) => {
      addPrinting(SYLVAN_LIBRARY);
      return {
        resolved: [
          { identifier: { id: SYLVAN_LIBRARY }, scryfallId: SYLVAN_LIBRARY, oracleId: ORACLE },
        ],
        not_found: identifiers.filter((id) => !('id' in id && id.id === SYLVAN_LIBRARY)),
      };
    });
    const result = await previewOk(SAMPLE);
    expect(result.unknownRows.map((row) => row.row)).toEqual([231]);

    const applied = await applyOk({ previewId: result.previewId, skips: [231] });
    expect(applied.cardCount).toBe(387);
  });

  it('sets lookupFailed when Scryfall is unreachable', async () => {
    knowPrintings(SAMPLE, [SYLVAN_LIBRARY, FOLLOW_THE_LUMARETS]);
    lookup.mockRejectedValue(new ScryfallUnavailableError());
    const result = await previewOk(SAMPLE);
    expect(result.lookupFailed).toBe(true);
    expect(result.unknownRows.map((row) => row.row)).toEqual([27, 231]);
  });

  it('finds rows without a Scryfall ID by set code and collector number', async () => {
    addPrinting('english', 'sos', '148', 'en');
    addPrinting('japanese', 'sos', '148', 'ja');
    const csv = [
      'Name,Set code,Collector number,Foil,Quantity,Scryfall ID,Misprint,Altered,Condition,Language',
      'Follow the Lumarets,SOS,148,normal,1,,false,false,near_mint,ja',
      'Follow the Lumarets,SOS,148,normal,2,,false,false,near_mint,de',
      'Lightning Bolt,XYZ,999,normal,1,,false,false,near_mint,en',
    ].join('\n');
    const result = await previewOk(csv);
    expect(result.unknownRows).toEqual([
      {
        row: 4,
        name: 'Lightning Bolt',
        setCode: 'XYZ',
        collectorNumber: '999',
        scryfallId: null,
        quantity: 1,
      },
    ]);
    expect(lookup.mock.calls[0]?.[1]).toEqual([{ set: 'XYZ', collector_number: '999' }]);

    await applyOk({ previewId: result.previewId, skips: [4] });
    const stacks = db.select().from(copyStacks).all();
    expect(stacks.map((stack) => [stack.scryfallId, stack.language, stack.quantity])).toEqual([
      ['japanese', 'ja', 1],
      ['english', 'de', 2],
    ]);
  });

  it('lists invalid rows with their reason and skips them', async () => {
    addPrinting('good');
    addPrinting('bad');
    const csv = [
      'Name,Set code,Collector number,Foil,Quantity,Scryfall ID,Misprint,Altered,Condition,Language',
      'Arcane Signet,EOC,1,normal,2,good,false,false,near_mint,en',
      'Counterspell,MH2,267,normal,abc,bad,false,false,near_mint,en',
    ].join('\n');
    const result = await previewOk(csv);
    expect(result.rowCount).toBe(2);
    expect(result.invalidRows).toEqual([
      {
        row: 3,
        name: 'Counterspell',
        setCode: 'MH2',
        collectorNumber: '267',
        reason: expect.stringContaining('Quantity "abc"'),
      },
    ]);
    const applied = await applyOk({ previewId: result.previewId });
    expect(applied).toMatchObject({ cardCount: 2, skippedCount: 1 });
    expect(db.select().from(imports).get()).toMatchObject({ rowCount: 2, skippedCount: 1 });
  });

  it('answers a file without the ManaBox columns with 400 missing_columns', async () => {
    expect(await errorOf(await preview('Name,Count\nSol Ring,1'))).toEqual({
      status: 400,
      code: 'missing_columns',
    });
  });
});

describe('ManaBox add copies apply', () => {
  async function sampleApplied(body: Partial<ManaBoxApplyRequest> = {}) {
    const { previewId } = await previewOk(SAMPLE, 'manabox-sample.csv');
    return applyOk({ previewId, skips: [27, 231], ...body });
  }

  beforeEach(() => {
    knowPrintings(SAMPLE, [SYLVAN_LIBRARY, FOLLOW_THE_LUMARETS]);
  });

  it('adds the copies to the "To sort" inbox with one imports row and one batch', async () => {
    const result = await sampleApplied();
    expect(result).toMatchObject({
      message: 'Added 386 cards to To sort',
      cardCount: 386,
      skippedCount: 2,
    });
    expect(totalIn(inbox())).toBe(386);

    expect(db.select().from(imports).all()).toEqual([
      expect.objectContaining({
        id: result.importId,
        kind: 'manabox_add',
        fileName: 'manabox-sample.csv',
        targetLocationId: inbox(),
        rowCount: 258,
        cardCount: 386,
        skippedCount: 2,
      }),
    ]);
    expect(db.select().from(movementBatches).all()).toEqual([
      expect.objectContaining({ id: result.batchId, kind: 'import', importId: result.importId }),
    ]);
    const moved = db.select().from(movements).all();
    expect(moved.every((m) => m.reason === 'imported' && m.batchId === result.batchId)).toBe(true);
    expect(moved.reduce((sum, m) => sum + m.quantity, 0)).toBe(386);
  });

  it('adds the copies again when the same file is imported twice', async () => {
    await sampleApplied();
    const stacksAfterOne = db.select().from(copyStacks).all();
    await sampleApplied();
    const stacksAfterTwo = db.select().from(copyStacks).all();

    expect(stacksAfterTwo).toHaveLength(stacksAfterOne.length);
    for (const stack of stacksAfterTwo) {
      const before = stacksAfterOne.find((s) => s.id === stack.id);
      expect(stack.quantity).toBe((before?.quantity ?? 0) * 2);
    }
    expect(totalIn(inbox())).toBe(772);
    expect(db.select().from(imports).all()).toHaveLength(2);
  });

  it('imports into the chosen location', async () => {
    const shelf = addLocation('Shelf box', 'box');
    const result = await sampleApplied({ targetLocationId: shelf });
    expect(result.message).toBe('Added 386 cards to Shelf box');
    expect(totalIn(shelf)).toBe(386);
  });

  it('marks every row as proxy only when allProxies is ticked', async () => {
    await sampleApplied();
    expect(
      db
        .select()
        .from(copyStacks)
        .all()
        .some((stack) => stack.isProxy),
    ).toBe(false);
    await sampleApplied({ allProxies: true });
    const proxies = db.select().from(copyStacks).where(eq(copyStacks.isProxy, true)).all();
    expect(proxies.reduce((sum, stack) => sum + stack.quantity, 0)).toBe(386);
  });

  it('counts fixes as added and skips as skipped', async () => {
    addPrinting('picked-printing');
    const result = await sampleApplied({ fixes: { 27: 'picked-printing' }, skips: [231] });
    expect(result).toMatchObject({ cardCount: 387, skippedCount: 1 });
    expect(
      db.select().from(copyStacks).where(eq(copyStacks.scryfallId, 'picked-printing')).get(),
    ).toMatchObject({ quantity: 1, locationId: inbox() });
  });

  it('refuses rows left unknown, and a fix to a printing the app lacks', async () => {
    const { previewId } = await previewOk(SAMPLE);
    expect(await errorOf(await apply({ previewId, skips: [27] }))).toEqual({
      status: 400,
      code: 'unknown_rows',
    });
    expect(await errorOf(await apply({ previewId, fixes: { 27: 'nope' }, skips: [231] }))).toEqual({
      status: 404,
      code: 'printing_not_found',
    });
    // Nothing was written, and the preview can still be applied.
    expect(db.select().from(copyStacks).all()).toHaveLength(0);
    await applyOk({ previewId, skips: [27, 231] });
  });

  it('answers 410 preview_expired once applied, or after an hour', async () => {
    const { previewId } = await previewOk(SAMPLE);
    await applyOk({ previewId, skips: [27, 231] });
    expect(await errorOf(await apply({ previewId, skips: [27, 231] }))).toEqual({
      status: 410,
      code: 'preview_expired',
    });

    vi.useFakeTimers({ toFake: ['Date'] });
    const old = await previewOk(SAMPLE);
    vi.setSystemTime(Date.now() + PREVIEW_LIFETIME_MS + 1);
    expect(await errorOf(await apply({ previewId: old.previewId, skips: [27, 231] }))).toEqual({
      status: 410,
      code: 'preview_expired',
    });
    expect(await errorOf(await apply({ previewId: 'never-made' }))).toEqual({
      status: 410,
      code: 'preview_expired',
    });
  });
});

describe('ManaBox add copies with binders', () => {
  beforeEach(() => {
    knowPrintings(BINDERS);
  });

  it('lists each binder, deck and list with its counts', async () => {
    const result = await previewOk(BINDERS);
    expect(result).toMatchObject({ hasBinderColumn: true, hasProxyColumn: true, rowCount: 10 });
    expect(result.binders).toEqual([
      {
        key: 'binder:Main binder',
        name: 'Main binder',
        type: 'binder',
        rowCount: 3,
        cardCount: 3,
        mappedLocation: null,
      },
      {
        key: 'binder:Trade binder',
        name: 'Trade binder',
        type: 'binder',
        rowCount: 2,
        cardCount: 3,
        mappedLocation: null,
      },
      {
        key: 'deck:Hearthhull',
        name: 'Hearthhull',
        type: 'deck',
        rowCount: 3,
        cardCount: 3,
        mappedLocation: null,
      },
      {
        key: 'list:Wishlist',
        name: 'Wishlist',
        type: 'list',
        rowCount: 2,
        cardCount: 5,
        mappedLocation: null,
      },
    ]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('puts rows in their mapped or new locations, skips list rows and remembers the mapping', async () => {
    const main = addLocation('Main binder');
    const { previewId } = await previewOk(BINDERS);
    const result = await applyOk({
      previewId,
      destinations: { 'binder:Main binder': main },
      newLocations: {
        'binder:Trade binder': { name: 'Trade binder', type: 'binder' },
        'deck:Hearthhull': { name: 'Hearthhull box', type: 'deck_box' },
      },
    });
    expect(result).toMatchObject({
      message: 'Added 9 cards to 3 locations',
      cardCount: 9,
      skippedCount: 2,
    });

    const trade = db.select().from(locations).where(eq(locations.name, 'Trade binder')).get();
    const box = db.select().from(locations).where(eq(locations.name, 'Hearthhull box')).get();
    expect(totalIn(main)).toBe(3);
    expect(totalIn(trade?.id ?? 0)).toBe(3);
    expect(totalIn(box?.id ?? 0)).toBe(3);
    expect(totalIn(inbox())).toBe(0);
    expect(db.select().from(imports).get()?.targetLocationId).toBeNull();

    // The Proxy column decides, whatever allProxies says.
    const proxies = db.select().from(copyStacks).where(eq(copyStacks.isProxy, true)).all();
    expect(proxies.map((stack) => stack.scryfallId).sort()).toEqual([
      '5a0bc9d4-d99d-48e1-aeca-d2e5b1c99a84',
      '7eb9e83d-515d-4911-a06b-9982200277b2',
    ]);

    expect(db.select().from(binderMappings).all()).toHaveLength(3);
    const next = await previewOk(BINDERS);
    expect(next.binders.map((binder) => binder.mappedLocation?.id ?? null)).toEqual([
      main,
      trade?.id,
      box?.id,
      null,
    ]);
    expect(next.binders[1]?.mappedLocation).toMatchObject({ name: 'Trade binder', type: 'binder' });

    // A changed mapping replaces the remembered one.
    const other = addLocation('Other binder');
    await applyOk({
      previewId: next.previewId,
      allProxies: true,
      destinations: {
        'binder:Main binder': other,
        'binder:Trade binder': trade?.id ?? 0,
        'deck:Hearthhull': box?.id ?? 0,
      },
    });
    expect((await previewOk(BINDERS)).binders[0]?.mappedLocation?.id).toBe(other);
  });

  it('names the location when every binder goes to one place', async () => {
    const shelf = addLocation('Shelf');
    const { previewId } = await previewOk(BINDERS);
    const result = await applyOk({
      previewId,
      destinations: {
        'binder:Main binder': shelf,
        'binder:Trade binder': shelf,
        'deck:Hearthhull': shelf,
      },
    });
    expect(result.message).toBe('Added 9 cards to Shelf');
    expect(db.select().from(imports).get()?.targetLocationId).toBe(shelf);
  });

  it('refuses a binder without a destination', async () => {
    const shelf = addLocation('Shelf');
    const { previewId } = await previewOk(BINDERS);
    const res = await apply({
      previewId,
      destinations: { 'binder:Main binder': shelf, 'binder:Trade binder': shelf },
    });
    expect(await errorOf(res)).toEqual({ status: 400, code: 'missing_destination' });
    expect(db.select().from(copyStacks).all()).toHaveLength(0);
    expect(db.select().from(binderMappings).all()).toHaveLength(0);
  });
});

describe('matchManaBoxRows', () => {
  it('reports the rows it found by their parser row number', async () => {
    addPrinting('known');
    const csv = [
      'Name,Set code,Collector number,Foil,Quantity,Scryfall ID,Misprint,Altered,Condition,Language',
      'A,TST,1,normal,1,known,false,false,near_mint,en',
      'B,TST,2,normal,1,unknown,false,false,near_mint,en',
    ].join('\n');
    const rows = parseManaBoxCsv(csv).rows as ManaBoxRow[];
    const match = await matchManaBoxRows(db, rows);
    expect([...match.matched]).toEqual([[1, 'known']]);
    expect(match.unknown.map((row) => row.row)).toEqual([2]);
    expect(match.lookupFailed).toBe(false);
  });
});
