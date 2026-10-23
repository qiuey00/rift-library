import type { CardDecks, DeckChecks, DemandWarning, ListChecks } from '../deck-checks';
import { cards } from './deck-cards';
import { deckRefs } from './decks';

// Deck checks with one warning of each kind, so screens can show them all, and the demand
// warning for Arcane Signet. Only the card count matches the Hearthhull slots; the other
// warnings name cards a messier list would have.

const { hearthhull, atraxa, meren, prosper } = deckRefs;

export const arcaneSignetDemand: DemandWarning = {
  card: cards.arcaneSignet,
  demand: 3,
  owned: 2,
  shortage: 1,
  decks: [hearthhull, atraxa, meren],
  message: '3 decks want Arcane Signet, you own 2',
};

/** GET /api/decks/1/checks. */
export const deckChecksSample: DeckChecks = {
  warnings: [
    {
      kind: 'count',
      message: 'The deck has 95 cards. A Commander deck has exactly 100, counting the commander.',
      cards: [],
    },
    {
      kind: 'singleton',
      message:
        'Rampant Growth is in the deck 2 times. Commander allows one copy of each card except basic lands.',
      cards: [cards.rampantGrowth],
    },
    {
      kind: 'color_identity',
      message:
        "Swords to Plowshares is white, which is outside Hearthhull, the Worldseed's colors (black, red and green).",
      cards: [cards.swordsToPlowshares],
    },
    {
      kind: 'banned',
      message: 'Dockside Extortionist is banned in Commander.',
      cards: [cards.docksideExtortionist],
    },
    {
      kind: 'commander',
      message:
        "Hearthhull, the Worldseed and Szarel, Genesis Shepherd can't both be commanders: only cards with Partner can share the command zone.",
      cards: [cards.hearthhullTheWorldseed, cards.szarelGenesisShepherd],
    },
  ],
  demand: [arcaneSignetDemand],
};

/** POST /api/deck-checks: the same warnings for an unsaved list. */
export const listChecksSample: ListChecks = { warnings: deckChecksSample.warnings };

/** GET /api/cards/:oracleId/decks for Arcane Signet. Prosper only has it on the maybe board, which demand leaves out. */
export const cardDecksSample: CardDecks = {
  decks: [
    { ...hearthhull, state: 'partly_assembled', board: 'main', quantity: 1 },
    { ...atraxa, state: 'assembled', board: 'main', quantity: 1 },
    { ...meren, state: 'assembled', board: 'main', quantity: 1 },
    { ...prosper, state: 'not_assembled', board: 'maybe', quantity: 1 },
  ],
  demand: arcaneSignetDemand,
};
