import { z } from 'zod';

// Card data: the cards and printings synced from Riftcodex, prices from TCGCSV, and the
// Refresh card data button. Nothing loads card data until the Riftcodex sync (#7).
//
//   GET  /api/card-data/status   → CardDataStatus
//   POST /api/card-data/refresh  → CardDataStatus, as the refresh starts; it runs in the
//                                  background, so ask for the status to follow it.
//                                  409 `refresh_running` while a sync runs.

/**
 * - idle: no card data yet and nothing running (the first start, before the sync begins).
 * - downloading: reading the cards and sets from Riftcodex.
 * - loading: writing the cards and printings into the database.
 * - ready: card data is loaded and nothing is running.
 * - error: the last sync failed; `error` says why, and any card data loaded before keeps
 *   working.
 */
export const CardDataState = z.enum(['idle', 'downloading', 'loading', 'ready', 'error']);
export type CardDataState = z.infer<typeof CardDataState>;

export const CardDataStatus = z.object({
  state: CardDataState,
  /** How far the current sync is, from 0 to 1: 0 when idle, 1 when ready. */
  progress: z.number().min(0).max(1),
  /** When cards were last synced from Riftcodex (UTC); null before the first sync. */
  cardsSyncedAt: z.iso.datetime().nullable(),
  /** When prices were last updated from TCGCSV (UTC); null before the first update. */
  pricesUpdatedAt: z.iso.datetime().nullable(),
  /**
   * Cards and printings the app has now. A sync writes its rows in one transaction at the
   * end, so while one runs these are still the counts from before (0 on the first sync).
   */
  cardCount: z.number().int().nonnegative(),
  printingCount: z.number().int().nonnegative(),
  /** Why the last sync failed, written for Jeff; null unless state is error. */
  error: z.string().nullable(),
});
export type CardDataStatus = z.infer<typeof CardDataStatus>;
