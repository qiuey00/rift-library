import type { CardDecks, DeckChecks, DemandWarning, ListChecks } from '../deck-checks';
import { cards } from './deck-cards';
import { deckRefs } from './decks';

// Deck checks with a check for each of Riftbound's deck rules, several of them warnings, so
// screens can show both, and the demand warning for Ember Signet. The warnings name cards a
// messier list would have.

const { jinxBurn, luxControl, ahriMidrange, annieAggro } = deckRefs;

export const emberSignetDemand: DemandWarning = {
  card: cards.emberSignet,
  demand: 3,
  owned: 2,
  shortage: 1,
  decks: [jinxBurn, luxControl, ahriMidrange],
  message: '3 decks want Ember Signet, you own 2',
};

const jinx = cards.jinxLooseCannon;

/** GET /api/decks/1/checks: Jinx Burn keeps five rules and breaks five. */
export const deckChecksSample: DeckChecks = {
  checks: [
    { code: 'legend', result: 'pass', message: 'The Legend is Jinx, Loose Cannon.', cards: [] },
    {
      code: 'champion',
      result: 'warn',
      message: 'The deck has no Chosen Champion. Pick a Jinx champion unit.',
      cards: [],
    },
    {
      code: 'main_count',
      result: 'warn',
      message: 'The main deck has 38 cards; it needs at least 40.',
      cards: [],
    },
    {
      code: 'copies',
      result: 'warn',
      message: 'Scorched Rally is in the deck 4 times. A deck can have at most 3 copies of a card.',
      cards: [cards.scorchedRally],
    },
    {
      code: 'signature',
      result: 'pass',
      message: 'The deck has no signature cards.',
      cards: [],
    },
    {
      code: 'domains',
      result: 'warn',
      message: `Dawn Snare is Order, which is outside ${jinx.name}’s domains (Fury and Chaos).`,
      cards: [cards.dawnSnare],
    },
    {
      code: 'runes',
      result: 'warn',
      message: 'The deck has 10 runes; it needs 12.',
      cards: [],
    },
    {
      code: 'battlefields',
      result: 'pass',
      message: 'The deck has 3 battlefields with different names.',
      cards: [],
    },
    { code: 'sideboard', result: 'pass', message: 'The deck has no sideboard.', cards: [] },
    { code: 'deckable', result: 'pass', message: 'Every card can go in a deck.', cards: [] },
  ],
  demand: [emberSignetDemand],
};

/** POST /api/deck-checks: the same checks for an unsaved list. */
export const listChecksSample: ListChecks = { checks: deckChecksSample.checks };

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
