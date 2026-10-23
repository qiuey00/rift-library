import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { BuyItem } from '../../shared/api/buy-list';
import type { CardSummary, PrintingSummary } from '../../shared/api/common';
import type { Db } from '../db/database';
import { buyListItems, cards, printings } from '../db/schema';

// The buy list as the API shows it: each item with its card and wanted printing.

type CardRow = typeof cards.$inferSelect;
type PrintingRow = typeof printings.$inferSelect;
type ItemRow = typeof buyListItems.$inferSelect;
type Images = Pick<CardSummary, 'imageSmall' | 'imageNormal'>;

const NO_IMAGES: Images = { imageSmall: null, imageNormal: null };

/** GET /api/buy-list: every item, newest first. */
export function buyList(db: Db): BuyItem[] {
  const rows = db
    .select()
    .from(buyListItems)
    .orderBy(desc(buyListItems.createdAt), desc(buyListItems.id))
    .all();
  return toBuyItems(db, rows);
}

/** One item, or undefined when there is no such item. */
export function buyItem(db: Db, id: number): BuyItem | undefined {
  const row = db.select().from(buyListItems).where(eq(buyListItems.id, id)).get();
  return row ? toBuyItems(db, [row])[0] : undefined;
}

function toBuyItems(db: Db, rows: ItemRow[]): BuyItem[] {
  if (rows.length === 0) return [];
  const oracleIds = [...new Set(rows.map((row) => row.oracleId))];
  const scryfallIds = [
    ...new Set(rows.flatMap((row) => (row.scryfallId === null ? [] : [row.scryfallId]))),
  ];
  const cardRows = new Map(
    db
      .select()
      .from(cards)
      .where(inArray(cards.oracleId, oracleIds))
      .all()
      .map((card) => [card.oracleId, card]),
  );
  const printingRows = new Map(
    scryfallIds.length === 0
      ? []
      : db
          .select()
          .from(printings)
          .where(inArray(printings.scryfallId, scryfallIds))
          .all()
          .map((printing) => [printing.scryfallId, printing]),
  );
  const images = cardImages(db, oracleIds);

  return rows.flatMap((row) => {
    const card = cardRows.get(row.oracleId);
    // The foreign key keeps the card; a card data reload can't remove one that's in use.
    if (!card) return [];
    const printing = row.scryfallId === null ? undefined : printingRows.get(row.scryfallId);
    return [
      {
        id: row.id,
        // A wanted printing shows its own picture; otherwise the card's usual one.
        card: cardSummary(
          card,
          printing
            ? { imageSmall: printing.imageSmall, imageNormal: printing.imageNormal }
            : images.get(card.oracleId),
        ),
        printing: printing ? printingSummary(printing) : null,
        quantity: row.quantity,
        note: row.note ?? '',
        createdAt: isoSeconds(row.createdAt),
      },
    ];
  });
}

function cardSummary(card: CardRow, images: Images = NO_IMAGES): CardSummary {
  return {
    oracleId: card.oracleId,
    name: card.name,
    frontFaceName: card.frontFaceName,
    manaCost: card.manaCost,
    manaValue: card.manaValue,
    typeLine: card.typeLine,
    colorIdentity: card.colorIdentity,
    ...images,
    canBeCommander: card.canBeCommander,
    isBasicLand: card.isBasicLand,
  };
}

function printingSummary(printing: PrintingRow): PrintingSummary {
  return {
    scryfallId: printing.scryfallId,
    oracleId: printing.oracleId,
    setCode: printing.setCode,
    setName: printing.setName,
    collectorNumber: printing.collectorNumber,
    lang: printing.lang,
    finishes: printing.finishes,
    rarity: printing.rarity,
    imageSmall: printing.imageSmall,
    imageNormal: printing.imageNormal,
  };
}

/** Each card's images from its newest printing, English first. */
function cardImages(db: Db, oracleIds: string[]): Map<string, Images> {
  const images = new Map<string, Images>();
  const rows = db
    .select()
    .from(printings)
    .where(inArray(printings.oracleId, oracleIds))
    .orderBy(sql`${printings.lang} = 'en' DESC`, desc(printings.releasedAt))
    .all();
  for (const row of rows) {
    if (!images.has(row.oracleId)) {
      images.set(row.oracleId, { imageSmall: row.imageSmall, imageNormal: row.imageNormal });
    }
  }
  return images;
}

/** "2026-10-18T21:40:00.123Z" as "2026-10-18T21:40:00Z", the way the API writes times. */
function isoSeconds(time: string) {
  return time.replace(/\.\d+Z$/, 'Z');
}
