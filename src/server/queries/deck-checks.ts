import { inArray } from 'drizzle-orm';
import type { Board, CardSummary } from '../../shared/api/common';
import type { DeckWarning } from '../../shared/api/deck-checks';
import type { Db } from '../db/database';
import { cards } from '../db/schema';
import { cardImages, cardSummary } from './decks';

// Commander checks over a list of slots, so they work for a saved deck and an unsaved import
// alike. They are warnings only: a deck in progress is often illegal for a while, and nothing
// is ever blocked. Only the commander and main boards are checked; the maybe board never is.

type CardRow = typeof cards.$inferSelect;

/** A card the checks read, with how the API shows it. */
export type CheckCard = { row: CardRow; summary: CardSummary };

/** One card on one board, as the checks take it. */
export type CheckSlot = { oracleId: string; board: Board; quantity: number };

export const DECK_SIZE = 100;

const COLOR_NAMES: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
};

/** The cards with these oracle ids, with the images of their newest printing, English first. */
export function loadCards(db: Db, oracleIds: string[]): Map<string, CheckCard> {
  const ids = [...new Set(oracleIds)];
  if (ids.length === 0) return new Map();
  const images = cardImages(db, ids);
  return new Map(
    db
      .select()
      .from(cards)
      .where(inArray(cards.oracleId, ids))
      .all()
      .map((row) => [row.oracleId, { row, summary: cardSummary(row, images.get(row.oracleId)) }]),
  );
}

/** The Commander warnings for a list of slots, loading its cards. Unknown cards are left out. */
export function checkList(db: Db, slots: CheckSlot[]): DeckWarning[] {
  return checkSlots(
    slots,
    loadCards(
      db,
      slots.map((slot) => slot.oracleId),
    ),
  );
}

/**
 * The Commander warnings for a list of slots: card count, singleton, color identity, banned
 * cards and the commanders. Slots whose card isn't in `cardsById` are left out.
 */
export function checkSlots(slots: CheckSlot[], cardsById: Map<string, CheckCard>): DeckWarning[] {
  // Commander and main quantities by card, in list order.
  const commanders: CheckCard[] = [];
  const quantities = new Map<string, { card: CheckCard; quantity: number }>();
  for (const slot of slots) {
    const card = cardsById.get(slot.oracleId);
    if (!card || slot.board === 'maybe') continue;
    if (slot.board === 'commander' && !commanders.includes(card)) commanders.push(card);
    const entry = quantities.get(slot.oracleId) ?? { card, quantity: 0 };
    entry.quantity += slot.quantity;
    quantities.set(slot.oracleId, entry);
  }
  const entries = [...quantities.values()];

  return [
    ...countWarnings(entries),
    ...commanderWarnings(commanders),
    ...singletonWarnings(entries),
    ...colorIdentityWarnings(entries, commanders),
    ...bannedWarnings(entries),
  ];
}

function countWarnings(entries: { quantity: number }[]): DeckWarning[] {
  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  if (total === DECK_SIZE) return [];
  const has =
    total < DECK_SIZE
      ? `${total} of ${DECK_SIZE} cards`
      : `${total} cards, ${total - DECK_SIZE} over ${DECK_SIZE}`;
  return [
    {
      kind: 'count',
      message: `The deck has ${has}. A Commander deck has exactly ${DECK_SIZE}, counting the commander.`,
      cards: [],
    },
  ];
}

function singletonWarnings(entries: { card: CheckCard; quantity: number }[]): DeckWarning[] {
  return entries
    .filter(({ card, quantity }) => quantity > 1 && !card.row.isBasicLand && !card.row.allowsMany)
    .map(({ card, quantity }) => ({
      kind: 'singleton',
      message: `${card.row.name} is in the deck ${quantity} times. Commander allows one copy of each card except basic lands.`,
      cards: [card.summary],
    }));
}

function colorIdentityWarnings(
  entries: { card: CheckCard }[],
  commanders: CheckCard[],
): DeckWarning[] {
  // With no commander there are no colors to check against; the commander check says so.
  if (commanders.length === 0) return [];
  const allowed = new Set(commanders.flatMap((card) => [...card.row.colorIdentity]));
  const outside = entries
    .map((entry) => entry.card)
    .filter((card) => [...card.row.colorIdentity].some((color) => !allowed.has(color)));
  if (outside.length === 0) return [];

  const whose = `${joinNames(commanders.map((card) => card.row.name))}'s colors (${colorWords(allowed)})`;
  const message =
    outside.length === 1
      ? `${outside[0].row.name} is ${colorWords(new Set(outside[0].row.colorIdentity))}, which is outside ${whose}.`
      : `${outside.length} cards are outside ${whose}: ${joinNames(outside.map((card) => card.row.name))}.`;
  return [{ kind: 'color_identity', message, cards: outside.map((card) => card.summary) }];
}

function bannedWarnings(entries: { card: CheckCard }[]): DeckWarning[] {
  return entries
    .filter(({ card }) => ['banned', 'not_legal'].includes(card.row.commanderLegality))
    .map(({ card }) => ({
      kind: 'banned',
      message:
        card.row.commanderLegality === 'banned'
          ? `${card.row.name} is banned in Commander.`
          : `${card.row.name} isn't legal in Commander.`,
      cards: [card.summary],
    }));
}

function commanderWarnings(commanders: CheckCard[]): DeckWarning[] {
  const warn = (message: string, list: CheckCard[]): DeckWarning[] => [
    { kind: 'commander', message, cards: list.map((card) => card.summary) },
  ];
  if (commanders.length === 0) return warn('The deck has no commander.', []);
  if (commanders.length > 2) {
    return warn(
      `${joinNames(commanders.map((card) => card.row.name))} can't all be commanders: a deck has at most two.`,
      commanders,
    );
  }

  const warnings: DeckWarning[] = [];
  const [first, second] = commanders;
  // A Background can lead only beside a commander with "Choose a Background".
  const pairedBackground = (card: CheckCard) =>
    isBackground(card) &&
    commanders.some((other) => other !== card && has(other, CHOOSE_BACKGROUND));
  for (const card of commanders) {
    if (card.row.canBeCommander || pairedBackground(card)) continue;
    warnings.push(
      ...warn(
        isBackground(card)
          ? `${card.row.name} can be a commander only beside a commander with "Choose a Background".`
          : `${card.row.name} can't be a commander.`,
        [card],
      ),
    );
  }
  if (second && !validPair(first, second)) {
    warnings.push(
      ...warn(
        `${first.row.name} and ${second.row.name} can't both be commanders: only partners, or a commander with "Choose a Background" and a Background, can share the command zone.`,
        [first, second],
      ),
    );
  }
  return warnings;
}

const PARTNER = 'partner';
const PARTNER_WITH = 'partner with';
const FRIENDS_FOREVER = 'friends forever';
const CHOOSE_BACKGROUND = 'choose a background';
const DOCTORS_COMPANION = "doctor's companion";

/** Card keywords, compared without case. */
function has(card: CheckCard, keyword: string) {
  return card.row.keywords.some((k) => k.toLowerCase() === keyword);
}

function isBackground(card: CheckCard) {
  return /\bBackground\b/.test(card.row.typeLine);
}

function isTimeLordDoctor(card: CheckCard) {
  return /\bTime Lord\b/.test(card.row.typeLine) && /\bDoctor\b/.test(card.row.typeLine);
}

/**
 * Two commanders that may share the command zone. The card data has keywords and type lines
 * but no rules text, so "Partner with" is accepted when both cards have it, without checking
 * that each names the other.
 */
export function validPair(a: CheckCard, b: CheckCard) {
  const both = (keyword: string) => has(a, keyword) && has(b, keyword);
  const oneEach = (x: (c: CheckCard) => boolean, y: (c: CheckCard) => boolean) =>
    (x(a) && y(b)) || (x(b) && y(a));
  return (
    both(PARTNER) ||
    both(PARTNER_WITH) ||
    both(FRIENDS_FOREVER) ||
    oneEach((c) => has(c, CHOOSE_BACKGROUND), isBackground) ||
    oneEach((c) => has(c, DOCTORS_COMPANION), isTimeLordDoctor)
  );
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function colorWords(colors: Set<string>) {
  const words = 'WUBRG'
    .split('')
    .filter((color) => colors.has(color))
    .map((color) => COLOR_NAMES[color]);
  return words.length === 0 ? 'colorless' : joinNames(words);
}
