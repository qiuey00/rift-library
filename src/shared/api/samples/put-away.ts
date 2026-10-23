import type { ErrorBody } from '../common';
import type { PutAwayResponse, ReturnResult } from '../put-away';
import { cards, decks, inHearthhullBox, locations, printings, putAwayLine } from './hearthhull';

// What GET /api/decks/1/put-away answers for the partly assembled Hearthhull deck, and what
// POST /api/decks/1/returns answers.

const { toSort, blackGreen, lands, raresBinder } = locations;

export const putAwaySample: PutAwayResponse = {
  deck: { ...decks.hearthhull, state: 'partly_assembled' },
  groups: [
    {
      // A proxy added straight into the box has no came-from location, so it goes to the inbox.
      location: toSort,
      lines: [
        putAwayLine(
          inHearthhullBox(301, cards.braids, printings.braidsEoc, null, { isProxy: true }),
        ),
      ],
    },
    {
      location: blackGreen,
      lines: [
        putAwayLine(inHearthhullBox(302, cards.farseek, printings.farseekEoc, blackGreen)),
        putAwayLine(inHearthhullBox(303, cards.naturesLore, printings.naturesLoreEoc, blackGreen)),
        putAwayLine(
          inHearthhullBox(304, cards.nightsWhisper, printings.nightsWhisperEoc, blackGreen),
        ),
      ],
    },
    {
      location: lands,
      lines: [
        putAwayLine(inHearthhullBox(305, cards.bojukaBog, printings.bojukaBogEoc, lands)),
        putAwayLine(inHearthhullBox(306, cards.cinderGlade, printings.cinderGladeEoc, lands)),
      ],
    },
    {
      location: raresBinder,
      lines: [
        putAwayLine(
          inHearthhullBox(307, cards.hearthhull, printings.hearthhullEoc, raresBinder, {
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
  message: 'Returned Farseek to Long box › Black & Green',
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
