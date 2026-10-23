import { sql } from 'drizzle-orm';
import type { Cents, Finish } from '../../shared/api/common';
import type { CollectionValue } from '../../shared/api/stacks';
import type { Db } from '../db/database';
import { cardDataStatus } from '../db/schema';
import { descendantIds } from './locations';

// What copies are worth (VAL-2), always worked out live from copy_stacks and printings and
// never stored. A stack's unit price is the US price for its finish, and its value is
// quantity × unit price. Proxies are worth 0 and aren't counted as no price; real copies
// with no price are worth 0 and are counted in `noPriceCount` (by card quantity).

/**
 * The unit price of the stack `s` of printing `p`, in cents, as a SQL expression; NULL when
 * there is no price for the stack's finish.
 */
export const unitPriceSql = sql`(CASE s.finish
  WHEN 'foil' THEN p.price_usd_foil
  WHEN 'etched' THEN p.price_usd_etched
  ELSE p.price_usd END)`;

/** What the stack `s` is worth, as a SQL expression: 0 for proxies and with no price. */
export const stackValueSql = sql`(CASE WHEN s.is_proxy = 1 THEN 0
  ELSE s.quantity * coalesce(${unitPriceSql}, 0) END)`;

/** Real (non-proxy) cards in the stack `s` with no price, as a SQL expression. */
export const noPriceSql = sql`(CASE WHEN s.is_proxy = 0 AND ${unitPriceSql} IS NULL
  THEN s.quantity ELSE 0 END)`;

/** A printing's prices for each finish, in cents. */
export type Prices = {
  priceUsd: number | null;
  priceUsdFoil: number | null;
  priceUsdEtched: number | null;
};

/** The price of one copy in this finish; null when there is none. */
export function unitPrice(finish: Finish, prices: Prices): Cents | null {
  if (finish === 'foil') return prices.priceUsdFoil;
  if (finish === 'etched') return prices.priceUsdEtched;
  return prices.priceUsd;
}

/** quantity × unit price; 0 for proxies and stacks with no price. */
export function stackValue(quantity: number, price: Cents | null, isProxy: boolean): Cents {
  return isProxy || price === null ? 0 : quantity * price;
}

/** A value and the real cards in it with no price. */
export type Worth = { value: Cents; noPriceCount: number };

const nothing = (): Worth => ({ value: 0, noPriceCount: 0 });

/** What the stacks directly in each location are worth, by location id (empty ones left out). */
function directWorth(db: Db): Map<number, Worth> {
  const rows = db.all<{ locationId: number; value: number; noPriceCount: number }>(sql`
    SELECT s.location_id AS locationId,
      sum(${stackValueSql}) AS value,
      sum(${noPriceSql}) AS noPriceCount
    FROM copy_stacks AS s
    JOIN printings AS p ON p.printing_id = s.printing_id
    GROUP BY s.location_id`);
  return new Map(
    rows.map((row) => [row.locationId, { value: row.value, noPriceCount: row.noPriceCount }]),
  );
}

/**
 * What every location is worth with everything inside it, worked out in one pass: each
 * location's own stacks count toward it and every location it sits in. `parents` gives each
 * location's parent id (null at the top); locations missing from it are left out.
 */
export function treeWorth(db: Db, parents: Map<number, number | null>): Map<number, Worth> {
  const worth = new Map<number, Worth>([...parents.keys()].map((id) => [id, nothing()]));
  for (const [locationId, own] of directWorth(db)) {
    const seen = new Set<number>();
    for (let at: number | null | undefined = locationId; at != null && !seen.has(at); ) {
      seen.add(at);
      const total = worth.get(at);
      if (!total) break;
      total.value += own.value;
      total.noPriceCount += own.noPriceCount;
      at = parents.get(at);
    }
  }
  return worth;
}

/** What one location is worth with every live location inside it. */
export function locationWorth(db: Db, id: number): Worth {
  const ids = [id, ...descendantIds(db, id)];
  return (
    db.get<Worth>(sql`
      SELECT coalesce(sum(${stackValueSql}), 0) AS value,
        coalesce(sum(${noPriceSql}), 0) AS noPriceCount
      FROM copy_stacks AS s
      JOIN printings AS p ON p.printing_id = s.printing_id
      WHERE s.location_id IN (${sql.join(ids, sql`, `)})`) ?? nothing()
  );
}

/** GET /api/collection/value: the whole collection, deck boxes and trade locations included. */
export function collectionValue(db: Db): CollectionValue {
  const totals = db.get<Omit<CollectionValue, 'pricesUpdatedAt'>>(sql`
    SELECT coalesce(sum(${stackValueSql}), 0) AS value,
      coalesce(sum(s.quantity), 0) AS cards,
      coalesce(sum(${noPriceSql}), 0) AS noPriceCount,
      coalesce(sum(CASE WHEN s.is_proxy = 1 THEN s.quantity ELSE 0 END), 0) AS proxies
    FROM copy_stacks AS s
    JOIN printings AS p ON p.printing_id = s.printing_id`) ?? {
    value: 0,
    cards: 0,
    noPriceCount: 0,
    proxies: 0,
  };
  const loaded = db.select({ at: cardDataStatus.bulkUpdatedAt }).from(cardDataStatus).get()?.at;
  return { ...totals, pricesUpdatedAt: loaded ? new Date(loaded).toISOString() : null };
}
