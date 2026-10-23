import { z } from 'zod';

// Card data: the card data file the app loads, and the Refresh card data button. Nothing
// loads card data until the Riftcodex sync (#7).
//
//   GET  /api/card-data/status   → CardDataStatus
//   POST /api/card-data/refresh  → CardDataStatus, as the refresh starts; it runs in the
//                                  background, so ask for the status to follow it.
//                                  409 `refresh_running` while a download or load runs.

/**
 * - idle: no card data yet and nothing running (the first start, before the download begins).
 * - downloading: fetching the card data file.
 * - loading: writing the downloaded cards and printings into the database.
 * - ready: card data is loaded and nothing is running.
 * - error: the last download or load failed; `error` says why, and any card data loaded
 *   before keeps working.
 */
export const CardDataState = z.enum(['idle', 'downloading', 'loading', 'ready', 'error']);
export type CardDataState = z.infer<typeof CardDataState>;

export const CardDataStatus = z.object({
  state: CardDataState,
  /** How far the current download or load is, from 0 to 1: 0 when idle, 1 when ready. */
  progress: z.number().min(0).max(1),
  /** When the file the app last loaded was made (UTC); null before the first load. */
  bulkUpdatedAt: z.iso.datetime().nullable(),
  /** When the app last checked for a newer file (UTC); null before the first check. */
  lastCheckedAt: z.iso.datetime().nullable(),
  /**
   * Cards and printings the app has now. A load swaps new data in at the end, so while one
   * runs these are still the counts from before (0 on the first load).
   */
  cardCount: z.number().int().nonnegative(),
  printingCount: z.number().int().nonnegative(),
  /** Why the last download or load failed, written for Jeff; null unless state is error. */
  error: z.string().nullable(),
});
export type CardDataStatus = z.infer<typeof CardDataStatus>;
