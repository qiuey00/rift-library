import { hc } from 'hono/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppType } from '../../src/server/app';
import { app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import {
  cards,
  copyStacks,
  deckSlots,
  decks,
  locations,
  printings,
} from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { type CheckSlot, checkList } from '../../src/server/queries/deck-checks';
import { demandWarnings } from '../../src/server/queries/demand';
import type { Board } from '../../src/shared/api/common';
import { ErrorBody } from '../../src/shared/api/common';
import { CardDecks, DeckChecks, ListChecks } from '../../src/shared/api/deck-checks';

const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;

type CardInput = Partial<typeof cards.$inferInsert> & { name: string };

/** Adds a card with one printing; its oracle id and printing id are made from the name. */
function card(input: CardInput) {
  const oracleId = `oracle-${input.name}`;
  db.insert(cards)
    .values({
      oracleId,
      frontFaceName: input.name,
      typeLine: 'Artifact',
      commanderLegality: 'legal',
      ...input,
    })
    .run();
  db.insert(printings)
    .values({
      scryfallId: `print-${input.name}`,
      oracleId,
      setCode: 'tst',
      setName: 'Test Set',
      collectorNumber: '1',
      lang: 'en',
      finishes: ['nonfoil'],
      rarity: 'common',
      releasedAt: '2024-01-01',
      imageSmall: `https://img/${input.name}.jpg`,
    })
    .run();
  return oracleId;
}

const legend = (name: string, colorIdentity: string, more: Partial<CardInput> = {}) =>
  card({
    name,
    colorIdentity,
    typeLine: 'Legendary Creature — Human',
    canBeCommander: true,
    ...more,
  });

const basic = (name: string, colorIdentity: string) =>
  card({ name, colorIdentity, typeLine: 'Basic Land — Forest', isBasicLand: true });

function location(name: string, type: 'box' | 'deck_box' = 'box') {
  return db.insert(locations).values({ name, type }).returning().get().id;
}

function deck(name: string, slots: [string, Board, number][], deleted = false) {
  const deckBoxId = location(`${name} box`, 'deck_box');
  const id = db
    .insert(decks)
    .values({ name, deckBoxId, deletedAt: deleted ? '2026-10-19T00:00:00Z' : null })
    .returning()
    .get().id;
  for (const [oracleId, board, quantity] of slots) {
    db.insert(deckSlots).values({ deckId: id, oracleId, board, quantity }).run();
  }
  return { id, deckBoxId };
}

function copies(oracleId: string, locationId: number, quantity: number, isProxy = false) {
  db.insert(copyStacks)
    .values({
      scryfallId: oracleId.replace('oracle-', 'print-'),
      quantity,
      finish: 'nonfoil',
      condition: 'near_mint',
      language: 'en',
      isProxy,
      locationId,
    })
    .run();
}

const kinds = (slots: CheckSlot[]) => checkList(db, slots).map((w) => w.kind);
const warningsOf = (slots: CheckSlot[], kind: string) =>
  checkList(db, slots).filter((w) => w.kind === kind);
const slot = (oracleId: string, board: Board = 'main', quantity = 1): CheckSlot => ({
  oracleId,
  board,
  quantity,
});

beforeEach(() => {
  db = createTestDb();
  setDb(db);
});

/** A legal 100-card Golgari deck: the commander, 60 different spells and 39 Forests. */
function legalDeck() {
  const commander = legend('Meren', 'BG');
  const spells = Array.from({ length: 60 }, (_, i) =>
    card({ name: `Spell ${i}`, colorIdentity: 'G' }),
  );
  const forest = basic('Forest', 'G');
  return {
    commander,
    forest,
    slots: [slot(commander, 'commander'), ...spells.map((s) => slot(s)), slot(forest, 'main', 39)],
  };
}

describe('deck checks', () => {
  it('finds nothing wrong with a legal deck, and ignores the maybe board', () => {
    const { slots } = legalDeck();
    const banned = card({ name: 'Dockside', commanderLegality: 'banned', colorIdentity: 'R' });
    expect(checkList(db, [...slots, slot(banned, 'maybe', 3)])).toEqual([]);
  });

  it('counts commander plus main to exactly 100', () => {
    const { slots, forest } = legalDeck();
    const short = slots.map((s) => (s.oracleId === forest ? { ...s, quantity: 37 } : s));
    const [count] = warningsOf(short, 'count');
    expect(count.message).toContain('98 of 100 cards');
    expect(count.cards).toEqual([]);

    const over = slots.map((s) => (s.oracleId === forest ? { ...s, quantity: 41 } : s));
    expect(warningsOf(over, 'count')[0].message).toContain('102 cards, 2 over 100');
  });

  it('warns on a card above one copy, but not a basic land or a card that allows many', () => {
    const commander = legend('Meren', 'BG');
    const growth = card({ name: 'Rampant Growth', colorIdentity: 'G' });
    const rats = card({ name: 'Relentless Rats', colorIdentity: 'B', allowsMany: true });
    const swamp = basic('Swamp', 'B');
    const warnings = warningsOf(
      [
        slot(commander, 'commander'),
        slot(growth, 'main', 2),
        slot(rats, 'main', 20),
        slot(swamp, 'main', 30),
      ],
      'singleton',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe(
      'Rampant Growth is in the deck 2 times. Commander allows one copy of each card except basic lands.',
    );
    expect(warnings[0].cards.map((c) => c.name)).toEqual(['Rampant Growth']);
  });

  it('counts a card on both commander and main boards as two copies', () => {
    const commander = legend('Meren', 'BG');
    expect(kinds([slot(commander, 'commander'), slot(commander)])).toContain('singleton');
  });

  it('lists every card outside the commanders’ colors, off-color basic lands included', () => {
    const commander = legend('Hearthhull', 'BRG');
    const swords = card({ name: 'Swords to Plowshares', colorIdentity: 'W' });
    const island = basic('Island', 'U');
    const signet = card({ name: 'Arcane Signet', colorIdentity: '' });

    const one = warningsOf(
      [slot(commander, 'commander'), slot(swords), slot(signet)],
      'color_identity',
    );
    expect(one[0].message).toBe(
      "Swords to Plowshares is white, which is outside Hearthhull's colors (black, red and green).",
    );

    const two = warningsOf(
      [slot(commander, 'commander'), slot(swords), slot(island)],
      'color_identity',
    );
    expect(two).toHaveLength(1);
    expect(two[0].cards.map((c) => c.name)).toEqual(['Swords to Plowshares', 'Island']);
    expect(two[0].message).toContain('2 cards are outside');
  });

  it('combines two commanders’ colors', () => {
    const tymna = legend('Tymna', 'WB', { keywords: ['Partner'] });
    const thrasios = legend('Thrasios', 'GU', { keywords: ['Partner'] });
    const growth = card({ name: 'Rampant Growth', colorIdentity: 'G' });
    expect(
      kinds([slot(tymna, 'commander'), slot(thrasios, 'commander'), slot(growth)]),
    ).not.toContain('color_identity');
  });

  it('warns on banned and not legal cards', () => {
    const commander = legend('Hearthhull', 'BRG');
    const dockside = card({ name: 'Dockside', colorIdentity: 'R', commanderLegality: 'banned' });
    const unglued = card({ name: 'Silly', colorIdentity: '', commanderLegality: 'not_legal' });
    const warnings = warningsOf(
      [slot(commander, 'commander'), slot(dockside), slot(unglued)],
      'banned',
    );
    expect(warnings.map((w) => w.message)).toEqual([
      'Dockside is banned in Commander.',
      "Silly isn't legal in Commander.",
    ]);
  });

  describe('commanders', () => {
    const commanderWarnings = (...ids: string[]) =>
      warningsOf(
        ids.map((id) => slot(id, 'commander')),
        'commander',
      );

    it('warns when there is no commander', () => {
      const growth = card({ name: 'Rampant Growth', colorIdentity: 'G' });
      expect(warningsOf([slot(growth)], 'commander')[0].message).toBe('The deck has no commander.');
    });

    it('warns on a commander that can’t be one', () => {
      const bear = card({ name: 'Grizzly Bears', typeLine: 'Creature — Bear', colorIdentity: 'G' });
      expect(commanderWarnings(bear)[0].message).toBe("Grizzly Bears can't be a commander.");
    });

    it.each([
      ['Partner', ['Partner'], ['Partner'], 'Legendary Creature — Human'],
      ['Partner with', ['Partner with'], ['Partner with'], 'Legendary Creature — Human'],
      ['Friends forever', ['Friends forever'], ['Friends forever'], 'Legendary Creature — Human'],
      ["Doctor's companion", ["Doctor's companion"], [], 'Legendary Creature — Time Lord Doctor'],
    ])('accepts a %s pair', (_name, firstKeywords, secondKeywords, secondType) => {
      const a = legend('First', 'W', { keywords: firstKeywords });
      const b = legend('Second', 'U', { keywords: secondKeywords, typeLine: secondType });
      expect(commanderWarnings(a, b)).toEqual([]);
    });

    it('accepts "Choose a Background" with a Background, which can’t lead alone', () => {
      const wilson = legend('Wilson', 'G', { keywords: ['Choose a background'] });
      const background = card({
        name: 'Raised by Giants',
        colorIdentity: 'G',
        typeLine: 'Legendary Enchantment — Background',
      });
      expect(commanderWarnings(wilson, background)).toEqual([]);
      expect(commanderWarnings(background)[0].message).toContain(
        'can be a commander only beside a commander with "Choose a Background"',
      );
    });

    it('warns on two commanders that aren’t a valid pair', () => {
      const a = legend('Hearthhull', 'BRG');
      const b = legend('Szarel', 'BG', { keywords: ['Partner'] });
      const [warning] = commanderWarnings(a, b);
      expect(warning.message).toContain("Hearthhull and Szarel can't both be commanders");
      expect(warning.cards.map((c) => c.name)).toEqual(['Hearthhull', 'Szarel']);
    });

    it('warns on a Doctor’s companion beside a commander that isn’t a Time Lord Doctor', () => {
      const a = legend('Companion', 'W', { keywords: ["Doctor's companion"] });
      const b = legend('Not a Doctor', 'U', { typeLine: 'Legendary Creature — Human' });
      expect(commanderWarnings(a, b)).toHaveLength(1);
    });

    it('warns on more than two commanders', () => {
      const ids = ['A', 'B', 'C'].map((n) => legend(n, 'W', { keywords: ['Partner'] }));
      expect(commanderWarnings(...ids)[0].message).toBe(
        "A, B and C can't all be commanders: a deck has at most two.",
      );
    });
  });
});

describe('deck demand', () => {
  it('warns when decks want more copies than Jeff owns, counting proxies', () => {
    const signet = card({ name: 'Arcane Signet' });
    const box = location('Long box');
    copies(signet, box, 1);
    copies(signet, box, 1, true);
    const a = deck('Hearthhull', [[signet, 'main', 1]]);
    deck('Atraxa', [[signet, 'main', 1]]);
    deck('Meren', [[signet, 'main', 1]]);
    copies(signet, a.deckBoxId, 1); // a copy already in a deck box is still owned

    expect(demandWarnings(db, [signet]).size).toBe(0);
    deck('Prosper', [[signet, 'commander', 1]]);

    const warning = demandWarnings(db, [signet]).get(signet);
    expect(warning).toMatchObject({
      demand: 4,
      owned: 3,
      shortage: 1,
      message: '4 decks want Arcane Signet, you own 3',
    });
    expect(warning?.decks.map((d) => d.name)).toEqual(['Hearthhull', 'Atraxa', 'Meren', 'Prosper']);
  });

  it('leaves out maybe boards, basic lands and deleted decks', () => {
    const signet = card({ name: 'Arcane Signet' });
    const forest = basic('Forest', 'G');
    deck('Maybe', [
      [signet, 'maybe', 1],
      [forest, 'main', 30],
    ]);
    deck('Gone', [[signet, 'main', 1]], true);
    expect(demandWarnings(db, [signet, forest]).size).toBe(0);
  });

  it('says how many copies when one deck wants several', () => {
    const rats = card({ name: 'Relentless Rats', allowsMany: true });
    deck('Rats', [[rats, 'main', 20]]);
    expect(demandWarnings(db, [rats]).get(rats)?.message).toBe(
      '1 deck wants 20 copies of Relentless Rats, you own 0',
    );
  });
});

describe('deck checks routes', () => {
  it('GET /api/decks/:id/checks gives the warnings and this deck’s demand', async () => {
    const meren = legend('Meren', 'BG');
    const signet = card({ name: 'Arcane Signet' });
    const other = card({ name: 'Sol Ring' });
    const d = deck('Meren', [
      [meren, 'commander', 1],
      [signet, 'main', 1],
    ]);
    deck('Other', [[other, 'main', 1]]);
    copies(meren, location('Binder'), 1);

    const res = await api.decks[':id'].checks.$get({ param: { id: String(d.id) } });
    expect(res.status).toBe(200);
    const checks = DeckChecks.parse(await res.json());
    expect(checks.warnings.map((w) => w.kind)).toEqual(['count']);
    expect(checks.demand.map((w) => w.card.name)).toEqual(['Arcane Signet']);
    expect(checks.demand[0].card.imageSmall).toBe('https://img/Arcane Signet.jpg');
  });

  it('GET /api/decks/:id/checks answers 404 for a deleted deck', async () => {
    const d = deck('Gone', [], true);
    const res = await api.decks[':id'].checks.$get({ param: { id: String(d.id) } });
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('deck_not_found');
  });

  it('POST /api/deck-checks checks an unsaved list', async () => {
    const growth = card({ name: 'Rampant Growth', colorIdentity: 'G' });
    const res = await api['deck-checks'].$post({
      json: { slots: [{ oracleId: growth, board: 'main', quantity: 2 }] },
    });
    expect(res.status).toBe(200);
    expect(ListChecks.parse(await res.json()).warnings.map((w) => w.kind)).toEqual([
      'count',
      'commander',
      'singleton',
    ]);
  });

  it('GET /api/cards/:oracleId/decks lists each deck and board with the card, and its demand', async () => {
    const signet = card({ name: 'Arcane Signet' });
    const a = deck('Hearthhull', [[signet, 'main', 1]]);
    copies(signet, a.deckBoxId, 1);
    deck('Prosper', [[signet, 'maybe', 1]]);
    deck('Atraxa', [[signet, 'main', 1]]);
    deck('Gone', [[signet, 'main', 1]], true);

    const res = await api.cards[':oracleId'].decks.$get({ param: { oracleId: signet } });
    expect(res.status).toBe(200);
    const answer = CardDecks.parse(await res.json());
    expect(answer.decks.map((d) => [d.name, d.board, d.quantity, d.state])).toEqual([
      ['Hearthhull', 'main', 1, 'assembled'],
      ['Prosper', 'maybe', 1, 'not_assembled'],
      ['Atraxa', 'main', 1, 'not_assembled'],
    ]);
    expect(answer.demand?.message).toBe('2 decks want Arcane Signet, you own 1');

    const unknown = await api.cards[':oracleId'].decks.$get({ param: { oracleId: 'nope' } });
    expect(unknown.status).toBe(404);
  });
});
