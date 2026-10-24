import { desc, eq, inArray } from 'drizzle-orm';
import type { BuyItem } from '../../shared/api/buy-list';
import type { Db } from '../db/database';
import { buyListItems, cards, printings } from '../db/schema';
import { cardImages, cardSummary, printingSummary } from './card-summaries';

// The buy list as the API shows it: each item with its card and wanted printing.

type ItemRow = typeof buyListItems.$inferSelect;

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
  const cardIds = [...new Set(rows.map((row) => row.cardId))];
  const printingIds = [
    ...new Set(rows.flatMap((row) => (row.printingId === null ? [] : [row.printingId]))),
  ];
  const cardRows = new Map(
    db
      .select()
      .from(cards)
      .where(inArray(cards.id, cardIds))
      .all()
      .map((card) => [card.id, card]),
  );
  const printingRows = new Map(
    printingIds.length === 0
      ? []
      : db
          .select()
          .from(printings)
          .where(inArray(printings.riftcodexId, printingIds))
          .all()
          .map((printing) => [printing.riftcodexId, printing]),
  );
  const images = cardImages(db, cardIds);

  return rows.flatMap((row) => {
    const card = cardRows.get(row.cardId);
    // The foreign key keeps the card; a card data reload can't remove one that's in use.
    if (!card) return [];
    const printing = row.printingId === null ? undefined : printingRows.get(row.printingId);
    return [
      {
        id: row.id,
        // A wanted printing shows its own picture; otherwise the card's usual one.
        card: cardSummary(card, printing ? printing.imageUrl : (images.get(card.id) ?? null)),
        printing: printing ? printingSummary(printing) : null,
        quantity: row.quantity,
        note: row.note ?? '',
        createdAt: isoSeconds(row.createdAt),
      },
    ];
  });
}

/** "2026-10-18T21:40:00.123Z" as "2026-10-18T21:40:00Z", the way the API writes times. */
function isoSeconds(time: string) {
  return time.replace(/\.\d+Z$/, 'Z');
}
