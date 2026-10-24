import { readFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppType } from '../../src/server/app';
import { app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { cards, copyStacks, deckSlots, deckSlotTags, decks } from '../../src/server/db/schema';
import { createTestDb, insertCard, insertPrinting } from '../../src/server/db/test-db';
import { parseDeckList } from '../../src/server/decklists/parse';
import { previewDeckList, updateFromDeckList } from '../../src/server/services/deck-lists';
import { createDeck } from '../../src/server/services/decks';
import { ErrorBody } from '../../src/shared/api/common';
import { DeckListPreview, DeckListUpdated } from '../../src/shared/api/deck-lists';
import { DeckSummary } from '../../src/shared/api/decks';
import {
  cards as sampleCards,
  printings as samplePrintings,
} from '../../src/shared/api/samples/deck-cards';
import {
  deckListPreviewSample,
  jinxRebelsText,
  jinxRebelsTypoText,
} from '../../src/shared/api/samples/deck-lists';

// Deck list import and update (#19) against the Jinx Rebels sample list (Jeff hasn't sent his
// own deck lists yet), with the sample cards from src/shared/api/samples/deck-cards.ts as the
// card data.

const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;

type Key = keyof typeof sampleCards & keyof typeof samplePrintings;

/** Writes every sample card with its printing, keeping the samples' ids. */
function seedSampleCards() {
  for (const key of Object.keys(sampleCards) as Key[]) {
    const card = sampleCards[key];
    const printing = samplePrintings[key];
    if (!printing) continue;
    insertCard(db, {
      id: card.id,
      name: card.name,
      type: card.type,
      supertype: card.supertype,
      domains: card.domains,
      energy: card.energy,
      might: card.might,
      power: card.power,
      championTag: card.championTag,
    });
    insertPrinting(db, {
      riftcodexId: printing.printingId,
      cardId: card.id,
      publicCode: printing.publicCode,
      setCode: printing.setCode,
      setName: printing.setName,
      collectorNumber: printing.collectorNumber,
      rarity: printing.rarity,
      imageUrl: printing.imageUrl,
      alternateArt: printing.alternateArt,
      overnumbered: printing.overnumbered,
      signature: printing.signature,
      finishes: printing.finishes,
    });
  }
}

const preview = async (
  json: Parameters<(typeof api)['deck-lists']['preview']['$post']>[0]['json'],
) => {
  const res = await api['deck-lists'].preview.$post({ json });
  expect(res.status).toBe(200);
  return DeckListPreview.parse(await res.json());
};

const lineOf = (text: string, start: string) =>
  text.split('\n').findIndex((line) => line.startsWith(start)) + 1;

const slotsOf = (deckId: number) =>
  db.select().from(deckSlots).where(eq(deckSlots.deckId, deckId)).orderBy(deckSlots.id).all();

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  seedSampleCards();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('reading a deck list', () => {
  it('reads board headings, quantities, public codes, foil and tags', () => {
    const lines = parseDeckList(
      [
        '1 Jinx, Loose Cannon',
        '',
        'Battlefields (3):',
        '3x Sun Disc [ogn-057/298] *f* #energy rock #Ramp',
        '// a comment',
        'Side',
        'Fiora, Guardian',
        'Maybeboard:',
        '0 Senna, Outlaw',
      ].join('\r\n'),
    );
    expect(lines.map((line) => line.kind)).toEqual([
      'card',
      'blank',
      'heading',
      'card',
      'blank',
      'heading',
      'card',
      'heading',
      'blank',
    ]);
    expect(lines[0]).toMatchObject({ board: 'main', quantity: 1, name: 'Jinx, Loose Cannon' });
    expect(lines[3]).toMatchObject({
      board: 'battlefield',
      quantity: 3,
      name: 'Sun Disc',
      publicCode: 'OGN-057',
      foil: true,
      tags: ['energy rock', 'Ramp'],
    });
    expect(lines[6]).toMatchObject({ board: 'sideboard', quantity: 1, name: 'Fiora, Guardian' });
  });

  it('keeps a name with a dash and no code whole', () => {
    expect(parseDeckList('2 Jinx - Demolitionist')[0]).toMatchObject({
      name: 'Jinx - Demolitionist',
      publicCode: null,
    });
  });
});

describe('POST /api/deck-lists/preview', () => {
  it('reads the sample list as the preview sample shows it', async () => {
    const answer = await preview({ text: jinxRebelsTypoText });
    expect(answer.previewId).toMatch(/^dlp_[a-z0-9]+$/);
    // The unit tests never call Riftcodex, so the misspelled name couldn't be looked up.
    expect(answer).toEqual({
      ...deckListPreviewSample,
      previewId: answer.previewId,
      lookupFailed: true,
    });
  });

  it('matches every line of the full list and passes every check', async () => {
    const answer = await preview({ text: jinxRebelsText });
    expect(answer.unmatched).toEqual([]);
    expect(answer.boards).toEqual({
      legend: 1,
      champion: 1,
      main: 39,
      battlefield: 3,
      rune: 12,
      sideboard: 8,
      maybe: 1,
    });
    expect(answer.checks.filter((check) => check.result === 'warn')).toEqual([]);
    const legend = answer.slots[0];
    expect(legend).toMatchObject({
      board: 'legend',
      hint: { publicCode: 'OGN-001', foil: true },
      printing: { printingId: samplePrintings.jinxLooseCannon.printingId },
    });
  });

  it('takes Jeff’s fixes and skips', async () => {
    const typo = lineOf(jinxRebelsTypoText, '2 Hextek Vault');
    const fixed = await preview({
      text: jinxRebelsTypoText,
      fixes: [{ lineNumber: typo, cardId: sampleCards.hextechVault.id }],
      skips: [lineOf(jinxRebelsTypoText, '1 Senna, Outlaw')],
    });
    expect(fixed.unmatched).toEqual([]);
    expect(fixed.boards).toMatchObject({ sideboard: 8, maybe: 0 });
    expect(fixed.lines[typo - 1]).toMatchObject({ kind: 'card', board: 'sideboard' });
    expect(fixed.lines.find((line) => line.text.startsWith('1 Senna'))?.kind).toBe('skipped');

    const res = await api['deck-lists'].preview.$post({
      json: { text: jinxRebelsTypoText, fixes: [{ lineNumber: typo, cardId: 99999 }] },
    });
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('card_not_found');
  });

  it('merges repeated names on a board, keeping the first hint, and adds their tags', async () => {
    const answer = await preview({
      text: [
        'Main:',
        '1 Sun Disc #Ramp',
        '2 Sun Disc OGN-057 #ramp #Rock',
        '1 Sun Disc OGN-999 *F*',
        'Sideboard:',
        '1 Sun Disc',
      ].join('\n'),
    });
    const sunDiscs = answer.slots.filter((slot) => slot.card.id === sampleCards.sunDisc.id);
    expect(sunDiscs).toEqual([
      expect.objectContaining({
        board: 'main',
        quantity: 4,
        hint: { publicCode: samplePrintings.sunDisc.publicCode.split('/')[0], foil: false },
        tags: ['Ramp', 'Rock'],
        lineNumbers: [2, 3, 4],
      }),
      expect.objectContaining({ board: 'sideboard', quantity: 1, hint: null, lineNumbers: [6] }),
    ]);
  });

  it('matches a misspelled name by its public code', async () => {
    const code = samplePrintings.stormSage.publicCode.split('/')[0].replace('-0', '-');
    const answer = await preview({ text: `3 Storm Sag ${code.toLowerCase()}` });
    expect(answer.slots).toEqual([
      expect.objectContaining({
        card: expect.objectContaining({ id: sampleCards.stormSage.id }),
        quantity: 3,
        printing: expect.objectContaining({ printingId: samplePrintings.stormSage.printingId }),
      }),
    ]);
  });

  it('proposes the Legend and Chosen Champion from a list without headings', async () => {
    const answer = await preview({
      text: [
        '3 Fierce Blast',
        '1 Jinx, Loose Cannon',
        '3 Jinx, Rebel OGN-202 #Win',
        '1 Eager Steppe',
        '6 Fury Rune',
      ].join('\n'),
    });
    expect(answer.legend?.id).toBe(sampleCards.jinxLooseCannon.id);
    expect(answer.champion?.id).toBe(sampleCards.jinxRebel.id);
    expect(answer.boards).toEqual({
      legend: 1,
      champion: 1,
      main: 5,
      battlefield: 1,
      rune: 6,
      sideboard: 0,
      maybe: 0,
    });
    const champion = answer.slots.find((slot) => slot.board === 'champion');
    expect(champion).toMatchObject({ quantity: 1, tags: ['Win'], lineNumbers: [3] });
    expect(champion?.hint?.publicCode).toBe('OGN-202');
    expect(answer.lines.map((line) => line.board)).toEqual([
      'main',
      'legend',
      'main',
      'battlefield',
      'rune',
    ]);
  });

  it('proposes no Chosen Champion that doesn’t match the Legend’s tag', async () => {
    const answer = await preview({
      text: ['Legend:', '1 Jinx, Loose Cannon', 'Main:', '2 Fiora, Guardian'].join('\n'),
    });
    expect(answer.champion).toBeNull();
    expect(answer.checks.find((check) => check.code === 'champion')?.result).toBe('warn');
  });

  it('answers 404 for a deck that doesn’t exist', async () => {
    const res = await api['deck-lists'].preview.$post({
      json: { text: '1 Sun Disc', deckId: 404 },
    });
    expect(res.status).toBe(404);
  });
});

describe('looking up unknown names on Riftcodex', () => {
  const fixture = JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, '..', 'fixtures', 'riftcodex', 'name-jinx-rebel.json'),
      'utf8',
    ),
  );

  beforeEach(() => {
    // A card data without Jinx, Rebel, so only Riftcodex knows it.
    db = createTestDb();
    setDb(db);
    vi.stubEnv('RIFTCODEX', 'on');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const fuzzy = new URL(input).searchParams.get('fuzzy') ?? '';
        if (fuzzy.toLowerCase().includes('rebel')) return Response.json(fixture);
        return Response.json({ items: [], total: 0, page: 1, size: 100, pages: 0 });
      }),
    );
  });

  it('matches names Riftcodex finds and lists the rest', async () => {
    const answer = await previewDeckList(
      db,
      { text: '1 Jinx Rebel\n2 Nobody Knows Me' },
      { gapMs: 0 },
    );
    expect(answer.lookupFailed).toBe(false);
    expect(answer.slots).toEqual([
      expect.objectContaining({ card: expect.objectContaining({ name: 'Jinx - Rebel' }) }),
    ]);
    expect(answer.unmatched).toEqual([
      { lineNumber: 2, name: 'Nobody Knows Me', quantity: 2, board: 'main' },
    ]);
    expect(db.select().from(cards).where(eq(cards.nameKey, 'jinx rebel')).get()).toBeDefined();
  });

  it('lists every unknown name when Riftcodex can’t be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const answer = await previewDeckList(db, { text: '1 Jinx Rebel' }, { gapMs: 0 });
    expect(answer.lookupFailed).toBe(true);
    expect(answer.unmatched).toHaveLength(1);
  });
});

describe('POST /api/deck-lists/:previewId/create', () => {
  it('makes the deck with its own deck box, not assembled', async () => {
    const { previewId } = await preview({ text: jinxRebelsTypoText });
    const res = await api['deck-lists'][':previewId'].create.$post({
      param: { previewId },
      json: {
        name: 'Jinx Rebels',
        legendId: sampleCards.jinxLooseCannon.id,
        championId: sampleCards.jinxRebel.id,
      },
    });
    expect(res.status).toBe(201);
    const deck = DeckSummary.parse(await res.json());
    expect(deck).toMatchObject({
      name: 'Jinx Rebels',
      legend: { id: sampleCards.jinxLooseCannon.id },
      champion: { id: sampleCards.jinxRebel.id },
      state: 'not_assembled',
      boxCopyCount: 0,
    });
    const slots = slotsOf(deck.id);
    // Every matched line; the misspelled sideboard line is left out.
    expect(slots.reduce((n, slot) => n + slot.quantity, 0)).toBe(1 + 1 + 39 + 3 + 12 + 6 + 1);
    const sunDisc = slots.find((slot) => slot.cardId === sampleCards.sunDisc.id);
    const tags = db
      .select({ tag: deckSlotTags.tag })
      .from(deckSlotTags)
      .where(eq(deckSlotTags.slotId, sunDisc?.id ?? 0))
      .all()
      .map((row) => row.tag);
    expect(tags.sort()).toEqual(['Ramp', 'energy rock']);
    expect(slots.find((slot) => slot.board === 'legend')).toMatchObject({
      hintPublicCode: 'OGN-001',
      hintFoil: true,
    });

    // The preview is used up.
    const again = await api['deck-lists'][':previewId'].create.$post({
      param: { previewId },
      json: { name: 'Jinx Rebels 2', legendId: sampleCards.jinxLooseCannon.id, championId: null },
    });
    expect(again.status).toBe(404);
    expect(ErrorBody.parse(await again.json()).error.code).toBe('preview_not_found');
  });

  it('uses the Legend and Chosen Champion Jeff picked instead of the proposed ones', async () => {
    const { previewId } = await preview({
      text: ['Legend:', '1 Jinx, Loose Cannon', 'Main:', '3 Jinx, Rebel', '2 Fierce Blast'].join(
        '\n',
      ),
    });
    const res = await api['deck-lists'][':previewId'].create.$post({
      param: { previewId },
      json: { name: 'Picked', legendId: sampleCards.sennaOutlaw.id, championId: null },
    });
    const deck = DeckSummary.parse(await res.json());
    const slots = slotsOf(deck.id).map((slot) => [slot.cardId, slot.board, slot.quantity]);
    expect(slots).toEqual(
      expect.arrayContaining([
        [sampleCards.sennaOutlaw.id, 'legend', 1],
        [sampleCards.jinxRebel.id, 'main', 3],
        [sampleCards.fierceBlast.id, 'main', 2],
      ]),
    );
    expect(slots).toHaveLength(3);
  });

  it('answers 404 for a preview the server doesn’t hold', async () => {
    const res = await api['deck-lists'][':previewId'].create.$post({
      param: { previewId: 'dlp_gone' },
      json: { name: 'Gone', legendId: sampleCards.jinxLooseCannon.id, championId: null },
    });
    expect(res.status).toBe(404);
  });
});

describe('updating a deck from a deck list', () => {
  const box = (deckId: number) =>
    db.select().from(decks).where(eq(decks.id, deckId)).get()?.deckBoxId ?? 0;

  function jinxDeck() {
    const deckId = createDeck(db, {
      name: 'Jinx Burn',
      slots: [
        { cardId: sampleCards.jinxLooseCannon.id, board: 'legend', quantity: 1 },
        { cardId: sampleCards.fierceBlast.id, board: 'main', quantity: 3, tags: ['Removal'] },
        { cardId: sampleCards.stormSage.id, board: 'main', quantity: 2 },
        { cardId: sampleCards.furyRune.id, board: 'rune', quantity: 8 },
      ],
    });
    db.update(deckSlots)
      .set({ pickedPrintingId: samplePrintings.fierceBlast.printingId })
      .where(and(eq(deckSlots.deckId, deckId), eq(deckSlots.cardId, sampleCards.fierceBlast.id)))
      .run();
    return deckId;
  }

  const newList = [
    'Legend:',
    '1 Jinx, Loose Cannon',
    'Main:',
    '3 Fierce Blast',
    '3 Swift Ox',
    'Runes:',
    '6 Fury Rune',
  ].join('\n');

  it('previews what changes', async () => {
    const deckId = jinxDeck();
    const answer = await preview({ text: newList, deckId });
    expect(answer.changes?.added.map((slot) => slot.card.id)).toEqual([sampleCards.swiftOx.id]);
    expect(answer.changes?.removed).toEqual([
      expect.objectContaining({
        card: expect.objectContaining({ id: sampleCards.stormSage.id }),
        quantity: 2,
        lineNumbers: [],
      }),
    ]);
    expect(answer.changes?.changed).toEqual([
      expect.objectContaining({ board: 'rune', from: 8, to: 6 }),
    ]);
    expect(answer.lines.filter((line) => line.isNew).map((line) => line.text)).toEqual([
      '3 Swift Ox',
    ]);
  });

  it('replaces the slots, keeping picked printings and tags of cards that stay', async () => {
    const deckId = jinxDeck();
    const res = await api.decks[':id']['deck-list'].$post({
      param: { id: String(deckId) },
      json: { text: newList },
    });
    expect(res.status).toBe(200);
    const answer = DeckListUpdated.parse(await res.json());
    expect(answer).toMatchObject({
      message: 'Updated Jinx Burn: 3 cards added, 2 removed, 1 changed',
      needsSwap: false,
    });
    const slots = slotsOf(deckId);
    expect(slots.map((slot) => [slot.cardId, slot.board, slot.quantity])).toEqual(
      expect.arrayContaining([
        [sampleCards.fierceBlast.id, 'main', 3],
        [sampleCards.swiftOx.id, 'main', 3],
        [sampleCards.furyRune.id, 'rune', 6],
      ]),
    );
    expect(slots.some((slot) => slot.cardId === sampleCards.stormSage.id)).toBe(false);
    const blast = slots.find((slot) => slot.cardId === sampleCards.fierceBlast.id);
    expect(blast?.pickedPrintingId).toBe(samplePrintings.fierceBlast.printingId);
    const tags = db
      .select()
      .from(deckSlotTags)
      .where(eq(deckSlotTags.slotId, blast?.id ?? 0))
      .all();
    expect(tags.map((row) => row.tag)).toEqual(['Removal']);
  });

  it('answers that the swap list is needed when the deck box holds copies', async () => {
    const deckId = jinxDeck();
    db.insert(copyStacks)
      .values({
        printingId: samplePrintings.stormSage.printingId,
        quantity: 2,
        finish: 'normal',
        condition: 'near_mint',
        language: 'en',
        locationId: box(deckId),
      })
      .run();
    const answer = await updateFromDeckList(db, deckId, { text: newList });
    expect(answer.needsSwap).toBe(true);
  });

  it('answers 404 for a deck that doesn’t exist', async () => {
    const res = await api.decks[':id']['deck-list'].$post({
      param: { id: '404' },
      json: { text: newList },
    });
    expect(res.status).toBe(404);
  });
});
