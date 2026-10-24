import type { ErrorBody } from '../common';
import type { PutAwayResponse, ReturnResult } from '../put-away';
import { cards, decks, inJinxBurnBox, locations, printings, putAwayLine } from './jinx-burn';

// What GET /api/decks/1/put-away answers for the partly assembled Jinx Burn deck, and what
// POST /api/decks/1/returns answers.

const { toSort, chaosCalm, lands, raresBinder } = locations;

export const putAwaySample: PutAwayResponse = {
  deck: { ...decks.jinxBurn, state: 'partly_assembled' },
  groups: [
    {
      // A proxy added straight into the box has no came-from location, so it goes to the inbox.
      location: toSort,
      lines: [
        putAwayLine(
          inJinxBurnBox(301, cards.volibearPathfinder, printings.volibearPathfinderOgn, null, {
            isProxy: true,
          }),
        ),
      ],
    },
    {
      location: chaosCalm,
      lines: [
        putAwayLine(inJinxBurnBox(302, cards.ironInsight, printings.ironInsightOgn, chaosCalm)),
        putAwayLine(inJinxBurnBox(303, cards.dawnMend, printings.dawnMendOgn, chaosCalm)),
        putAwayLine(inJinxBurnBox(304, cards.sunkenEdict, printings.sunkenEdictOgn, chaosCalm)),
      ],
    },
    {
      location: lands,
      lines: [
        putAwayLine(inJinxBurnBox(305, cards.eagerSteppe, printings.eagerSteppeOgn, lands)),
        putAwayLine(inJinxBurnBox(306, cards.weatheredCanyon, printings.weatheredCanyonOgn, lands)),
      ],
    },
    {
      location: raresBinder,
      lines: [
        putAwayLine(
          inJinxBurnBox(307, cards.jinxBurn, printings.jinxBurnOgn, raresBinder, {
            finish: 'foil',
          }),
        ),
      ],
    },
  ],
  totals: { lines: 7, cards: 7 },
};

/** Ticking one line. */
export const returnResultSample: ReturnResult = {
  message: 'Returned Iron Insight to Long box › Chaos & Calm',
  batchId: 32,
  movementIds: [415],
};

/** Return all. */
export const returnAllResultSample: ReturnResult = {
  message: 'Returned 7 cards',
  batchId: 32,
  movementIds: [415, 416, 417, 418, 419, 420, 421],
};

/** 400 when Send elsewhere picks a deck box. */
export const deckBoxDestinationErrorSample: ErrorBody = {
  error: {
    code: 'deck_box_destination',
    message: "Cards can't be put away into a deck box. Pick a storage location instead.",
  },
};
