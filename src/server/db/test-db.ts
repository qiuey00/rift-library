import { openDatabase } from './database';

/** A fresh in-memory database with every migration applied and the "To sort" inbox, for Vitest. */
export function createTestDb() {
  return openDatabase(':memory:');
}
