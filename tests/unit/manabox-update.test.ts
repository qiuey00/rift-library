import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import {
  cards,
  copyStacks,
  decks,
  imports,
  locations,
  movementBatches,
  movements,
  printings,
} from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { lookupCards } from '../../src/server/scryfall/lookup';
import { ErrorBody } from '../../src/shared/api/common';
import {
  type ManaBoxUpdateApplyRequest,
  ManaBoxUpdateApplyResult,
  UpdatePreview,
} from '../../src/shared/api/manabox-update';

vi.mock('../../src/server/scryfall/lookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/server/scryfall/lookup')>()),
  lookupCards: vi.fn(),
}));
const lookup = vi.mocked(lookupCards);

const ORACLE = '00000000-0000-4000-8000-000000000001';
const ALPHA = '00000000-0000-4000-8000-00000000000a';
const BRAVO = '00000000-0000-4000-8000-00000000000b';
const CHARLIE = '00000000-0000-4000-8000-00000000000c';
const DELTA = '00000000-0000-4000-8000-00000000000d';
const ECHO = '00000000-0000-4000-8000-00000000000e';
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff';

let db: OpenDb;
let binder: number;
let shelf: number;
let deckBox: number;
let deckId: number;

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
  for (const id of [ALPHA, BRAVO, CHARLIE, DELTA, ECHO]) {
    db.insert(printings)
      .values({
        scryfallId: id,
        oracleId: ORACLE,
        setCode: 'tst',
        setName: 'Test set',
        collectorNumber: id.slice(-1),
        lang: 'en',
        finishes: ['nonfoil', 'foil'],
        rarity: 'rare',
        releasedAt: '2026-01-01',
      })
      .run();
  }
  binder = addLocation('Strixhaven binder', 'binder');
  shelf = addLocation('Shelf', 'box');
  deckBox = addLocation('Hearthhull box', 'deck_box');
  deckId = db
    .insert(decks)
    .values({ name: 'Hearthhull', deckBoxId: deckBox })
    .returning({ id: decks.id })
    .get().id;
  lookup.mockReset();
  lookup.mockImplementation(async (_db, identifiers) => ({ resolved: [], not_found: identifiers }));
});

function addLocation(name: string, type: 'binder' | 'box' | 'deck_box') {
  return db.insert(locations).values({ name, type }).returning({ id: locations.id }).get().id;
}

type StackInput = Partial<typeof copyStacks.$inferInsert> & {
  scryfallId: string;
  quantity: number;
  locationId: number;
};

function addStack(input: StackInput) {
  return db
    .insert(copyStacks)
    .values({ finish: 'nonfoil', condition: 'near_mint', language: 'en', ...input })
    .returning({ id: copyStacks.id })
    .get().id;
}

interface Row {
  id: string;
  quantity: number | string;
  foil?: 'normal' | 'foil';
  price?: string;
  proxy?: boolean;
  binderType?: 'binder' | 'list';
}

const HEADER =
  'Binder Name,Binder Type,Name,Set code,Collector number,Foil,Quantity,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency,Proxy';

function csv(rows: Row[]) {
  return [
    HEADER,
    ...rows.map((row) =>
      [
        'Strixhaven',
        row.binderType ?? 'binder',
        'Test card',
        'TST',
        row.id.slice(-1),
        row.foil ?? 'normal',
        row.quantity,
        row.id,
        row.price ?? '',
        'false',
        'false',
        'near_mint',
        'en',
        row.price ? 'USD' : '',
        row.proxy ? 'true' : 'false',
      ].join(','),
    ),
  ].join('\n');
}

async function preview(text: string, locationId = binder) {
  const form = new FormData();
  form.append('file', new File([text], 'binder.csv', { type: 'text/csv' }));
  form.append('locationId', String(locationId));
  return app.request('/api/imports/manabox/update-preview', { method: 'POST', body: form });
}

async function previewOk(text: string, locationId?: number) {
  const res = await preview(text, locationId);
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(200);
  return UpdatePreview.parse(json);
}

function apply(body: Partial<ManaBoxUpdateApplyRequest> & { previewId: string }) {
  return app.request('/api/imports/manabox/update-apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ removeFlagged: [], fixes: {}, skips: [], ...body }),
  });
}

async function applyOk(body: Partial<ManaBoxUpdateApplyRequest> & { previewId: string }) {
  const res = await apply(body);
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(200);
  return ManaBoxUpdateApplyResult.parse(json);
}

/** Preview the file and apply it straight away. */
async function update(text: string, body: Partial<ManaBoxUpdateApplyRequest> = {}) {
  const { previewId } = await previewOk(text);
  return applyOk({ previewId, ...body });
}

async function errorOf(res: Response) {
  return { status: res.status, code: ErrorBody.parse(await res.json()).error.code };
}

const stacksIn = (locationId: number) =>
  db
    .select()
    .from(copyStacks)
    .where(eq(copyStacks.locationId, locationId))
    .orderBy(copyStacks.id)
    .all();

const quantityOf = (locationId: number, scryfallId: string) =>
  stacksIn(locationId)
    .filter((stack) => stack.scryfallId === scryfallId)
    .reduce((sum, stack) => sum + stack.quantity, 0);

describe('ManaBox location update preview', () => {
  it('sorts every match key into its group and writes nothing', async () => {
    addStack({ scryfallId: BRAVO, quantity: 1, locationId: binder });
    addStack({ scryfallId: CHARLIE, quantity: 3, locationId: binder });
    addStack({ scryfallId: DELTA, quantity: 1, locationId: binder });
    addStack({ scryfallId: ECHO, quantity: 2, locationId: binder });
    // Another location's copies aren't the binder's.
    addStack({ scryfallId: ALPHA, quantity: 5, locationId: shelf });

    const result = await previewOk(
      csv([
        { id: ALPHA, quantity: 2 },
        { id: BRAVO, quantity: 2 },
        { id: CHARLIE, quantity: 1 },
        { id: ECHO, quantity: 2 },
      ]),
    );

    expect(result.location).toMatchObject({ id: binder, name: 'Strixhaven binder' });
    const summary = (rows: UpdatePreview['groups']['new']) =>
      rows.map((row) => [row.printing.scryfallId, row.fileQuantity, row.appQuantity]);
    expect(summary(result.groups.new)).toEqual([[ALPHA, 2, 0]]);
    expect(summary(result.groups.raised)).toEqual([[BRAVO, 2, 1]]);
    expect(summary(result.groups.lowered)).toEqual([[CHARLIE, 1, 3]]);
    expect(summary(result.groups.missing)).toEqual([[DELTA, 0, 1]]);
    expect(result.unchangedCount).toBe(1);
    expect(result.groups.new[0]).toMatchObject({
      key: `${ALPHA}:nonfoil:near_mint:en:0:0`,
      card: { name: 'Test card' },
      flagged: [],
    });
    expect(result.lookupFailed).toBe(false);

    expect(db.select().from(imports).all()).toHaveLength(0);
    expect(db.select().from(movements).all()).toHaveLength(0);
    expect(quantityOf(binder, CHARLIE)).toBe(3);
  });

  it('matches on finish too, not on the proxy flag or price', async () => {
    addStack({ scryfallId: ALPHA, quantity: 1, locationId: binder, isProxy: true });
    addStack({ scryfallId: ALPHA, quantity: 1, locationId: binder, purchasePrice: 9 });
    const result = await previewOk(
      csv([
        { id: ALPHA, quantity: 2, price: '1.00' },
        { id: ALPHA, quantity: 1, foil: 'foil' },
      ]),
    );
    expect(result.unchangedCount).toBe(1);
    expect(result.groups.new.map((row) => row.finish)).toEqual(['foil']);
  });

  it('counts deck-box copies that came from the location and flags removing them', async () => {
    addStack({ scryfallId: ALPHA, quantity: 1, locationId: binder });
    const boxed = addStack({
      scryfallId: ALPHA,
      quantity: 2,
      locationId: deckBox,
      cameFromLocationId: binder,
    });
    const missing = addStack({
      scryfallId: BRAVO,
      quantity: 1,
      locationId: deckBox,
      cameFromLocationId: binder,
    });
    // Came from somewhere else: not the binder's.
    addStack({ scryfallId: CHARLIE, quantity: 1, locationId: deckBox, cameFromLocationId: shelf });

    const result = await previewOk(csv([{ id: ALPHA, quantity: 1 }]));
    const deck = { id: deckId, name: 'Hearthhull' };
    // Lowered by 2: the binder's own copy first, then one from the deck box.
    expect(result.groups.lowered).toMatchObject([
      { fileQuantity: 1, appQuantity: 3, flagged: [{ stackId: boxed, deck, quantity: 1 }] },
    ]);
    expect(result.groups.missing).toMatchObject([
      { appQuantity: 1, flagged: [{ stackId: missing, deck, quantity: 1 }] },
    ]);
    expect(result.groups.new).toEqual([]);
  });

  it('lists invalid and unknown rows and leaves them out, and skips list rows', async () => {
    addStack({ scryfallId: ALPHA, quantity: 1, locationId: binder });
    addStack({ scryfallId: BRAVO, quantity: 1, locationId: binder });
    const result = await previewOk(
      csv([
        { id: ALPHA, quantity: 'lots' },
        { id: BRAVO, quantity: 1 },
        { id: CHARLIE, quantity: 4, binderType: 'list' },
        { id: UNKNOWN, quantity: 1 },
      ]),
    );
    expect(result.invalidRows.map((row) => row.row)).toEqual([2]);
    expect(result.unknownRows).toMatchObject([{ row: 5, scryfallId: UNKNOWN, quantity: 1 }]);
    // The invalid row names Alpha, so the binder's Alpha isn't missing: it is left alone.
    expect(result.groups.missing).toEqual([]);
    expect(result.groups.new).toEqual([]);
    expect(result.unchangedCount).toBe(1);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0]?.[1]).toEqual([{ id: UNKNOWN }]);

    await applyOk({ previewId: result.previewId, skips: [5] });
    expect(quantityOf(binder, ALPHA)).toBe(1);
    expect(quantityOf(binder, CHARLIE)).toBe(0);
  });

  it('answers 404 for a location that is gone', async () => {
    db.update(locations).set({ deletedAt: '2026-01-01' }).where(eq(locations.id, shelf)).run();
    expect(await errorOf(await preview(csv([]), shelf))).toEqual({
      status: 404,
      code: 'location_not_found',
    });
  });
});

describe('ManaBox location update apply', () => {
  it('adds new and raised copies and removes lowered and missing ones', async () => {
    const raised = addStack({ scryfallId: BRAVO, quantity: 1, locationId: binder });
    addStack({ scryfallId: CHARLIE, quantity: 3, locationId: binder });
    addStack({ scryfallId: DELTA, quantity: 1, locationId: binder });

    const result = await update(
      csv([
        { id: ALPHA, quantity: 2, price: '1.50', proxy: true },
        { id: BRAVO, quantity: 3 },
        { id: CHARLIE, quantity: 1 },
      ]),
    );

    expect(result.message).toBe('Updated Strixhaven binder: 4 cards added, 3 removed');
    expect(result.batchId).not.toBeNull();
    expect(stacksIn(binder)).toMatchObject([
      { id: raised, scryfallId: BRAVO, quantity: 3 },
      { scryfallId: CHARLIE, quantity: 1 },
      { scryfallId: ALPHA, quantity: 2, isProxy: true, purchasePrice: 1.5 },
    ]);

    const imported = db.select().from(imports).all();
    expect(imported).toMatchObject([
      {
        id: result.importId,
        kind: 'manabox_update',
        targetLocationId: binder,
        fileName: 'binder.csv',
      },
    ]);
    expect(db.select().from(movementBatches).all()).toMatchObject([
      { id: result.batchId, kind: 'import', importId: result.importId },
    ]);
    const moved = db.select().from(movements).all();
    expect(moved.length).toBe(4);
    expect(moved.every((m) => m.reason === 'location_update' && m.batchId === result.batchId)).toBe(
      true,
    );
  });

  it('keeps proxy flag, price and came-from on matched stacks', async () => {
    const real = addStack({
      scryfallId: ALPHA,
      quantity: 1,
      locationId: binder,
      purchasePrice: 12,
      purchaseCurrency: 'USD',
    });
    const proxy = addStack({ scryfallId: ALPHA, quantity: 1, locationId: binder, isProxy: true });
    const boxed = addStack({
      scryfallId: BRAVO,
      quantity: 1,
      locationId: deckBox,
      cameFromLocationId: binder,
      isProxy: true,
      purchasePrice: 3,
    });

    // Alpha raised by 1 lands on the real stack; Bravo matches and isn't touched.
    await update(
      csv([
        { id: ALPHA, quantity: 3, price: '0.10', proxy: true },
        { id: BRAVO, quantity: 1, price: '0.20' },
      ]),
    );
    const byId = new Map(
      db
        .select()
        .from(copyStacks)
        .all()
        .map((stack) => [stack.id, stack]),
    );
    expect(byId.get(real)).toMatchObject({ quantity: 2, isProxy: false, purchasePrice: 12 });
    expect(byId.get(proxy)).toMatchObject({ quantity: 1, isProxy: true });
    expect(byId.get(boxed)).toMatchObject({
      quantity: 1,
      isProxy: true,
      purchasePrice: 3,
      locationId: deckBox,
      cameFromLocationId: binder,
    });
  });

  it('creates the raised stack in the location with the deck-box stack’s proxy flag', async () => {
    addStack({
      scryfallId: ALPHA,
      quantity: 1,
      locationId: deckBox,
      cameFromLocationId: binder,
      isProxy: true,
    });
    await update(csv([{ id: ALPHA, quantity: 3 }]));
    expect(stacksIn(binder)).toMatchObject([{ scryfallId: ALPHA, quantity: 2, isProxy: true }]);
    expect(quantityOf(deckBox, ALPHA)).toBe(1);
  });

  it('lowers storage before deck boxes and keeps flagged copies unless chosen', async () => {
    addStack({ scryfallId: ALPHA, quantity: 1, locationId: binder });
    addStack({ scryfallId: ALPHA, quantity: 2, locationId: deckBox, cameFromLocationId: binder });

    const kept = await update(csv([{ id: ALPHA, quantity: 1 }]));
    expect(kept.message).toBe('Updated Strixhaven binder: 0 cards added, 1 removed');
    expect(quantityOf(binder, ALPHA)).toBe(0);
    expect(quantityOf(deckBox, ALPHA)).toBe(2);

    // Still one too many; this time Jeff removes it from the deck box.
    const again = await previewOk(csv([{ id: ALPHA, quantity: 1 }]));
    const flagged = again.groups.lowered[0]?.flagged ?? [];
    expect(flagged.map((copy) => copy.quantity)).toEqual([1]);
    await applyOk({ previewId: again.previewId, removeFlagged: flagged.map((c) => c.stackId) });
    expect(quantityOf(deckBox, ALPHA)).toBe(1);
    const removal = db.select().from(movements).all().at(-1);
    expect(removal).toMatchObject({ fromLocationId: deckBox, toLocationId: null, deckId });
  });

  it('removes proxies before real copies in the location', async () => {
    addStack({ scryfallId: ALPHA, quantity: 1, locationId: binder });
    addStack({ scryfallId: ALPHA, quantity: 1, locationId: binder, isProxy: true });
    await update(csv([{ id: ALPHA, quantity: 1 }]));
    expect(stacksIn(binder)).toMatchObject([{ scryfallId: ALPHA, quantity: 1, isProxy: false }]);
  });

  it('changes nothing when the same file is applied again', async () => {
    addStack({ scryfallId: BRAVO, quantity: 4, locationId: binder });
    addStack({ scryfallId: CHARLIE, quantity: 1, locationId: deckBox, cameFromLocationId: binder });
    const text = csv([
      { id: ALPHA, quantity: 2 },
      { id: BRAVO, quantity: 1 },
    ]);
    await update(text);
    const before = db.select().from(copyStacks).all();
    const movementCount = db.select().from(movements).all().length;

    const again = await update(text);
    expect(again.message).toBe('Strixhaven binder is already up to date');
    expect(again.batchId).toBeNull();
    expect(db.select().from(copyStacks).all()).toEqual(before);
    expect(db.select().from(movements).all()).toHaveLength(movementCount);
  });

  it('never removes copies of a skipped row; unknown rows must be fixed or skipped', async () => {
    addStack({ scryfallId: ALPHA, quantity: 2, locationId: binder });
    const text = csv([
      { id: ALPHA, quantity: 1 },
      { id: UNKNOWN, quantity: 1 },
    ]);
    const first = await previewOk(text);
    expect(await errorOf(await apply({ previewId: first.previewId }))).toEqual({
      status: 400,
      code: 'unknown_rows',
    });

    await applyOk({ previewId: first.previewId, skips: [2, 3] });
    expect(quantityOf(binder, ALPHA)).toBe(2);

    const second = await previewOk(text);
    await applyOk({ previewId: second.previewId, fixes: { 3: BRAVO } });
    expect(quantityOf(binder, ALPHA)).toBe(1);
    expect(quantityOf(binder, BRAVO)).toBe(1);
  });

  it('answers 410 for a preview already applied and 404 for a fix not in the card data', async () => {
    const result = await previewOk(csv([{ id: UNKNOWN, quantity: 1 }]));
    expect(
      await errorOf(await apply({ previewId: result.previewId, fixes: { 2: UNKNOWN } })),
    ).toEqual({ status: 404, code: 'printing_not_found' });
    await applyOk({ previewId: result.previewId, skips: [2] });
    expect(await errorOf(await apply({ previewId: result.previewId }))).toEqual({
      status: 410,
      code: 'preview_expired',
    });
  });
});
