import type { CardDataState, CardDataStatus } from '../card-data';
import type { ErrorBody } from '../common';

// Sample answers for the card data routes, for stub routes and screen tests.

/** One status in each state, as the first load and a later refresh go through them. */
export const cardDataStatusSamples: Record<CardDataState, CardDataStatus> = {
  idle: {
    state: 'idle',
    progress: 0,
    cardsSyncedAt: null,
    pricesUpdatedAt: null,
    cardCount: 0,
    printingCount: 0,
    error: null,
  },
  downloading: {
    state: 'downloading',
    progress: 0.35,
    cardsSyncedAt: null,
    pricesUpdatedAt: '2026-10-19T01:30:02Z',
    cardCount: 0,
    printingCount: 0,
    error: null,
  },
  loading: {
    state: 'loading',
    progress: 0.62,
    cardsSyncedAt: null,
    pricesUpdatedAt: '2026-10-19T01:30:02Z',
    cardCount: 0,
    printingCount: 0,
    error: null,
  },
  ready: {
    state: 'ready',
    progress: 1,
    cardsSyncedAt: '2026-10-18T21:04:31Z',
    pricesUpdatedAt: '2026-10-19T01:30:02Z',
    cardCount: 812,
    printingCount: 1_406,
    error: null,
  },
  error: {
    state: 'error',
    progress: 0.48,
    cardsSyncedAt: '2026-10-11T21:02:17Z',
    pricesUpdatedAt: '2026-10-19T01:30:02Z',
    cardCount: 798,
    printingCount: 1_377,
    error:
      "Couldn't reach Riftcodex, so the app is still using the card data from October 11. Check the internet connection and press Refresh card data to try again.",
  },
};

/** What GET /api/card-data/status answers once card data is loaded. */
export const cardDataStatus = cardDataStatusSamples.ready;

/** What POST /api/card-data/refresh answers as a refresh starts. */
export const cardDataRefreshStarted: CardDataStatus = {
  ...cardDataStatusSamples.ready,
  state: 'downloading',
  progress: 0,
};

/** The 409 POST /api/card-data/refresh answers while a download or load runs. */
export const refreshRunningError: ErrorBody = {
  error: {
    code: 'refresh_running',
    message: 'Card data is already being refreshed. Wait for it to finish.',
  },
};
