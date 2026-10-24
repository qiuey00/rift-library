import { hc } from 'hono/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppType } from '../../src/server/app';
import { app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { copyStacks, deckSlots, decks, locations } from '../../src/server/db/schema';
import {
  createTestDb,
  insertCard,
  insertPrinting,
  type TestCard,
} from '../../src/server/db/test-db';
import { checkList } from '../../src/server/queries/deck-checks';
import { demandWarnings } from '../../src/server/queries/demand';
import type { Board } from '../../src/shared/api/common';
import { ErrorBody } from '../../src/shared/api/common';
import { CardDecks, DeckChecks, ListChecks } from '../../src/shared/api/deck-checks';

const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;

/** Each test card's printing id, by card id. */
const printingOf = new Map<number, string>();

/** Adds a card with one printing, whose id is made from the name. */
function card(input: TestCard) {
  const cardId = insertCard(db, input);
  const riftcodexId = `print-${input.name}`;
  insertPrinting(db, {
    riftcodexId,
    cardId,
    finishes: ['normal'],
    imageUrl: `https://img/${input.name}.webp`,
  });
  printingOf.set(cardId, riftcodexId);
  return cardId;
}

const legend = (name: string) => card({ name, type: 'legend', domains: ['fury', 'chaos'] });
const rune = (name: string) => card({ name, type: 'rune', domains: ['calm'] });

function location(name: string, type: 'box' | 'deck_box' = 'box') {
  return db.insert(locations).values({ name, type }).returning().get().id;
}

function deck(name: string, slots: [number, Board, number][], deleted = false) {
  const deckBoxId = location(`${name} box`, 'deck_box');
  const id = db
    .insert(decks)
    .values({ name, deckBoxId, deletedAt: deleted ? '2026-10-19T00:00:00Z' : null })
    .returning()
    .get().id;
  for (const [cardId, board, quantity] of slots) {
    db.insert(deckSlots).values({ deckId: id, cardId, board, quantity }).run();
  }
  return { id, deckBoxId };
}

function copies(cardId: number, locationId: number, quantity: number, isProxy = false) {
  db.insert(copyStacks)
    .values({
      printingId: printingOf.get(cardId) ?? '',
      quantity,
      finish: 'normal',
      condition: 'near_mint',
      language: 'en',
      isProxy,
      locationId,
    })
    .run();
}

beforeEach(() => {
  db = createTestDb();
  setDb(db);
});

describe('deck checks', () => {
  // STUB until #16: Riftbound's deck rules come with the deck checks issue.
  it('answers no checks until the Riftbound deck rules are in', () => {
    const jinx = legend('Jinx, Loose Cannon');
    const signet = card({ name: 'Ember Signet' });
    expect(
      checkList(db, [
        { cardId: jinx, board: 'legend', quantity: 1 },
        { cardId: signet, board: 'main', quantity: 5 },
      ]),
    ).toEqual([]);
  });
});

describe('deck demand', () => {
  it('warns when decks want more copies than Jeff owns, counting proxies', () => {
    const signet = card({ name: 'Ember Signet' });
    const box = location('Long box');
    copies(signet, box, 1);
    copies(signet, box, 1, true);
    const a = deck('Jinx Burn', [[signet, 'main', 1]]);
    deck('Lux Control', [[signet, 'main', 1]]);
    deck('Ahri Midrange', [[signet, 'main', 1]]);
    copies(signet, a.deckBoxId, 1); // a copy already in a deck box is still owned

    expect(demandWarnings(db, [signet]).size).toBe(0);
    deck('Annie Aggro', [[signet, 'sideboard', 1]]);

    const warning = demandWarnings(db, [signet]).get(signet);
    expect(warning).toMatchObject({
      demand: 4,
      owned: 3,
      shortage: 1,
      message: '4 decks want Ember Signet, you own 3',
    });
    expect(warning?.decks.map((d) => d.name)).toEqual([
      'Jinx Burn',
      'Lux Control',
      'Ahri Midrange',
      'Annie Aggro',
    ]);
  });

  it('leaves out maybe boards, runes and deleted decks', () => {
    const signet = card({ name: 'Ember Signet' });
    const calmRune = rune('Calm Rune');
    deck('Maybe', [
      [signet, 'maybe', 1],
      [calmRune, 'rune', 12],
    ]);
    deck('Gone', [[signet, 'main', 1]], true);
    expect(demandWarnings(db, [signet, calmRune]).size).toBe(0);
  });

  it('says how many copies when one deck wants several', () => {
    const nomad = card({ name: 'Sly Nomad', type: 'unit' });
    deck('Nomads', [[nomad, 'main', 3]]);
    expect(demandWarnings(db, [nomad]).get(nomad)?.message).toBe(
      '1 deck wants 3 copies of Sly Nomad, you own 0',
    );
  });
});

describe('deck checks routes', () => {
  it('GET /api/decks/:id/checks gives the checks and this deck’s demand', async () => {
    const ahri = legend('Ahri, Nine-Tailed Fox');
    const signet = card({ name: 'Ember Signet' });
    const other = card({ name: 'Sun Disc' });
    const d = deck('Ahri Midrange', [
      [ahri, 'legend', 1],
      [signet, 'main', 1],
    ]);
    deck('Other', [[other, 'main', 1]]);
    copies(ahri, location('Binder'), 1);

    const res = await api.decks[':id'].checks.$get({ param: { id: String(d.id) } });
    expect(res.status).toBe(200);
    const checks = DeckChecks.parse(await res.json());
    expect(checks.checks).toEqual([]);
    expect(checks.demand.map((w) => w.card.name)).toEqual(['Ember Signet']);
    expect(checks.demand[0].card.imageUrl).toBe('https://img/Ember Signet.webp');
  });

  it('GET /api/decks/:id/checks answers 404 for a deleted deck', async () => {
    const d = deck('Gone', [], true);
    const res = await api.decks[':id'].checks.$get({ param: { id: String(d.id) } });
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('deck_not_found');
  });

  it('POST /api/deck-checks checks an unsaved list', async () => {
    const rally = card({ name: 'Scorched Rally', type: 'spell', domains: ['fury'] });
    const res = await api['deck-checks'].$post({
      json: { slots: [{ cardId: rally, board: 'main', quantity: 2 }] },
    });
    expect(res.status).toBe(200);
    expect(ListChecks.parse(await res.json()).checks).toEqual([]);
  });

  it('GET /api/cards/:id/decks lists each deck and board with the card, and its demand', async () => {
    const signet = card({ name: 'Ember Signet' });
    const a = deck('Jinx Burn', [[signet, 'main', 1]]);
    copies(signet, a.deckBoxId, 1);
    deck('Annie Aggro', [[signet, 'maybe', 1]]);
    deck('Lux Control', [[signet, 'main', 1]]);
    deck('Gone', [[signet, 'main', 1]], true);

    const res = await api.cards[':id'].decks.$get({ param: { id: String(signet) } });
    expect(res.status).toBe(200);
    const answer = CardDecks.parse(await res.json());
    expect(answer.decks.map((d) => [d.name, d.board, d.quantity, d.state])).toEqual([
      ['Jinx Burn', 'main', 1, 'assembled'],
      ['Annie Aggro', 'maybe', 1, 'not_assembled'],
      ['Lux Control', 'main', 1, 'not_assembled'],
    ]);
    expect(answer.demand?.message).toBe('2 decks want Ember Signet, you own 1');

    const unknown = await api.cards[':id'].decks.$get({ param: { id: '999' } });
    expect(unknown.status).toBe(404);
  });
});
