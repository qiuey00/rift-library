import type { SwapResponse } from '../swap';
import {
  cards,
  decks,
  inJinxBurnBox,
  locations,
  pickLine,
  printings,
  putAwayLine,
  stack,
} from './jinx-burn';

// What GET /api/decks/1/swap answers once Jinx Burn was fully assembled and Jeff updated it
// from a deck list: Swift Skirmisher and Vigilant Surge came out, and Dawn Harrier and Uurg
// moved up from the maybe board.

const { chaosCalm, furyOrder, raresBinder } = locations;

export const swapSample: SwapResponse = {
  deck: { ...decks.jinxBurn, state: 'assembled' },
  takeOut: {
    groups: [
      {
        location: chaosCalm,
        lines: [
          putAwayLine(
            inJinxBurnBox(308, cards.swiftSkirmisher, printings.swiftSkirmisherOgn, chaosCalm),
          ),
        ],
      },
      {
        location: furyOrder,
        lines: [
          putAwayLine(
            inJinxBurnBox(309, cards.vigilantSurge, printings.vigilantSurgeOgn, furyOrder),
          ),
        ],
      },
    ],
    count: 2,
  },
  pullIn: {
    groups: [
      {
        location: chaosCalm,
        cardCount: 1,
        lines: [
          pickLine(
            121,
            stack(220, cards.volibearVanguard, printings.volibearVanguardOgn, chaosCalm),
          ),
        ],
      },
      {
        location: raresBinder,
        cardCount: 1,
        lines: [
          pickLine(122, stack(221, cards.dawnHarrier, printings.dawnHarrierOgn, raresBinder)),
        ],
      },
    ],
    otherDecks: [],
    missing: [],
    runes: [],
    totals: { lines: 2, cards: 2 },
  },
  counts: { takeOut: 2, pullIn: 2 },
};
