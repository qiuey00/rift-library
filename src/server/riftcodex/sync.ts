import type { CardDataStatus } from '../../shared/api/card-data';
import type { Db } from '../db/database';
import { cardDataStatus } from '../db/schema';
import { AppError } from '../errors';
import { type PriceReport, updatePrices } from '../tcgcsv/prices';
import { checkRecords, type FetchOptions, fetchAllPages, fetchSetNames } from './fetch';
import { groupCards } from './records';
import { writeCardData } from './write';

// Keeps card data current with no manual step (PLAT-3): when the server starts with no cards,
// and again once the last sync is 24 hours old while the server runs, the app reads every
// card and set from Riftcodex and writes them in one transaction. Refresh card data forces
// one. A failed sync keeps the data loaded before and is tried again at the next check.
// After each card sync, prices are updated from TCGCSV; prices that are 24 hours old (or
// never loaded, or whose last update failed) are updated on their own at the next check.

/** How often the server looks at the age of its card data. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** How old card data may get before the next check syncs. */
export const SYNC_AFTER_MS = 24 * 60 * 60 * 1000;

type Running = { state: 'downloading' | 'loading'; progress: number };

/** What one sync found, as it logs it. */
export interface SyncReport {
  cardCount: number;
  printingCount: number;
  /** Records that didn't match Riftcodex's card schema. */
  skipped: number;
  keptPrintings: number;
  disagreements: ReturnType<typeof groupCards>['disagreements'];
}

/** Whether a check should sync: no cards yet, never synced, or synced 24 hours ago or more. */
export function needsSync(
  cardCount: number,
  cardsSyncedAt: string | null | undefined,
  now = Date.now(),
) {
  if (cardCount === 0 || !cardsSyncedAt) return true;
  return now - Date.parse(cardsSyncedAt) >= SYNC_AFTER_MS;
}

/** Whether a check should update prices: cards loaded, and prices never updated or 24 hours old. */
export function needsPrices(
  cardCount: number,
  pricesUpdatedAt: string | null | undefined,
  now = Date.now(),
) {
  if (cardCount === 0) return false;
  if (!pricesUpdatedAt) return true;
  return now - Date.parse(pricesUpdatedAt) >= SYNC_AFTER_MS;
}

/** Reads every card and set from Riftcodex, groups them and writes them. */
export async function syncCardData(db: Db, options: FetchOptions = {}): Promise<SyncReport> {
  const syncedAt = new Date().toISOString();
  const setNames = await fetchSetNames({ ...options, onPage: undefined });
  const values = await fetchAllPages('/cards', { sort: 'public_code' }, options);
  const { records, skipped } = checkRecords(values);
  if (records.length === 0) throw new Error('Riftcodex listed no cards');
  const { groups, disagreements } = groupCards(records, setNames);
  const { cardIds: _, ...written } = writeCardData(db, groups, { full: true, syncedAt });
  return { ...written, skipped, disagreements };
}

export class CardDataSync {
  private running: Running | undefined;
  private lastError: { message: string; progress: number } | undefined;
  private timer: NodeJS.Timeout | undefined;
  private abort = new AbortController();
  private task: Promise<void> = Promise.resolve();
  private busy = false;

  /** `enabled: false` (RIFTCODEX=off) never calls Riftcodex: no checks, and refresh refuses. */
  constructor(
    private readonly db: Db,
    private readonly enabled = true,
    private readonly fetchOptions: Pick<FetchOptions, 'gapMs'> = {},
  ) {}

  /** Checks now, then every hour until `stop`. */
  start() {
    if (!this.enabled) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    // The timer alone doesn't keep the process running.
    this.timer.unref();
  }

  /** Stops the timer and any sync, as the server closes. */
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.abort.abort();
  }

  status(): CardDataStatus {
    const row = this.db.select().from(cardDataStatus).get();
    const saved = {
      cardsSyncedAt: toIso(row?.cardsSyncedAt),
      pricesUpdatedAt: toIso(row?.pricesUpdatedAt),
      cardCount: row?.cardCount ?? 0,
      printingCount: row?.printingCount ?? 0,
    };
    if (this.running) return { ...this.running, ...saved, error: null };
    if (this.lastError) {
      const { message, progress } = this.lastError;
      return { state: 'error', progress, ...saved, error: message };
    }
    return saved.cardCount > 0
      ? { state: 'ready', progress: 1, ...saved, error: null }
      : { state: 'idle', progress: 0, ...saved, error: null };
  }

  /**
   * Syncs cards (then prices) when there are no cards yet or the last sync is 24 hours old;
   * else updates prices alone when they are 24 hours old; else does nothing.
   */
  async check() {
    if (!this.enabled || this.busy) return;
    const row = this.db.select().from(cardDataStatus).get();
    if (needsSync(row?.cardCount ?? 0, row?.cardsSyncedAt)) await this.run();
    else if (needsPrices(row?.cardCount ?? 0, row?.pricesUpdatedAt)) await this.run('prices');
  }

  /** Refresh card data: syncs whatever the age, in the background. */
  refresh(): CardDataStatus {
    if (!this.enabled) {
      throw new AppError(
        409,
        'card_data_sync_off',
        'Card data syncing is turned off (RIFTCODEX=off), so card data can’t be refreshed.',
      );
    }
    if (this.busy) {
      throw new AppError(
        409,
        'refresh_running',
        'Card data is already being refreshed. Wait for it to finish.',
      );
    }
    void this.run();
    return this.status();
  }

  /** Resolves once the sync running now has ended. */
  finished() {
    return this.task;
  }

  private run(what: 'cards' | 'prices' = 'cards') {
    this.busy = true;
    if (what === 'cards') this.running = { state: 'downloading', progress: 0 };
    const job = what === 'cards' ? this.sync() : this.updatePrices();
    this.task = job.finally(() => {
      this.busy = false;
      this.running = undefined;
    });
    return this.task;
  }

  private async sync() {
    const saved = this.db.select().from(cardDataStatus).get();
    try {
      const report = await syncCardData(this.db, {
        ...this.fetchOptions,
        signal: this.abort.signal,
        onPage: (read, pages) => {
          if (this.running) this.running.progress = read / pages;
          if (read === pages) this.running = { state: 'loading', progress: 1 };
        },
      });
      logReport(report);
      this.lastError = undefined;
    } catch (err) {
      if (this.abort.signal.aborted) return;
      console.error('Card data sync failed:', err);
      this.lastError = {
        message: errorMessage(this.running?.state ?? 'downloading', saved?.cardsSyncedAt),
        progress: this.running?.progress ?? 0,
      };
      return;
    }
    // The cards are in, so the status shows ready while prices load.
    this.running = undefined;
    await this.updatePrices();
  }

  /** Updates prices from TCGCSV. A failure is logged and keeps the old prices. */
  private async updatePrices() {
    try {
      logPrices(await updatePrices(this.db, { ...this.fetchOptions, signal: this.abort.signal }));
    } catch (err) {
      if (this.abort.signal.aborted) return;
      console.error('Price update from TCGCSV failed:', err);
    }
  }
}

function logReport(report: SyncReport) {
  console.log(
    `Synced ${report.cardCount} cards and ${report.printingCount} printings from Riftcodex.`,
  );
  if (report.skipped > 0) {
    console.warn(`Skipped ${report.skipped} Riftcodex records that didn't match the card schema.`);
  }
  if (report.keptPrintings > 0) {
    console.warn(
      `Kept ${report.keptPrintings} printings Riftcodex no longer lists, because copies, slots or the buy list use them.`,
    );
  }
  for (const { name, field, values } of report.disagreements) {
    console.warn(`The printings of ${name} disagree on ${field}: ${values.join(' or ')}.`);
  }
}

function logPrices(report: PriceReport) {
  console.log(
    `Updated prices for ${report.matchedPrintings} printings from ${report.groupCount} TCGCSV groups.`,
  );
  if (report.failedGroups.length > 0) {
    console.warn(
      `Kept the old prices for ${report.failedGroups.join(', ')}, which couldn't be read from TCGCSV.`,
    );
  }
}

function errorMessage(step: Running['state'], cardsSyncedAt: string | null | undefined) {
  const retry =
    step === 'loading'
      ? 'Press Refresh card data to try again.'
      : 'Check the internet connection and press Refresh card data to try again.';
  const what = step === 'loading' ? 'load card data' : 'reach Riftcodex';
  if (!cardsSyncedAt) return `Couldn't ${what}. ${retry}`;
  const date = new Date(cardsSyncedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `Couldn't ${what}, so the app is still using the card data from ${date}. ${retry}`;
}

/** Saved times as the API's ISO 8601 UTC. */
function toIso(value: string | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

let current: CardDataSync | undefined;

/** The card data sync the server uses, set by `startServer` or `setCardDataSync` in tests. */
export function getCardDataSync(): CardDataSync {
  if (!current) {
    throw new Error(
      'Card data sync is not set up yet. startServer sets it, or call setCardDataSync in tests.',
    );
  }
  return current;
}

export function setCardDataSync(sync: CardDataSync | undefined) {
  current = sync;
}
