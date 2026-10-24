import { inArray } from 'drizzle-orm';
import type { Board, CardSummary, Domain } from '../../shared/api/common';
import type { DeckCheck, DeckCheckCode } from '../../shared/api/deck-checks';
import type { Db } from '../db/database';
import { cards } from '../db/schema';
import { cardImages, cardSummary } from './card-summaries';

// Riftbound deck checks over a list of slots, so they work for a saved deck and an unsaved
// list alike. Each rule passes or warns, and a warning never blocks anything (D-17). The maybe
// board is never checked. The rules are Riftbound's core rules 103.2 to 103.5 and the
// tournament rules' constructed sideboard (601.1.c), checked on 2026-10-24 against both
// documents as last updated 2026-10-09.

type CardRow = typeof cards.$inferSelect;

/** A card the checks read, with how the API shows it. */
export type CheckCard = { row: CardRow; summary: CardSummary };

/** One card on one board, as the checks take it. */
export type CheckSlot = { cardId: number; board: Board; quantity: number };

/** The cards with these ids, with their images. */
export function loadCards(db: Db, cardIds: number[]): Map<number, CheckCard> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return new Map();
  const images = cardImages(db, ids);
  return new Map(
    db
      .select()
      .from(cards)
      .where(inArray(cards.id, ids))
      .all()
      .map((row) => [row.id, { row, summary: cardSummary(row, images.get(row.id)) }]),
  );
}

/** Most copies of a card by name across the champion, main and sideboard boards (103.3.b, 601.1.c.3). */
const MAX_COPIES = 3;
/** Fewest main deck cards, the Chosen Champion included (103.3). */
const MIN_MAIN = 40;
/** Most signature cards in the main deck (103.3.d). */
const MAX_SIGNATURE = 3;
const RUNES = 12;
const BATTLEFIELDS = 3;
/** Most sideboard cards in constructed (tournament rules 601.1.c.1, D-42). */
const MAX_SIDEBOARD = 10;

const DOMAIN_NAMES: Record<Domain, string> = {
  fury: 'Fury',
  calm: 'Calm',
  mind: 'Mind',
  body: 'Body',
  chaos: 'Chaos',
  order: 'Order',
};

/** One card on one board, with every slot of it on that board added up. */
type Held = { card: CheckCard; board: Board; quantity: number };

/** "A", "A and B" or "A, B and C". */
function listOf(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

const domainNames = (domains: Domain[]) => listOf(domains.map((d) => DOMAIN_NAMES[d]));
const names = (held: CheckCard[]) => listOf(held.map((c) => c.row.name));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sum = (held: Held[]) => held.reduce((n, h) => n + h.quantity, 0);
/** Each card once, in the order the list first has it. */
const distinct = (held: Held[]) => [...new Map(held.map((h) => [h.card.row.id, h.card])).values()];

function check(code: DeckCheckCode, problems: string[], pass: string, about: CheckCard[] = []) {
  return problems.length === 0
    ? { code, result: 'pass' as const, message: pass, cards: [] }
    : {
        code,
        result: 'warn' as const,
        message: problems.join(' '),
        cards: about.map((c) => c.summary),
      };
}

/** A check per deck rule for a list of slots (DECK-6), in `DeckCheckCode` order. */
export function checkList(db: Db, slots: CheckSlot[]): DeckCheck[] {
  const checked = slots.filter((slot) => slot.board !== 'maybe');
  const found = loadCards(
    db,
    checked.map((slot) => slot.cardId),
  );
  const merged = new Map<string, Held>();
  for (const slot of checked) {
    const card = found.get(slot.cardId);
    if (!card) continue;
    const key = `${slot.board}:${slot.cardId}`;
    const held = merged.get(key);
    if (held) held.quantity += slot.quantity;
    else merged.set(key, { card, board: slot.board, quantity: slot.quantity });
  }
  const all = [...merged.values()];
  const on = (...boards: Board[]) => all.filter((h) => boards.includes(h.board));

  const legends = on('legend');
  const legendCount = sum(legends);
  const onlyLegend = legendCount === 1 ? legends[0].card : null;
  const legend = onlyLegend?.row.type === 'legend' ? onlyLegend : null;
  const tag = legend?.row.championTag ?? null;

  return [
    legendCheck(legends, legendCount, onlyLegend),
    championCheck(on('champion'), tag),
    mainCountCheck(sum(on('champion', 'main'))),
    copiesCheck(on('champion', 'main', 'sideboard')),
    signatureCheck(on('main'), on('sideboard'), tag),
    domainsCheck(on('champion', 'main', 'battlefield', 'rune', 'sideboard'), legend),
    runesCheck(sum(on('rune'))),
    battlefieldsCheck(on('battlefield')),
    sideboardCheck(sum(on('sideboard'))),
    deckableCheck(all),
  ];
}

function legendCheck(legends: Held[], count: number, only: CheckCard | null): DeckCheck {
  if (count === 0) return check('legend', ['The deck has no Legend. Pick a Champion Legend.'], '');
  if (!only) {
    return check(
      'legend',
      [`The deck has ${count} Legends; it needs exactly 1.`],
      '',
      distinct(legends),
    );
  }
  return check(
    'legend',
    only.row.type === 'legend' ? [] : [`${only.row.name} isn’t a Champion Legend.`],
    `The Legend is ${only.row.name}.`,
    [only],
  );
}

function championCheck(champions: Held[], tag: string | null): DeckCheck {
  const count = sum(champions);
  if (count === 0) {
    const pick = tag ? `Pick a ${tag} champion unit.` : 'Pick a champion unit.';
    return check('champion', [`The deck has no Chosen Champion. ${pick}`], '');
  }
  if (count > 1) {
    return check(
      'champion',
      [`The deck has ${count} Chosen Champions; it needs exactly 1.`],
      '',
      distinct(champions),
    );
  }
  const { card } = champions[0];
  const { name, type, supertype, championTag } = card.row;
  let problem: string | null = null;
  if (type !== 'unit' || supertype !== 'champion') {
    problem = `${name} isn’t a champion unit, so it can’t be the Chosen Champion.`;
  } else if (tag && championTag !== tag) {
    problem = `${name} isn’t a ${tag} champion, so it can’t be the Chosen Champion for this Legend.`;
  }
  return check('champion', problem ? [problem] : [], `The Chosen Champion is ${name}.`, [card]);
}

function mainCountCheck(count: number): DeckCheck {
  return check(
    'main_count',
    count >= MIN_MAIN
      ? []
      : [`The main deck has ${plural(count, 'card')}; it needs at least ${MIN_MAIN}.`],
    `The main deck has ${count} cards.`,
  );
}

function copiesCheck(held: Held[]): DeckCheck {
  const copies = new Map<number, { card: CheckCard; quantity: number }>();
  for (const h of held) {
    const entry = copies.get(h.card.row.id) ?? { card: h.card, quantity: 0 };
    entry.quantity += h.quantity;
    copies.set(h.card.row.id, entry);
  }
  const over = [...copies.values()].filter((c) => c.quantity > MAX_COPIES);
  const limit = `A deck can have at most ${MAX_COPIES} copies of a card.`;
  const problem =
    over.length === 1
      ? `${over[0].card.row.name} is in the deck ${over[0].quantity} times. ${limit}`
      : `${names(over.map((c) => c.card))} are each in the deck more than ${MAX_COPIES} times. ${limit}`;
  return check(
    'copies',
    over.length === 0 ? [] : [problem],
    `No card is in the deck more than ${MAX_COPIES} times.`,
    over.map((c) => c.card),
  );
}

function signatureCheck(main: Held[], sideboard: Held[], tag: string | null): DeckCheck {
  const isSignature = (h: Held) => h.card.row.supertype === 'signature';
  const inMain = main.filter(isSignature);
  const count = sum(inMain);
  const offTag = tag
    ? distinct([...inMain, ...sideboard.filter(isSignature)]).filter(
        (c) => c.row.championTag !== tag,
      )
    : [];
  const problems: string[] = [];
  if (count > MAX_SIGNATURE) {
    problems.push(`The deck has ${count} signature cards; it can have at most ${MAX_SIGNATURE}.`);
  }
  if (offTag.length > 0) {
    problems.push(
      `${names(offTag)} ${offTag.length === 1 ? 'isn’t a' : 'aren’t'} ${tag} signature ${offTag.length === 1 ? 'card' : 'cards'}, so ${offTag.length === 1 ? 'it doesn’t' : 'they don’t'} fit the Legend.`,
    );
  }
  const pass =
    count === 0
      ? 'The deck has no signature cards.'
      : `The deck has ${plural(count, 'signature card')}${tag ? `, all ${tag}` : ''}.`;
  const about = new Set([...(count > MAX_SIGNATURE ? distinct(inMain) : []), ...offTag]);
  return check('signature', problems, pass, [...about]);
}

function domainsCheck(held: Held[], legend: CheckCard | null): DeckCheck {
  if (!legend) return check('domains', [], 'Domains are checked once the deck has a Legend.');
  const identity = new Set(legend.row.domains);
  const outside = distinct(held).filter((c) => c.row.domains.some((d) => !identity.has(d)));
  const theirs = `${legend.row.name}’s domains (${domainNames(legend.row.domains)})`;
  const problem =
    outside.length === 1
      ? `${outside[0].row.name} is ${domainNames(outside[0].row.domains)}, which is outside ${theirs}.`
      : `${names(outside)} are outside ${theirs}.`;
  return check(
    'domains',
    outside.length === 0 ? [] : [problem],
    `Every card is within ${theirs}.`,
    outside,
  );
}

function runesCheck(count: number): DeckCheck {
  return check(
    'runes',
    count === RUNES ? [] : [`The deck has ${plural(count, 'rune')}; it needs ${RUNES}.`],
    `The deck has ${RUNES} runes.`,
  );
}

function battlefieldsCheck(held: Held[]): DeckCheck {
  const count = sum(held);
  const twice = held.filter((h) => h.quantity > 1);
  const problems: string[] = [];
  if (count !== BATTLEFIELDS) {
    problems.push(`The deck has ${plural(count, 'battlefield')}; it needs ${BATTLEFIELDS}.`);
  }
  if (twice.length > 0) {
    problems.push(
      `${names(twice.map((h) => h.card))} ${twice.length === 1 ? 'is' : 'are'} in the deck more than once; the battlefields need different names.`,
    );
  }
  return check(
    'battlefields',
    problems,
    `The deck has ${BATTLEFIELDS} battlefields with different names.`,
    twice.map((h) => h.card),
  );
}

function sideboardCheck(count: number): DeckCheck {
  return check(
    'sideboard',
    count > MAX_SIDEBOARD
      ? [`The sideboard has ${count} cards; it can have at most ${MAX_SIDEBOARD}.`]
      : [],
    count === 0 ? 'The deck has no sideboard.' : `The sideboard has ${plural(count, 'card')}.`,
  );
}

function deckableCheck(held: Held[]): DeckCheck {
  const tokens = distinct(held).filter((c) => !c.row.deckable);
  return check(
    'deckable',
    tokens.length === 0
      ? []
      : [
          `${names(tokens)} ${tokens.length === 1 ? 'is a token, which' : 'are tokens, which'} can’t go in a deck.`,
        ],
    'Every card can go in a deck.',
    tokens,
  );
}
