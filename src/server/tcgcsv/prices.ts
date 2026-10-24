import { eq, isNull, notInArray, or } from 'drizzle-orm';
import type { Finish } from '../../shared/api/common';
import type { Db } from '../db/database';
import { cardDataStatus, printings } from '../db/schema';
import type { TcgcsvPrice } from './fetch';
import { type FetchOptions, fetchGroupPrices, fetchGroups, pause, REQUEST_GAP_MS } from './fetch';

// TCGplayer market prices for each printing (VAL-1, D-8), matched by TCGplayer product id
// (`printings.tcgplayer_id`) and stored in whole cents. The subtypes TCGplayer lists for a
// printing become its finishes; a printing with no entries offers both. Values stay worked
// out live in queries/value.ts.

/** What TCGplayer lists for one product. */
export interface ProductPrices {
  priceNormal: number | null;
  priceFoil: number | null;
  finishes: Finish[];
}

const BOTH: Finish[] = ['normal', 'foil'];

/** Dollars as whole cents; null when there is no price. */
export function toCents(dollars: number | null | undefined): number | null {
  return dollars == null ? null : Math.round(dollars * 100);
}

/** Groups price entries by product id. Subtypes other than Normal and Foil are ignored. */
export function collectPrices(entries: TcgcsvPrice[], into = new Map<number, ProductPrices>()) {
  for (const entry of entries) {
    const finish =
      entry.subTypeName === 'Foil' ? 'foil' : entry.subTypeName === 'Normal' ? 'normal' : null;
    if (!finish) continue;
    const product = into.get(entry.productId) ?? {
      priceNormal: null,
      priceFoil: null,
      finishes: [],
    };
    if (finish === 'foil') product.priceFoil = toCents(entry.marketPrice);
    else product.priceNormal = toCents(entry.marketPrice);
    if (!product.finishes.includes(finish)) {
      product.finishes = BOTH.filter((f) => f === finish || product.finishes.includes(f));
    }
    into.set(entry.productId, product);
  }
  return into;
}

/**
 * Writes the prices in one transaction and records `updatedAt`. Printings whose product id is
 * listed get its prices and finishes. With `complete` (every group loaded), every other
 * printing loses its prices and offers both finishes; without it, they keep what they had, so a
 * group that failed to load leaves its old prices.
 */
export function writePrices(
  db: Db,
  products: Map<number, ProductPrices>,
  { complete, updatedAt }: { complete: boolean; updatedAt: string },
) {
  return db.transaction((tx) => {
    let matched = 0;
    const ids = [...products.keys()];
    for (const [productId, prices] of products) {
      matched += tx
        .update(printings)
        .set(prices)
        .where(eq(printings.tcgplayerId, productId))
        .run().changes;
    }
    if (complete) {
      tx.update(printings)
        .set({ priceNormal: null, priceFoil: null, finishes: BOTH })
        .where(
          or(
            isNull(printings.tcgplayerId),
            ids.length > 0 ? notInArray(printings.tcgplayerId, ids) : undefined,
          ),
        )
        .run();
    }
    tx.insert(cardDataStatus)
      .values({ id: 1, pricesUpdatedAt: updatedAt })
      .onConflictDoUpdate({ target: cardDataStatus.id, set: { pricesUpdatedAt: updatedAt } })
      .run();
    return matched;
  });
}

/** What one price update found, as it logs it. */
export interface PriceReport {
  groupCount: number;
  /** Groups whose prices couldn't be read; their printings kept their old prices. */
  failedGroups: string[];
  /** Printings that got a price entry. */
  matchedPrintings: number;
}

/**
 * Reads every Riftbound group's prices from TCGCSV and writes them. Throws, keeping every old
 * price, when the groups can't be read or no group's prices can.
 */
export async function updatePrices(db: Db, options: FetchOptions = {}): Promise<PriceReport> {
  const { signal, gapMs = REQUEST_GAP_MS } = options;
  const updatedAt = new Date().toISOString();
  const groups = await fetchGroups(options);
  if (groups.length === 0) throw new Error('TCGCSV listed no Riftbound groups');
  const products = new Map<number, ProductPrices>();
  const failedGroups: string[] = [];
  for (const group of groups) {
    if (gapMs > 0) await pause(gapMs, signal);
    try {
      collectPrices(await fetchGroupPrices(group.groupId, options), products);
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn(`Couldn't read TCGCSV prices for ${group.name}:`, err);
      failedGroups.push(group.name);
    }
  }
  if (failedGroups.length === groups.length) throw new Error("Couldn't read any TCGCSV prices");
  const matchedPrintings = writePrices(db, products, {
    complete: failedGroups.length === 0,
    updatedAt,
  });
  return { groupCount: groups.length, failedGroups, matchedPrintings };
}
