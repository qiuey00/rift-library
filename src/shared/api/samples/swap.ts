import type { SwapResponse } from '../swap';
import {
  cards,
  decks,
  inHearthhullBox,
  locations,
  pickLine,
  printings,
  putAwayLine,
  stack,
} from './hearthhull';

// What GET /api/decks/1/swap answers once Hearthhull was fully assembled and Jeff updated it
// from a deck list: Rampaging Baloths and Blasphemous Act came out, and World Breaker and Uurg
// moved up from the maybe board.

const { blackGreen, redGold, raresBinder } = locations;

export const swapSample: SwapResponse = {
  deck: { ...decks.hearthhull, state: 'assembled' },
  takeOut: {
    groups: [
      {
        location: blackGreen,
        lines: [
          putAwayLine(
            inHearthhullBox(308, cards.rampagingBaloths, printings.rampagingBalothsEoc, blackGreen),
          ),
        ],
      },
      {
        location: redGold,
        lines: [
          putAwayLine(
            inHearthhullBox(309, cards.blasphemousAct, printings.blasphemousActEoc, redGold),
          ),
        ],
      },
    ],
    count: 2,
  },
  pullIn: {
    groups: [
      {
        location: blackGreen,
        cardCount: 1,
        lines: [pickLine(121, stack(220, cards.uurg, printings.uurgEoc, blackGreen))],
      },
      {
        location: raresBinder,
        cardCount: 1,
        lines: [
          pickLine(122, stack(221, cards.worldBreaker, printings.worldBreakerEoc, raresBinder)),
        ],
      },
    ],
    otherDecks: [],
    missing: [],
    basics: [],
    totals: { lines: 2, cards: 2 },
  },
  counts: { takeOut: 2, pullIn: 2 },
};
