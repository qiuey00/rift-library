import { inArray, sql } from 'drizzle-orm';
import type { CardSummary, Domain, Finish, PrintingSummary } from '../../shared/api/common';
import type { Db } from '../db/database';
import { type cards, printings } from '../db/schema';

// Cards and printings as the API shows them, shared by every query that answers them.
//
// A card's image is the one of its first printing that isn't alternate art, in set and
// collector number order.

type CardRow = typeof cards.$inferSelect;
type PrintingRow = typeof printings.$inferSelect;

/** The order printings of a card are listed in, and the first one gives the card's image. */
const PRINTING_ORDER = sql`alternate_art, set_code, CAST(collector_number AS INTEGER), collector_number, riftcodex_id`;

/** The order to list a card's printings in, for drizzle queries over `printings`. */
export const printingOrder = sql`${PRINTING_ORDER}`;

/** The card's image, for a query over `cards AS c`. */
const cardImageSql = sql`(SELECT image_url FROM printings
  WHERE card_id = c.id AND image_url IS NOT NULL
  ORDER BY ${PRINTING_ORDER} LIMIT 1)`;

/**
 * A card's columns for a raw query over `cards AS c`, read back with `toCardSummary`. The
 * card's id is `cardId` and its name `name`.
 */
export const cardColumnsSql = sql`
  c.id AS cardId, c.name, c.type, c.supertype, c.domains, c.energy, c.might, c.power,
  c.champion_tag AS championTag, ${cardImageSql} AS cardImageUrl`;

export type CardRecord = {
  cardId: number;
  name: string;
  type: CardSummary['type'];
  supertype: string | null;
  domains: string;
  energy: number | null;
  might: number | null;
  power: number | null;
  championTag: string | null;
  cardImageUrl: string | null;
};

export function toCardSummary(record: CardRecord): CardSummary {
  return {
    id: record.cardId,
    name: record.name,
    type: record.type,
    supertype: record.supertype,
    domains: JSON.parse(record.domains) as Domain[],
    energy: record.energy,
    might: record.might,
    power: record.power,
    championTag: record.championTag,
    imageUrl: record.cardImageUrl,
  };
}

/** A printing's columns for a raw query over `printings AS p`, read back with `toPrintingSummary`. */
export const printingColumnsSql = sql`
  p.riftcodex_id AS printingId, p.public_code AS publicCode, p.set_code AS setCode,
  p.set_name AS setName, p.collector_number AS collectorNumber, p.rarity,
  p.image_url AS imageUrl, p.alternate_art AS alternateArt, p.overnumbered, p.signature,
  p.finishes, p.price_normal AS priceNormal, p.price_foil AS priceFoil`;

export type PrintingRecord = {
  printingId: string;
  publicCode: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  imageUrl: string | null;
  alternateArt: number;
  overnumbered: number;
  signature: number;
  finishes: string;
  priceNormal: number | null;
  priceFoil: number | null;
};

export function toPrintingSummary(record: PrintingRecord): PrintingSummary {
  return {
    printingId: record.printingId,
    publicCode: record.publicCode,
    setCode: record.setCode,
    setName: record.setName,
    collectorNumber: record.collectorNumber,
    rarity: record.rarity,
    imageUrl: record.imageUrl,
    alternateArt: record.alternateArt === 1,
    overnumbered: record.overnumbered === 1,
    signature: record.signature === 1,
    finishes: JSON.parse(record.finishes) as Finish[],
    unitPrice: { normal: record.priceNormal, foil: record.priceFoil },
  };
}

/** A card row as the API shows it, with the image `cardImages` chose. */
export function cardSummary(card: CardRow, imageUrl: string | null = null): CardSummary {
  return {
    id: card.id,
    name: card.name,
    type: card.type,
    supertype: card.supertype,
    domains: card.domains,
    energy: card.energy,
    might: card.might,
    power: card.power,
    championTag: card.championTag,
    imageUrl,
  };
}

/** A printing row as the API shows it. */
export function printingSummary(printing: PrintingRow): PrintingSummary {
  return {
    printingId: printing.riftcodexId,
    publicCode: printing.publicCode,
    setCode: printing.setCode,
    setName: printing.setName,
    collectorNumber: printing.collectorNumber,
    rarity: printing.rarity,
    imageUrl: printing.imageUrl,
    alternateArt: printing.alternateArt,
    overnumbered: printing.overnumbered,
    signature: printing.signature,
    finishes: printing.finishes,
    unitPrice: { normal: printing.priceNormal, foil: printing.priceFoil },
  };
}

/** Each card's image: its first printing that isn't alternate art. Cards with none are left out. */
export function cardImages(db: Db, cardIds: number[]): Map<number, string> {
  const images = new Map<number, string>();
  if (cardIds.length === 0) return images;
  const rows = db
    .select({ cardId: printings.cardId, imageUrl: printings.imageUrl })
    .from(printings)
    .where(inArray(printings.cardId, cardIds))
    .orderBy(printingOrder)
    .all();
  for (const row of rows) {
    if (row.imageUrl !== null && !images.has(row.cardId)) images.set(row.cardId, row.imageUrl);
  }
  return images;
}
