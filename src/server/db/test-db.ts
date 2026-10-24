import { nameKey } from '../riftcodex/records';
import type { Db } from './database';
import { openDatabase } from './database';
import { cards, printings } from './schema';

/** A fresh in-memory database with every migration applied and the "To sort" inbox, for Vitest. */
export function createTestDb() {
  return openDatabase(':memory:');
}

export type TestCard = Partial<Omit<typeof cards.$inferInsert, 'name'>> & { name: string };

/** Adds a card for a test (a gear card with no domain unless the test says otherwise); returns its id. */
export function insertCard(db: Db, card: TestCard): number {
  return db
    .insert(cards)
    .values({ nameKey: nameKey(card.name), type: 'gear', ...card })
    .returning({ id: cards.id })
    .get().id;
}

export type TestPrinting = Partial<typeof printings.$inferInsert> & {
  riftcodexId: string;
  cardId: number;
};

/** Adds a printing for a test, by default OGN #1 in both finishes. */
export function insertPrinting(db: Db, printing: TestPrinting): void {
  const setCode = printing.setCode ?? 'OGN';
  const collectorNumber = printing.collectorNumber ?? '1';
  db.insert(printings)
    .values({
      publicCode: `${setCode}-${collectorNumber.padStart(3, '0')}/298`,
      setCode,
      setName: 'Origins',
      collectorNumber,
      rarity: 'common',
      ...printing,
    })
    .run();
}
