import type { ErrorBody } from '../common';
import type { ProxyResult, PullResult } from '../pulls';
import { decks } from './jinx-burn';

// What POST /api/decks/1/pulls and /proxies answer while Jeff walks the Jinx Burn pick list.

/** Ticking a line for a copy in storage. */
export const pullResultSample: PullResult = {
  message: 'Pulled Fierce Blast into Jinx Burn deck box',
  batchId: 31,
  movementId: 412,
  otherDeck: null,
};

/** Ticking the line for the Ember Signet in the Lux Control deck box. */
export const pullFromOtherDeckResultSample: PullResult = {
  message: 'Pulled Ember Signet into Jinx Burn deck box. Lux Control is now partly assembled.',
  batchId: 31,
  movementId: 413,
  otherDeck: decks.luxControl,
};

/** Add proxy on the missing Swift Ox. */
export const proxyResultSample: ProxyResult = {
  message: 'Added a proxy of Swift Ox to Jinx Burn deck box',
  batchId: 31,
  movementId: 414,
};

/** 409 from a pull or a return whose copy is no longer where the list showed it. */
export const staleCopyErrorSample: ErrorBody = {
  error: { code: 'stale_copy', message: 'This copy has moved, pick another' },
};
