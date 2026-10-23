import { and, eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import {
  cards,
  copyStacks,
  deckSlots,
  decks,
  imports,
  printings,
} from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { lookupCards } from '../../src/server/scryfall/lookup';
import { createDeck } from '../../src/server/services/decks';
import { ErrorBody } from '../../src/shared/api/common';
import {
  MoxfieldUpdateApplyResult,
  type MoxfieldUpdatePreview,
  MoxfieldUpdatePreview as MoxfieldUpdatePreviewSchema,
} from '../../src/shared/api/moxfield-update';

// Tests never call Scryfall: names the app doesn't know stay unmatched.
vi.mock('../../src/server/scryfall/lookup', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/server/scryfall/lookup')>();
  return { ...original, lookupCards: vi.fn() };
});
const lookup = vi.mocked(lookupCards);

const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

const oracle = (name: string) => `oracle-${name}`;
const HEARTHHULL = oracle('Hearthhull, the Worldseed');

// The deck now: Hearthhull; Sol Ring, Arcane Signet, Farseek and 5 Forests on the main board.
// The fresh export: Farseek out, Chaos Warp in, Arcane Signet to the maybe board, 7 Forests.
const TEXT = [
  '1 Hearthhull, the Worldseed (EOC) 1 *F*',
  '1 Sol Ring (EOC) 57',
  '1 Chaos Warp (MBC) 72',
  '7 Forest (EOE) 276',
  '',
  'SIDEBOARD:',
  '1 Arcane Signet (EOC) 53',
  '',
].join('\n');

let db: OpenDb;
let deckId: number;

function insertCard(name: string, options: { canBeCommander?: boolean; isBasicLand?: boolean }) {
  db.insert(cards)
    .values({
      oracleId: oracle(name),
      name,
      frontFaceName: name,
      typeLine: 'Card',
      commanderLegality: 'legal',
      ...options,
    })
    .run();
}

function slotOf(oracleId: string, board: string) {
  return db
    .select()
    .from(deckSlots)
    .where(
      and(
        eq(deckSlots.deckId, deckId),
        eq(deckSlots.oracleId, oracleId),
        eq(deckSlots.board, board as 'main'),
      ),
    )
    .get();
}

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  lookup.mockReset();
  lookup.mockImplementation(async (_db, identifiers) => ({ resolved: [], not_found: identifiers }));
  insertCard('Hearthhull, the Worldseed', { canBeCommander: true });
  for (const name of ['Sol Ring', 'Arcane Signet', 'Farseek', 'Chaos Warp']) insertCard(name, {});
  insertCard('Forest', { isBasicLand: true });
  deckId = createDeck(db, {
    name: 'Hearthhull',
    slots: [
      { oracleId: HEARTHHULL, board: 'commander', quantity: 1 },
      { oracleId: oracle('Sol Ring'), board: 'main', quantity: 1 },
      { oracleId: oracle('Arcane Signet'), board: 'main', quantity: 1 },
      { oracleId: oracle('Farseek'), board: 'main', quantity: 1 },
      { oracleId: oracle('Forest'), board: 'main', quantity: 5 },
    ],
  });
  db.update(deckSlots)
    .set({ pickedScryfallId: 'sol-ring-picked' })
    .where(eq(deckSlots.oracleId, oracle('Sol Ring')))
    .run();
  db.update(deckSlots)
    .set({ pickedScryfallId: 'signet-picked' })
    .where(eq(deckSlots.oracleId, oracle('Arcane Signet')))
    .run();
});
afterEach(() => db.$client.close());

async function preview(text = TEXT) {
  const res = await api.imports.moxfield['update-preview'].$post({
    json: { deckId, text, commanders: [HEARTHHULL] },
  });
  expect(res.status).toBe(200);
  return MoxfieldUpdatePreviewSchema.parse(await res.json());
}

async function apply(text = TEXT, skips: number[] = []) {
  return api.imports.moxfield['update-apply'].$post({
    json: { deckId, text, commanders: [HEARTHHULL], fixes: {}, skips },
  });
}

const names = (slots: { card: { name: string }; board: string }[]) =>
  slots.map((slot) => `${slot.board} ${slot.card.name}`);

describe('Moxfield update preview', () => {
  it('lists the added, removed and changed slots', async () => {
    const result = await preview();
    expect(names(result.changes.added)).toEqual(['main Chaos Warp', 'maybe Arcane Signet']);
    expect(names(result.changes.removed)).toEqual(['main Arcane Signet', 'main Farseek']);
    expect(result.changes.changed).toEqual([
      expect.objectContaining({
        card: expect.objectContaining({ name: 'Forest' }),
        board: 'main',
        from: 5,
        to: 7,
      }),
    ]);
    expect(result.changes.added[0].hint).toEqual({
      setCode: 'MBC',
      collectorNumber: '72',
      foil: false,
    });
  });

  it('tags lines whose card isn’t in the deck as new', async () => {
    const result = await preview();
    const newLines = (preview: MoxfieldUpdatePreview) =>
      preview.lines.filter((line) => line.isNew).map((line) => line.text);
    expect(newLines(result)).toEqual(['1 Chaos Warp (MBC) 72']);
    expect(result.lines[0]).toEqual({ lineNo: 1, text: TEXT.split('\n')[0], tag: 'commander' });
  });

  it('reads the text as the new-deck preview does and writes nothing', async () => {
    const before = db.select().from(deckSlots).all();
    const result = await preview(`${TEXT}1 Unknown Card\n`);
    expect(result.unmatched).toEqual([{ lineNo: 8, name: 'Unknown Card', quantity: 1 }]);
    expect(result.counts).toEqual({ main: 9, maybe: 2, basics: 7 });
    expect(db.select().from(deckSlots).all()).toEqual(before);
    expect(db.select().from(imports).all()).toEqual([]);
  });

  it('answers 404 deck_not_found for a deck that doesn’t exist', async () => {
    const res = await api.imports.moxfield['update-preview'].$post({
      json: { deckId: 999, text: TEXT },
    });
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('deck_not_found');
  });
});

describe('Moxfield update apply', () => {
  it('replaces the slots, keeping the picked printing of cards that stay', async () => {
    const res = await apply();
    expect(res.status).toBe(200);
    expect(MoxfieldUpdateApplyResult.parse(await res.json())).toEqual({
      deckId,
      message: 'Updated Hearthhull: 4 cards in, 2 out',
      needsSwap: false,
    });

    expect(slotOf(oracle('Sol Ring'), 'main')?.pickedScryfallId).toBe('sol-ring-picked');
    expect(slotOf(oracle('Arcane Signet'), 'maybe')?.pickedScryfallId).toBe('signet-picked');
    expect(slotOf(oracle('Arcane Signet'), 'main')).toBeUndefined();
    expect(slotOf(oracle('Farseek'), 'main')).toBeUndefined();
    expect(slotOf(oracle('Forest'), 'main')?.quantity).toBe(7);
    expect(slotOf(oracle('Chaos Warp'), 'main')).toMatchObject({
      quantity: 1,
      pickedScryfallId: null,
      hintSetCode: 'MBC',
      hintCollectorNumber: '72',
    });
    expect(slotOf(HEARTHHULL, 'commander')).toMatchObject({ quantity: 1, hintFoil: true });
  });

  it('writes an imports row', async () => {
    await apply(`${TEXT}1 Unknown Card\n`, [8]);
    expect(db.select().from(imports).all()).toEqual([
      expect.objectContaining({
        kind: 'moxfield_update',
        deckId,
        rowCount: 5,
        cardCount: 11,
        skippedCount: 1,
      }),
    ]);
  });

  it('says the deck needs the swap list only when its box holds copies', async () => {
    expect(MoxfieldUpdateApplyResult.parse(await (await apply()).json()).needsSwap).toBe(false);

    const deck = db.select().from(decks).where(eq(decks.id, deckId)).get();
    db.insert(printings)
      .values({
        scryfallId: 'sol-ring-picked',
        oracleId: oracle('Sol Ring'),
        setCode: 'eoc',
        setName: 'Edge of Eternities Commander',
        collectorNumber: '57',
        lang: 'en',
        finishes: ['nonfoil'],
        rarity: 'uncommon',
        releasedAt: '2025-08-01',
      })
      .run();
    db.insert(copyStacks)
      .values({
        scryfallId: 'sol-ring-picked',
        quantity: 1,
        finish: 'nonfoil',
        condition: 'near_mint',
        language: 'en',
        locationId: deck?.deckBoxId ?? 0,
      })
      .run();
    expect(MoxfieldUpdateApplyResult.parse(await (await apply()).json())).toMatchObject({
      message: 'Updated Hearthhull: no cards changed',
      needsSwap: true,
    });
  });

  it('refuses while a name is unmatched, and changes nothing', async () => {
    const before = db.select().from(deckSlots).all();
    const res = await apply(`${TEXT}1 Unknown Card\n`);
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('unmatched_lines');
    expect(db.select().from(deckSlots).all()).toEqual(before);
    expect(db.select().from(imports).all()).toEqual([]);
  });

  it('answers 404 deck_not_found for a deleted deck', async () => {
    db.update(decks).set({ deletedAt: new Date().toISOString() }).where(eq(decks.id, deckId)).run();
    const res = await apply();
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('deck_not_found');
  });
});
