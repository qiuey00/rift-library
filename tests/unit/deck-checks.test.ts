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
import { CardDecks, DeckCheckCode, DeckChecks, ListChecks } from '../../src/shared/api/deck-checks';

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
  type Slot = { cardId: number; board: Board; quantity: number };

  /** A legal Jinx deck: Legend, Chosen Champion, 39 more main deck cards, 3 battlefields, 12 runes and a sideboard. */
  function legalDeck() {
    const jinx = card({
      name: 'Jinx, Loose Cannon',
      type: 'legend',
      domains: ['fury', 'chaos'],
      championTag: 'Jinx',
    });
    const rebel = card({
      name: 'Jinx, Rebel',
      type: 'unit',
      supertype: 'champion',
      domains: ['chaos'],
      championTag: 'Jinx',
    });
    const main = Array.from({ length: 13 }, (_, i) =>
      card({ name: `Main card ${i + 1}`, type: 'spell', domains: i % 2 ? ['fury'] : ['chaos'] }),
    );
    const fields = ['Grove', 'Forge', 'Bridge'].map((name) => card({ name, type: 'battlefield' }));
    const furyRune = card({ name: 'Fury Rune', type: 'rune', domains: ['fury'] });
    const chaosRune = card({ name: 'Chaos Rune', type: 'rune', domains: ['chaos'] });
    const side = card({ name: 'Side card', type: 'spell', domains: ['fury', 'chaos'] });
    const slots: Slot[] = [
      { cardId: jinx, board: 'legend', quantity: 1 },
      { cardId: rebel, board: 'champion', quantity: 1 },
      ...main.map((cardId) => ({ cardId, board: 'main' as const, quantity: 3 })),
      ...fields.map((cardId) => ({ cardId, board: 'battlefield' as const, quantity: 1 })),
      { cardId: furyRune, board: 'rune', quantity: 6 },
      { cardId: chaosRune, board: 'rune', quantity: 6 },
      { cardId: side, board: 'sideboard', quantity: 3 },
    ];
    return { jinx, rebel, main, fields, furyRune, side, slots };
  }

  function result(slots: Slot[], code: DeckCheckCode) {
    const found = checkList(db, slots).find((check) => check.code === code);
    if (!found) throw new Error(`no ${code} check`);
    return { ...found, cards: found.cards.map((c) => c.name) };
  }

  const without = (slots: Slot[], cardId: number, board?: Board) =>
    slots.filter((s) => !(s.cardId === cardId && (!board || s.board === board)));

  it('passes every rule for a legal deck, one check per rule in order', () => {
    const { slots } = legalDeck();
    const checks = checkList(db, slots);
    expect(checks.map((check) => check.code)).toEqual(DeckCheckCode.options);
    expect(checks.filter((check) => check.result === 'warn')).toEqual([]);
    expect(checks.map((check) => check.message)).toEqual([
      'The Legend is Jinx, Loose Cannon.',
      'The Chosen Champion is Jinx, Rebel.',
      'The main deck has 40 cards.',
      'No card is in the deck more than 3 times.',
      'The deck has no signature cards.',
      'Every card is within Jinx, Loose Cannon’s domains (Fury and Chaos).',
      'The deck has 12 runes.',
      'The deck has 3 battlefields with different names.',
      'The sideboard has 3 cards.',
      'Every card can go in a deck.',
    ]);
  });

  it('never checks the maybe board', () => {
    const { slots } = legalDeck();
    const token = card({ name: 'Sprite', type: 'token', deckable: false });
    const order = card({ name: 'Dawn Snare', type: 'spell', domains: ['order'] });
    const maybe: Slot[] = [
      { cardId: token, board: 'maybe', quantity: 5 },
      { cardId: order, board: 'maybe', quantity: 4 },
    ];
    expect(checkList(db, [...slots, ...maybe]).every((c) => c.result === 'pass')).toBe(true);
  });

  it('warns without exactly one Champion Legend', () => {
    const { jinx, slots } = legalDeck();
    expect(result(without(slots, jinx), 'legend')).toMatchObject({
      result: 'warn',
      message: 'The deck has no Legend. Pick a Champion Legend.',
    });
    const lux = card({ name: 'Lux, Lady of Luminosity', type: 'legend', championTag: 'Lux' });
    expect(result([...slots, { cardId: lux, board: 'legend', quantity: 1 }], 'legend')).toEqual({
      code: 'legend',
      result: 'warn',
      message: 'The deck has 2 Legends; it needs exactly 1.',
      cards: ['Jinx, Loose Cannon', 'Lux, Lady of Luminosity'],
    });
    const unit = card({ name: 'Poro Herder', type: 'unit' });
    const notLegend = [
      ...without(slots, jinx),
      { cardId: unit, board: 'legend' as const, quantity: 1 },
    ];
    expect(result(notLegend, 'legend')).toMatchObject({
      result: 'warn',
      message: 'Poro Herder isn’t a Champion Legend.',
      cards: ['Poro Herder'],
    });
  });

  it('warns without one Chosen Champion with the Legend’s champion tag', () => {
    const { rebel, slots } = legalDeck();
    expect(result(without(slots, rebel), 'champion')).toMatchObject({
      result: 'warn',
      message: 'The deck has no Chosen Champion. Pick a Jinx champion unit.',
    });
    const two = slots.map((s) => (s.cardId === rebel ? { ...s, quantity: 2 } : s));
    expect(result(two, 'champion')).toMatchObject({
      result: 'warn',
      message: 'The deck has 2 Chosen Champions; it needs exactly 1.',
      cards: ['Jinx, Rebel'],
    });
    const lux = card({
      name: 'Lux, Crownguard',
      type: 'unit',
      supertype: 'champion',
      championTag: 'Lux',
    });
    const luxDeck = [
      ...without(slots, rebel),
      { cardId: lux, board: 'champion' as const, quantity: 1 },
    ];
    expect(result(luxDeck, 'champion')).toMatchObject({
      result: 'warn',
      message:
        'Lux, Crownguard isn’t a Jinx champion, so it can’t be the Chosen Champion for this Legend.',
      cards: ['Lux, Crownguard'],
    });
    const tibbers = card({
      name: 'Pow-Pow',
      type: 'unit',
      supertype: 'signature',
      championTag: 'Jinx',
    });
    const signature = [
      ...without(slots, rebel),
      { cardId: tibbers, board: 'champion' as const, quantity: 1 },
    ];
    expect(result(signature, 'champion')).toMatchObject({
      result: 'warn',
      message: 'Pow-Pow isn’t a champion unit, so it can’t be the Chosen Champion.',
    });
  });

  it('warns on fewer than 40 main deck cards, the Chosen Champion included', () => {
    const { main, slots } = legalDeck();
    const short = slots.map((s) => (s.cardId === main[0] ? { ...s, quantity: 1 } : s));
    expect(result(short, 'main_count')).toEqual({
      code: 'main_count',
      result: 'warn',
      message: 'The main deck has 38 cards; it needs at least 40.',
      cards: [],
    });
    const more = [
      ...slots,
      { cardId: card({ name: 'Extra', type: 'spell' }), board: 'main' as const, quantity: 2 },
    ];
    expect(result(more, 'main_count')).toMatchObject({
      result: 'pass',
      message: 'The main deck has 42 cards.',
    });
  });

  it('warns on more than 3 copies of a card by name across the champion, main and sideboard boards', () => {
    const { rebel, main, side, slots } = legalDeck();
    // The Chosen Champion counts as one of its copies (103.3.b.1).
    const champion = [...slots, { cardId: rebel, board: 'main' as const, quantity: 2 }];
    expect(result(champion, 'copies').result).toBe('pass');
    const four = [...champion, { cardId: rebel, board: 'sideboard' as const, quantity: 1 }];
    expect(result(four, 'copies')).toEqual({
      code: 'copies',
      result: 'warn',
      message: 'Jinx, Rebel is in the deck 4 times. A deck can have at most 3 copies of a card.',
      cards: ['Jinx, Rebel'],
    });
    // Two slots of one card on a board add up, and the sideboard counts with the main deck.
    const both = [
      ...four,
      { cardId: main[0], board: 'main' as const, quantity: 1 },
      { cardId: side, board: 'main' as const, quantity: 1 },
    ];
    expect(result(both, 'copies')).toMatchObject({
      message:
        'Jinx, Rebel, Main card 1 and Side card are each in the deck more than 3 times. A deck can have at most 3 copies of a card.',
      cards: ['Jinx, Rebel', 'Main card 1', 'Side card'],
    });
  });

  it('warns on more than 3 signature cards or one without the Legend’s champion tag', () => {
    const { slots } = legalDeck();
    const powPow = card({
      name: 'Pow-Pow',
      type: 'gear',
      supertype: 'signature',
      championTag: 'Jinx',
    });
    const zap = card({
      name: 'Zapper',
      type: 'spell',
      supertype: 'signature',
      championTag: 'Jinx',
    });
    const three = [
      ...slots,
      { cardId: powPow, board: 'main' as const, quantity: 2 },
      { cardId: zap, board: 'main' as const, quantity: 1 },
      // The sideboard isn't in the count, only the tag.
      { cardId: zap, board: 'sideboard' as const, quantity: 1 },
    ];
    expect(result(three, 'signature')).toMatchObject({
      result: 'pass',
      message: 'The deck has 3 signature cards, all Jinx.',
    });
    const four = three.map((s) =>
      s.cardId === zap && s.board === 'main' ? { ...s, quantity: 2 } : s,
    );
    expect(result(four, 'signature')).toEqual({
      code: 'signature',
      result: 'warn',
      message: 'The deck has 4 signature cards; it can have at most 3.',
      cards: ['Pow-Pow', 'Zapper'],
    });
    const tibbers = card({
      name: 'Tibbers',
      type: 'unit',
      supertype: 'signature',
      championTag: 'Annie',
    });
    const offTag = [...slots, { cardId: tibbers, board: 'sideboard' as const, quantity: 1 }];
    expect(result(offTag, 'signature')).toEqual({
      code: 'signature',
      result: 'warn',
      message: 'Tibbers isn’t a Jinx signature card, so it doesn’t fit the Legend.',
      cards: ['Tibbers'],
    });
  });

  it('warns on cards outside the Legend’s domains, on every board but the Legend and maybe', () => {
    const { slots } = legalDeck();
    const snare = card({ name: 'Dawn Snare', type: 'spell', domains: ['order'] });
    const blend = card({ name: 'Tidal Rush', type: 'spell', domains: ['fury', 'calm'] });
    const calmRune = card({ name: 'Calm Rune', type: 'rune', domains: ['calm'] });
    const one = [...slots, { cardId: snare, board: 'main' as const, quantity: 1 }];
    expect(result(one, 'domains')).toEqual({
      code: 'domains',
      result: 'warn',
      message:
        'Dawn Snare is Order, which is outside Jinx, Loose Cannon’s domains (Fury and Chaos).',
      cards: ['Dawn Snare'],
    });
    const several = [
      ...one,
      { cardId: blend, board: 'sideboard' as const, quantity: 1 },
      { cardId: calmRune, board: 'rune' as const, quantity: 1 },
    ];
    expect(result(several, 'domains')).toMatchObject({
      message:
        'Dawn Snare, Tidal Rush and Calm Rune are outside Jinx, Loose Cannon’s domains (Fury and Chaos).',
      cards: ['Dawn Snare', 'Tidal Rush', 'Calm Rune'],
    });
  });

  it('leaves the domains for when the deck has a Legend', () => {
    const { jinx, slots } = legalDeck();
    expect(result(without(slots, jinx), 'domains')).toMatchObject({
      result: 'pass',
      message: 'Domains are checked once the deck has a Legend.',
    });
  });

  it('warns without exactly 12 runes', () => {
    const { furyRune, slots } = legalDeck();
    const ten = slots.map((s) => (s.cardId === furyRune ? { ...s, quantity: 4 } : s));
    expect(result(ten, 'runes')).toEqual({
      code: 'runes',
      result: 'warn',
      message: 'The deck has 10 runes; it needs 12.',
      cards: [],
    });
    const thirteen = slots.map((s) => (s.cardId === furyRune ? { ...s, quantity: 7 } : s));
    expect(result(thirteen, 'runes').message).toBe('The deck has 13 runes; it needs 12.');
  });

  it('warns without 3 battlefields with different names', () => {
    const { fields, slots } = legalDeck();
    expect(result(without(slots, fields[2]), 'battlefields')).toMatchObject({
      result: 'warn',
      message: 'The deck has 2 battlefields; it needs 3.',
    });
    const twice = without(slots, fields[2]).map((s) =>
      s.cardId === fields[0] ? { ...s, quantity: 2 } : s,
    );
    expect(result(twice, 'battlefields')).toEqual({
      code: 'battlefields',
      result: 'warn',
      message: 'Grove is in the deck more than once; the battlefields need different names.',
      cards: ['Grove'],
    });
  });

  it('warns on a sideboard of more than 10 cards', () => {
    const { side, slots } = legalDeck();
    expect(result(without(slots, side), 'sideboard')).toMatchObject({
      result: 'pass',
      message: 'The deck has no sideboard.',
    });
    const others = Array.from({ length: 4 }, (_, i) =>
      card({ name: `Side extra ${i + 1}`, type: 'spell', domains: ['fury'] }),
    );
    const ten = [
      ...slots,
      ...others.slice(0, 3).map((cardId) => ({ cardId, board: 'sideboard' as const, quantity: 2 })),
      { cardId: others[3], board: 'sideboard' as const, quantity: 1 },
    ];
    expect(result(ten, 'sideboard')).toMatchObject({
      result: 'pass',
      message: 'The sideboard has 10 cards.',
    });
    const eleven = [...ten, { cardId: others[3], board: 'sideboard' as const, quantity: 1 }];
    expect(result(eleven, 'sideboard')).toEqual({
      code: 'sideboard',
      result: 'warn',
      message: 'The sideboard has 11 cards; it can have at most 10.',
      cards: [],
    });
  });

  it('warns on tokens wherever they are but the maybe board', () => {
    const { slots } = legalDeck();
    const sprite = card({ name: 'Sprite', type: 'token', deckable: false });
    const recruit = card({ name: 'Recruit', type: 'unit', supertype: 'token', deckable: false });
    const one = [...slots, { cardId: sprite, board: 'main' as const, quantity: 2 }];
    expect(result(one, 'deckable')).toEqual({
      code: 'deckable',
      result: 'warn',
      message: 'Sprite is a token, which can’t go in a deck.',
      cards: ['Sprite'],
    });
    const two = [...one, { cardId: recruit, board: 'battlefield' as const, quantity: 1 }];
    expect(result(two, 'deckable')).toMatchObject({
      message: 'Sprite and Recruit are tokens, which can’t go in a deck.',
      cards: ['Sprite', 'Recruit'],
    });
  });

  it('answers the checks for a saved deck and an unsaved list', async () => {
    const { slots } = legalDeck();
    const { id } = deck(
      'Jinx Rebels',
      slots.map((s) => [s.cardId, s.board, s.quantity]),
    );
    const saved = await api.decks[':id'].checks.$get({ param: { id: String(id) } });
    const savedChecks = DeckChecks.parse(await saved.json()).checks;
    expect(savedChecks.map((check) => check.result)).toEqual(
      DeckCheckCode.options.map(() => 'pass'),
    );

    const unsaved = await api['deck-checks'].$post({
      json: { slots: slots.filter((s) => s.board !== 'champion') },
    });
    const listChecks = ListChecks.parse(await unsaved.json()).checks;
    expect(
      listChecks.filter((check) => check.result === 'warn').map((check) => check.code),
    ).toEqual(['champion', 'main_count']);
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
    expect(checks.checks.map((check) => check.code)).toEqual(DeckCheckCode.options);
    expect(checks.checks[0].message).toBe('The Legend is Ahri, Nine-Tailed Fox.');
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
    const { checks } = ListChecks.parse(await res.json());
    expect(checks.find((check) => check.code === 'main_count')?.message).toBe(
      'The main deck has 2 cards; it needs at least 40.',
    );
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
