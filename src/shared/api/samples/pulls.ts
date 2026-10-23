import type { ErrorBody } from '../common';
import type { ProxyResult, PullResult } from '../pulls';
import { decks } from './hearthhull';

// What POST /api/decks/1/pulls and /proxies answer while Jeff walks the Hearthhull pick list.

/** Ticking a line for a copy in storage. */
export const pullResultSample: PullResult = {
  message: 'Pulled Infernal Grasp into Hearthhull deck box',
  batchId: 31,
  movementId: 412,
  otherDeck: null,
};

/** Ticking the line for the Arcane Signet in the Atraxa deck box. */
export const pullFromOtherDeckResultSample: PullResult = {
  message: 'Pulled Arcane Signet into Hearthhull deck box. Atraxa is now partly assembled.',
  batchId: 31,
  movementId: 413,
  otherDeck: decks.atraxa,
};

/** Add proxy on the missing Soul of Windgrace. */
export const proxyResultSample: ProxyResult = {
  message: 'Added a proxy of Soul of Windgrace to Hearthhull deck box',
  batchId: 31,
  movementId: 414,
};

/** 409 from a pull or a return whose copy is no longer where the list showed it. */
export const staleCopyErrorSample: ErrorBody = {
  error: { code: 'stale_copy', message: 'This copy has moved, pick another' },
};
