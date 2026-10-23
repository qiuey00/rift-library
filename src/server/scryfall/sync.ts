import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { isNotNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { CardDataStatus } from '../../shared/api/card-data';
import type { Db } from '../db/database';
import { cardDataStatus, printings } from '../db/schema';
import { AppError } from '../errors';
import { loadBulkFile } from './load';

// Keeps card data current with no manual step (PLAT-3): on server start and every 24 hours the
// app asks Scryfall which Default Cards file is newest, and downloads and loads it when there is
// no card data yet or Scryfall's file is newer than the loaded one, so prices (VAL-1) are a day old
// at most. Refresh card data forces one.
// A failed check or download keeps the data loaded before and is tried again at the next check.

export const BULK_DATA_URL = 'https://api.scryfall.com/bulk-data';
/** Scryfall requires both headers on every API request. */
export const SCRYFALL_HEADERS = {
  'User-Agent': 'RiftLibrary/0.1',
  Accept: 'application/json',
};
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Where the download is saved, inside DATA_DIR, until it is loaded. */
export const DOWNLOAD_FILE = path.join('scryfall', 'default-cards.jsonl.gz');

const BulkDataEntry = z.object({
  type: z.string(),
  updated_at: z.string(),
  size: z.number().optional(),
  jsonl_download_uri: z.string().nullish(),
  download_uri: z.string().nullish(),
});
const BulkDataList = z.object({ data: z.array(z.unknown()) });

/** Scryfall's Default Cards entry: when it was made, where to get it and how big it is. */
interface DefaultCards {
  updatedAt: string;
  uri: string;
  size: number | undefined;
}

type Running = { state: 'downloading' | 'loading'; progress: number };

export class CardDataSync {
  private running: Running | undefined;
  private lastError: { message: string; progress: number } | undefined;
  private timer: NodeJS.Timeout | undefined;
  private abort = new AbortController();
  private task: Promise<void> = Promise.resolve();
  /** A check or refresh is running; `running` is set once it downloads. */
  private busy = false;

  /** `enabled: false` (SCRYFALL_SYNC=off) never calls Scryfall: no checks, and refresh refuses. */
  constructor(
    private readonly db: Db,
    private readonly dataDir: string,
    private readonly enabled = true,
  ) {}

  /** Checks now, then every 24 hours until `stop`. */
  start() {
    if (!this.enabled) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    // The timer alone doesn't keep the process running.
    this.timer.unref();
  }

  /** Stops the timer and any download, as the server closes. */
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.abort.abort();
  }

  status(): CardDataStatus {
    const row = this.db.select().from(cardDataStatus).get();
    const saved = {
      bulkUpdatedAt: toIso(row?.bulkUpdatedAt),
      lastCheckedAt: toIso(row?.lastCheckedAt),
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
   * The daily check: downloads only when there is no card data yet, the loaded data has no prices
   * (it was loaded before prices were), or Scryfall has a newer file than the loaded one. Does
   * nothing while another check or refresh runs.
   */
  async check() {
    if (!this.enabled || this.busy) return;
    await this.run(false);
  }

  /** Refresh card data: downloads whatever the age, in the background. */
  refresh(): CardDataStatus {
    if (!this.enabled) {
      throw new AppError(
        409,
        'card_data_sync_off',
        'Card data downloads are turned off (SCRYFALL_SYNC=off), so card data cannot be refreshed.',
      );
    }
    if (this.busy) {
      throw new AppError(
        409,
        'refresh_running',
        'Card data is already being refreshed. Wait for it to finish.',
      );
    }
    // Shown as downloading straight away, while the app asks Scryfall for the file.
    this.running = { state: 'downloading', progress: 0 };
    const status = this.status();
    void this.run(true);
    return status;
  }

  /** Resolves once the check, download or load running now has ended. */
  finished() {
    return this.task;
  }

  private run(force: boolean) {
    this.busy = true;
    this.task = this.update(force).finally(() => {
      this.busy = false;
      this.running = undefined;
    });
    return this.task;
  }

  private async update(force: boolean) {
    const saved = this.db.select().from(cardDataStatus).get();
    try {
      const latest = await this.askScryfall();
      const download =
        force ||
        needsDownload(
          saved?.cardCount ?? 0,
          saved?.bulkUpdatedAt,
          latest.updatedAt,
          hasPrices(this.db),
        );
      if (download) {
        await this.downloadAndLoad(latest);
      }
      this.lastError = undefined;
    } catch (err) {
      if (this.abort.signal.aborted) return;
      console.error('Card data update failed:', err);
      this.lastError = {
        message: errorMessage(this.running?.state ?? 'downloading', saved?.bulkUpdatedAt),
        progress: this.running?.progress ?? 0,
      };
    }
  }

  /** Asks Scryfall for the newest Default Cards file, recording when it asked. */
  private async askScryfall(): Promise<DefaultCards> {
    const lastCheckedAt = new Date().toISOString();
    this.db
      .insert(cardDataStatus)
      .values({ id: 1, lastCheckedAt })
      .onConflictDoUpdate({ target: cardDataStatus.id, set: { lastCheckedAt } })
      .run();

    const response = await fetch(BULK_DATA_URL, {
      headers: SCRYFALL_HEADERS,
      signal: this.abort.signal,
    });
    if (!response.ok) throw new Error(`Scryfall answered ${response.status} to ${BULK_DATA_URL}`);
    const entries = BulkDataList.parse(await response.json()).data;
    const entry = entries
      .map((value) => BulkDataEntry.safeParse(value))
      .find((parsed) => parsed.success && parsed.data.type === 'default_cards')?.data;
    const uri = entry?.jsonl_download_uri || entry?.download_uri;
    if (!entry || !uri) throw new Error('Scryfall listed no Default Cards file');
    return { updatedAt: entry.updated_at, uri, size: entry.size };
  }

  private async downloadAndLoad(latest: DefaultCards) {
    const file = path.join(this.dataDir, DOWNLOAD_FILE);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      this.running = { state: 'downloading', progress: 0 };
      await this.download(latest, file);

      this.running = { state: 'loading', progress: 0 };
      await loadBulkFile(this.db, file, {
        bulkUpdatedAt: new Date(latest.updatedAt).toISOString(),
        onProgress: (bytesRead, fileSize) => {
          if (this.running && fileSize > 0) this.running.progress = bytesRead / fileSize;
        },
      });
    } finally {
      await rm(file, { force: true });
    }
  }

  /** Streams the file to disk as it is (still gzipped), counting bytes against its size. */
  private async download(latest: DefaultCards, file: string) {
    const response = await fetch(latest.uri, {
      headers: SCRYFALL_HEADERS,
      signal: this.abort.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Scryfall answered ${response.status} to ${latest.uri}`);
    }
    const size = latest.size ?? Number(response.headers.get('content-length') ?? 0);
    let received = 0;
    const count = new Transform({
      transform: (chunk: Buffer, _encoding, done) => {
        received += chunk.length;
        if (this.running && size > 0) this.running.progress = Math.min(received / size, 1);
        done(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream),
      count,
      createWriteStream(file),
      { signal: this.abort.signal },
    );
  }
}

/** No card data yet, no prices in it yet, or Scryfall's file is newer than the loaded one. */
export function needsDownload(
  cardCount: number,
  bulkUpdatedAt: string | null | undefined,
  latestUpdatedAt: string,
  pricesLoaded = true,
) {
  if (cardCount === 0 || !bulkUpdatedAt || !pricesLoaded) return true;
  return Date.parse(latestUpdatedAt) > Date.parse(bulkUpdatedAt);
}

/** Whether any printing has a price: card data loaded before prices existed has none. */
function hasPrices(db: Db) {
  return Boolean(
    db
      .select({ id: printings.scryfallId })
      .from(printings)
      .where(
        or(
          isNotNull(printings.priceUsd),
          isNotNull(printings.priceUsdFoil),
          isNotNull(printings.priceUsdEtched),
        ),
      )
      .limit(1)
      .get(),
  );
}

function errorMessage(step: Running['state'], bulkUpdatedAt: string | null | undefined) {
  const what = step === 'loading' ? 'load' : 'download';
  const retry =
    step === 'loading'
      ? 'Press Refresh card data to try again.'
      : 'Check the internet connection and press Refresh card data to try again.';
  if (!bulkUpdatedAt) return `Couldn't ${what} card data from Scryfall. ${retry}`;
  const date = new Date(bulkUpdatedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `Couldn't ${what} the new card data from Scryfall, so the app is still using the data from ${date}. ${retry}`;
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
