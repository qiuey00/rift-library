import type { CardDecks, DeckChecks, DemandWarning, ListChecks } from '../deck-checks';
import { cards } from './deck-cards';
import { deckRefs } from './decks';

// Deck checks with a warning for several of Riftbound's deck rules, so screens can show them,
// and the demand warning for Ember Signet. The warnings name cards a messier list would have.
// The server answers no warnings until #16.

const { jinxBurn, luxControl, ahriMidrange, annieAggro } = deckRefs;

export const emberSignetDemand: DemandWarning = {
  card: cards.emberSignet,
  demand: 3,
  owned: 2,
  shortage: 1,
  decks: [jinxBurn, luxControl, ahriMidrange],
  message: '3 decks want Ember Signet, you own 2',
};

/** GET /api/decks/1/checks. */
export const deckChecksSample: DeckChecks = {
  warnings: [
    {
      kind: 'count',
      message: 'The main deck has 38 cards; it needs at least 40.',
      cards: [],
    },
    {
      kind: 'copies',
      message: 'Scorched Rally is in the deck 4 times. A deck can have at most 3 copies of a card.',
      cards: [cards.scorchedRally],
    },
    {
      kind: 'domains',
      message:
        'Dawn Snare is Order, which is outside Jinx, Loose Cannon’s domains (Fury and Chaos).',
      cards: [cards.dawnSnare],
    },
    {
      kind: 'runes',
      message: 'The deck has 10 runes; it needs 12.',
      cards: [],
    },
    {
      kind: 'champion',
      message: 'The deck has no Chosen Champion.',
      cards: [],
    },
  ],
  demand: [emberSignetDemand],
};

/** POST /api/deck-checks: the same warnings for an unsaved list. */
export const listChecksSample: ListChecks = { warnings: deckChecksSample.warnings };

/** GET /api/cards/:id/decks for Ember Signet. Annie Aggro only has it on the maybe board, which demand leaves out. */
export const cardDecksSample: CardDecks = {
  decks: [
    { ...jinxBurn, state: 'partly_assembled', board: 'main', quantity: 1 },
    { ...luxControl, state: 'assembled', board: 'main', quantity: 1 },
    { ...ahriMidrange, state: 'assembled', board: 'main', quantity: 1 },
    { ...annieAggro, state: 'not_assembled', board: 'maybe', quantity: 1 },
  ],
  demand: emberSignetDemand,
};
