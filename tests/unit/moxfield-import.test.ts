import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppType } from '../../src/server/app';
import { app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { cards, deckSlots, decks, imports, locations, printings } from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { cardToRows, ScryfallCard } from '../../src/server/scryfall/card-rows';
import { lookupCards, ScryfallUnavailableError } from '../../src/server/scryfall/lookup';
import { previewMoxfieldDeck } from '../../src/server/services/imports/moxfield';
import type { CardSummary } from '../../src/shared/api/common';
import { ErrorBody } from '../../src/shared/api/common';
import {
  MoxfieldCreateResult,
  type MoxfieldPreview,
  MoxfieldPreview as MoxfieldPreviewSchema,
} from '../../src/shared/api/moxfield';
import { moxfieldPreview, sampleCard } from '../../src/shared/api/samples/moxfield';

// Tests never call Scryfall: each test says what the lookup answers.
vi.mock('../../src/server/scryfall/lookup', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/server/scryfall/lookup')>();
  return { ...original, lookupCards: vi.fn() };
});
const lookup = vi.mocked(lookupCards);

const fixtures = path.join(import.meta.dirname, '..', 'fixtures');
const scryfallFixture = JSON.parse(
  readFileSync(path.join(fixtures, 'scryfall', 'default-cards.json'), 'utf8'),
) as { id: string }[];
const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  lookup.mockReset();
  lookup.mockImplementation(async (_db, identifiers) => ({ resolved: [], not_found: identifiers }));
  // Every card of the Hearthhull deck but Evendo Brushrazer (line 21), which the app doesn't know.
  for (const name of deckNames()) {
    if (name !== 'Evendo Brushrazer') insertCard(sampleCard(name));
  }
});
afterEach(() => db.$client.close());

let setsText = '';
let plainText = '';
const readFixtures = Promise.all([
  readFile(path.join(fixtures, 'moxfield-deck-sample-with-sets.txt'), 'utf8'),
  readFile(path.join(fixtures, 'moxfield-deck-sample-plain.txt'), 'utf8'),
]).then(([sets, plain]) => {
  setsText = sets;
  plainText = plain;
});

beforeEach(async () => {
  await readFixtures;
});

/** The card names of the Hearthhull deck, from the sample preview. */
function deckNames() {
  return [...new Set(moxfieldPreview.slots.map((slot) => slot.card.name)), 'Evendo Brushrazer'];
}

function insertCard(
  card: Omit<CardSummary, 'imageSmall' | 'imageNormal'>,
  extra: { keywords?: string[] } = {},
) {
  db.insert(cards)
    .values({
      oracleId: card.oracleId,
      name: card.name,
      frontFaceName: card.frontFaceName,
      typeLine: card.typeLine,
      manaCost: card.manaCost,
      manaValue: card.manaValue,
      colorIdentity: card.colorIdentity,
      commanderLegality: 'legal',
      canBeCommander: card.canBeCommander,
      isBasicLand: card.isBasicLand,
      keywords: extra.keywords ?? [],
    })
    .run();
}

const TEFERIS_PROTECTION = '77f130c7-0138-4a1a-9f67-62d2c302dc48';
/** Teferi's Protection from Marvel Super Heroes (MAR 51), printed as T'Challa's Protection. */
const TCHALLAS_PROTECTION = 'c54d5ea1-0cc9-4e84-b712-642d55915dae';
const TEFERIS_PROTECTION_ORACLE = '0d4ecdb1-ec90-497f-a7a4-1c68092b8757';

/** Writes these printings of the Scryfall fixture into the card data. */
function loadFixtureCards(...scryfallIds: string[]) {
  for (const id of scryfallIds) {
    const raw = scryfallFixture.find((card) => card.id === id);
    const { card, printing } = cardToRows(ScryfallCard.parse(raw));
    db.insert(cards).values(card).onConflictDoNothing().run();
    db.insert(printings).values(printing).run();
  }
}

function testCard(name: string, options: Partial<CardSummary> = {}) {
  const card = {
    oracleId: `oracle-${name}`,
    name,
    frontFaceName: name.split(' // ')[0],
    manaCost: '',
    manaValue: 0,
    typeLine: 'Creature',
    colorIdentity: '',
    canBeCommander: false,
    isBasicLand: false,
    ...options,
  };
  return card;
}

async function preview(json: Parameters<typeof api.imports.moxfield.preview.$post>[0]['json']) {
  const res = await api.imports.moxfield.preview.$post({ json });
  expect(res.status).toBe(200);
  return MoxfieldPreviewSchema.parse(await res.json());
}

const quantityOf = (result: MoxfieldPreview, name: string, board = 'main') =>
  result.slots.find((slot) => slot.card.name === name && slot.board === board)?.quantity;

describe('Moxfield preview', () => {
  it('answers the sample preview for the set format (images come from printings)', async () => {
    const result = await preview({ text: setsText });
    const noImages = (card: CardSummary) => ({ ...card, imageSmall: null, imageNormal: null });
    expect(result).toEqual({
      ...moxfieldPreview,
      commanders: moxfieldPreview.commanders.map(noImages),
      slots: moxfieldPreview.slots.map((slot) => ({ ...slot, card: noImages(slot.card) })),
    });
  });

  it('makes the same slots from both formats, with hints only from the set format', async () => {
    const sets = await preview({ text: setsText });
    const plain = await preview({ text: plainText });
    expect(plain.format).toBe('plain');
    const withoutHints = (result: MoxfieldPreview) =>
      result.slots
        .map((slot) => ({ ...slot, hint: null }))
        .sort((a, b) => `${a.board}${a.card.name}`.localeCompare(`${b.board}${b.card.name}`));
    expect(withoutHints(plain)).toEqual(withoutHints(sets));
    expect(plain.slots.every((slot) => slot.hint === null)).toBe(true);
    expect(sets.slots.every((slot) => slot.hint !== null)).toBe(true);

    for (const result of [sets, plain]) {
      expect(result.commanders.map((card) => card.name)).toEqual(['Hearthhull, the Worldseed']);
      expect(result.slots[0]).toMatchObject({ board: 'commander', quantity: 1 });
      expect(result.slots.filter((slot) => slot.board === 'maybe')).toHaveLength(5);
      expect(quantityOf(result, 'Forest')).toBe(8);
      expect(quantityOf(result, 'Mountain')).toBe(3);
      expect(quantityOf(result, 'Swamp')).toBe(5);
      expect(result.counts).toEqual({ main: 94, maybe: 5, basics: 17 });
      expect(result.unmatched).toEqual([
        expect.objectContaining({ name: 'Evendo Brushrazer', quantity: 1 }),
      ]);
    }
    expect(plain.lines.at(-1)).toMatchObject({
      text: '1 Hearthhull, the Worldseed',
      tag: 'commander',
    });
  });

  it('keeps the first line’s printing hint and its foil marker', async () => {
    const result = await preview({ text: setsText });
    const forest = result.slots.find((slot) => slot.card.name === 'Forest');
    expect(forest?.hint).toEqual({ setCode: 'EOE', collectorNumber: '276', foil: false });
    expect(result.slots[0].hint).toEqual({ setCode: 'EOC', collectorNumber: '1', foil: true });
  });

  it('lists an unknown name, which Jeff can fix or skip', async () => {
    const evendo = testCard('Evendo Brushrazer');
    insertCard({ ...evendo, oracleId: 'evendo-fixed', name: 'Some Other Card' });

    const fixed = await preview({ text: setsText, fixes: { 21: 'evendo-fixed' } });
    expect(fixed.unmatched).toEqual([]);
    expect(fixed.lines[20]).toMatchObject({ lineNo: 21, tag: 'main' });
    expect(quantityOf(fixed, 'Some Other Card')).toBe(1);
    expect(fixed.counts.main).toBe(94);

    const skipped = await preview({ text: setsText, skips: [21] });
    expect(skipped.unmatched).toEqual([]);
    expect(skipped.lines[20].tag).toBe('skipped');
    expect(skipped.counts.main).toBe(93);

    const res = await api.imports.moxfield.preview.$post({
      json: { text: setsText, fixes: { 21: 'no-such-card' } },
    });
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('card_not_found');
  });

  it('looks up names the app doesn’t know on Scryfall', async () => {
    lookup.mockImplementation(async (lookupDb, identifiers) => {
      insertCard({ ...testCard('Evendo Brushrazer'), oracleId: 'evendo' });
      expect(lookupDb).toBe(db);
      return {
        resolved: identifiers.map((identifier) => ({
          identifier,
          scryfallId: 'evendo-1',
          oracleId: 'evendo',
        })),
        not_found: [],
      };
    });
    const result = await preview({ text: setsText });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0][1]).toEqual([
      { name: 'Evendo Brushrazer' },
      { set: 'EOC', collector_number: '10' },
    ]);
    expect(result.unmatched).toEqual([]);
    expect(result.lookupFailed).toBe(false);
    expect(result.lines[20].tag).toBe('main');
  });

  it('says when Scryfall can’t be reached and lists the names as unmatched', async () => {
    lookup.mockRejectedValue(new ScryfallUnavailableError());
    const result = await preview({ text: setsText });
    expect(result.lookupFailed).toBe(true);
    expect(result.unmatched.map((row) => row.lineNo)).toEqual([21]);
  });

  it('matches " / " and the front face name to a double-faced card, ignoring case', async () => {
    insertCard(testCard('Delver of Secrets // Insectile Aberration'));
    const result = await preview({
      text: '1 Delver of Secrets / Insectile Aberration\n1 delver of secrets\n1 SOL RING\n',
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(result.unmatched).toEqual([]);
    expect(result.slots).toEqual([
      expect.objectContaining({
        card: expect.objectContaining({ name: 'Delver of Secrets // Insectile Aberration' }),
        quantity: 2,
      }),
      expect.objectContaining({ card: expect.objectContaining({ name: 'Sol Ring' }) }),
    ]);
  });

  it('matches a printing’s flavor name to its card, with that printing as the hint', async () => {
    loadFixtureCards(TEFERIS_PROTECTION, TCHALLAS_PROTECTION);
    const result = await preview({
      text: "1 T'Challa's Protection\n1 Sol Ring\n\nSIDEBOARD:\n1 t'challa's protection (MAR) 51 *F*\n",
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(result.unmatched).toEqual([]);
    const slots = result.slots.filter((slot) => slot.card.name === "Teferi's Protection");
    expect(slots.map(({ board, quantity, hint }) => ({ board, quantity, hint }))).toEqual([
      { board: 'main', quantity: 1, hint: { setCode: 'MAR', collectorNumber: '51', foil: false } },
      { board: 'maybe', quantity: 1, hint: { setCode: 'MAR', collectorNumber: '51', foil: true } },
    ]);
  });

  it('keeps the line’s own printing and the card’s own name over a flavor name', async () => {
    loadFixtureCards(TEFERIS_PROTECTION, TCHALLAS_PROTECTION);
    const result = await preview({
      text: "1 Teferi's Protection\n1 T'Challa's Protection (C17) 8\n1 Sol Ring\n",
    });
    expect(result.slots[0]).toMatchObject({
      card: { name: "Teferi's Protection" },
      quantity: 2,
      hint: null,
    });
    const hinted = await preview({ text: "1 T'Challa's Protection (C17) 8\n1 Sol Ring\n" });
    expect(hinted.slots[0].hint).toEqual({ setCode: 'C17', collectorNumber: '8', foil: false });
  });

  it('matches an unknown name by its set code and collector number', async () => {
    // Card data loaded before flavor names were kept.
    loadFixtureCards(TCHALLAS_PROTECTION);
    db.update(printings).set({ flavorName: null }).run();
    const result = await preview({ text: "1 T'Challa's Protection (mar) 51\n1 Sol Ring\n" });
    expect(result.unmatched).toEqual([]);
    expect(result.slots[0]).toMatchObject({
      card: { name: "Teferi's Protection" },
      hint: { setCode: 'mar', collectorNumber: '51' },
    });
    expect(lookup).toHaveBeenCalledWith(db, [{ name: "T'Challa's Protection" }]);
  });

  it('looks up an unknown printing on Scryfall by set code and collector number', async () => {
    lookup.mockImplementation(async (_db, identifiers) => {
      loadFixtureCards(TCHALLAS_PROTECTION);
      const [byName, byPrinting] = identifiers;
      return {
        resolved: [
          {
            identifier: byPrinting,
            scryfallId: TCHALLAS_PROTECTION,
            oracleId: TEFERIS_PROTECTION_ORACLE,
          },
        ],
        not_found: [byName],
      };
    });
    const result = await preview({ text: '1 Some Flavor Name (MAR) 51\n1 Sol Ring\n' });
    expect(lookup.mock.calls[0][1]).toEqual([
      { name: 'Some Flavor Name' },
      { set: 'MAR', collector_number: '51' },
    ]);
    expect(result.unmatched).toEqual([]);
    expect(result.slots[0].card.name).toBe("Teferi's Protection");
  });

  it('uses Jeff’s commanders over the proposal', async () => {
    const korvold = sampleCard('Korvold, Fae-Cursed King').oracleId;
    const hearthhull = sampleCard('Hearthhull, the Worldseed').oracleId;
    const result = await preview({ text: setsText, commanders: [korvold] });
    expect(result.commanders.map((card) => card.oracleId)).toEqual([korvold]);
    expect(result.slots[0]).toMatchObject({
      card: { oracleId: korvold },
      board: 'commander',
      hint: { setCode: 'EOC', collectorNumber: '120', foil: false },
    });
    expect(result.lines[0].tag).toBe('main');
    expect(result.lines.find((line) => line.text.startsWith('1 Korvold'))?.tag).toBe('commander');
    expect(quantityOf(result, 'Hearthhull, the Worldseed')).toBe(1);
    expect(quantityOf(result, 'Korvold, Fae-Cursed King')).toBeUndefined();

    // A partner not in the text gets a commander slot of its own.
    insertCard(testCard('Partner', { canBeCommander: true }));
    const partners = await preview({ text: setsText, commanders: [hearthhull, 'oracle-Partner'] });
    expect(partners.slots.slice(0, 2)).toEqual([
      expect.objectContaining({ card: expect.objectContaining({ oracleId: hearthhull }) }),
      expect.objectContaining({ board: 'commander', quantity: 1, hint: null }),
    ]);

    const none = await preview({ text: setsText, commanders: [] });
    expect(none.commanders).toEqual([]);
    expect(none.lines[0].tag).toBe('main');
  });

  it('proposes no commander when the proposed card can’t be one', async () => {
    const result = await preview({ text: '1 Sol Ring (EOC) 57\n1 Arcane Signet (EOC) 53\n' });
    expect(result.commanders).toEqual([]);
    expect(result.slots.every((slot) => slot.board === 'main')).toBe(true);
  });

  it('writes no deck', async () => {
    await preview({ text: setsText });
    expect(db.select().from(decks).all()).toEqual([]);
  });
});

describe('Moxfield create', () => {
  it('writes the deck, its box, its slots and an imports row', async () => {
    const res = await api.imports.moxfield.create.$post({
      json: {
        text: setsText,
        name: 'Hearthhull',
        commanders: [sampleCard('Hearthhull, the Worldseed').oracleId],
        fixes: {},
        skips: [21],
      },
    });
    expect(res.status).toBe(200);
    const result = MoxfieldCreateResult.parse(await res.json());
    expect(result.message).toBe('Created the deck Hearthhull');

    const deck = db.select().from(decks).where(eq(decks.id, result.deckId)).get();
    expect(deck?.name).toBe('Hearthhull');
    const box = db
      .select()
      .from(locations)
      .where(eq(locations.id, deck?.deckBoxId ?? 0))
      .get();
    expect(box).toMatchObject({ name: 'Hearthhull deck box', type: 'deck_box' });

    const slots = db.select().from(deckSlots).where(eq(deckSlots.deckId, result.deckId)).all();
    const sum = (board: string) =>
      slots
        .filter((slot) => slot.board === board)
        .reduce((total, slot) => total + slot.quantity, 0);
    expect([sum('commander'), sum('main'), sum('maybe')]).toEqual([1, 93, 5]);
    expect(slots.find((slot) => slot.board === 'commander')).toMatchObject({
      oracleId: sampleCard('Hearthhull, the Worldseed').oracleId,
      hintSetCode: 'EOC',
      hintCollectorNumber: '1',
      hintFoil: true,
    });

    expect(db.select().from(imports).all()).toEqual([
      expect.objectContaining({
        kind: 'moxfield_new',
        deckId: result.deckId,
        cardCount: 99,
        skippedCount: 1,
      }),
    ]);
  });

  it('refuses while a name is still unmatched', async () => {
    const res = await api.imports.moxfield.create.$post({
      json: { text: setsText, name: 'Hearthhull', commanders: [], fixes: {}, skips: [] },
    });
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('unmatched_lines');
    expect(db.select().from(decks).all()).toEqual([]);
  });

  it('works without the routes too', async () => {
    const result = await previewMoxfieldDeck(db, setsText, { skips: [21] });
    expect(result.cardLineCount).toBe(89);
    expect(result.skippedCount).toBe(1);
  });
});
