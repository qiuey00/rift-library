import type { Db } from '../db/database';
import { AppError } from '../errors';
import { checkRecords, fetchAllPages, REQUEST_GAP_MS } from './fetch';
import { groupCards, nameKey } from './records';
import { writeCardData } from './write';

// Asks Riftcodex for cards the app doesn't know yet, by name with fuzzy matching, for the deck
// list import (#19), instead of waiting for the next daily sync. Found printings are written
// the way a sync writes them, but nothing is removed.

export interface NameLookup {
  /** Each name matched to one card: the one with the same name key, or the only one found. */
  resolved: { name: string; cardId: number }[];
  /** Names Riftcodex doesn't know, or matches more than one card for. */
  notFound: string[];
}

/** Riftcodex couldn't be reached or didn't answer properly. */
export class RiftcodexUnavailableError extends AppError {
  constructor(options?: { cause?: unknown }) {
    super(
      503,
      'riftcodex_unavailable',
      "Couldn't reach Riftcodex; unknown cards are listed to fix or skip",
    );
    this.name = 'RiftcodexUnavailableError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export async function lookupCardsByName(
  db: Db,
  names: string[],
  { gapMs = REQUEST_GAP_MS }: { gapMs?: number } = {},
): Promise<NameLookup> {
  // The browser tests run offline: there, every lookup answers as if Riftcodex can't be reached.
  if (process.env.RIFTCODEX === 'off') throw new RiftcodexUnavailableError();
  const result: NameLookup = { resolved: [], notFound: [] };
  for (const [index, name] of names.entries()) {
    if (index > 0 && gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
    let values: unknown[];
    try {
      values = await fetchAllPages('/cards/name', { fuzzy: name.trim() }, { gapMs });
    } catch (err) {
      throw new RiftcodexUnavailableError({ cause: err });
    }
    const { groups } = groupCards(checkRecords(values).records, new Map());
    const key = nameKey(name);
    const match =
      groups.find((group) => group.card.nameKey === key) ??
      (groups.length === 1 ? groups[0] : undefined);
    if (!match) {
      result.notFound.push(name);
      continue;
    }
    const { cardIds } = writeCardData(db, [match], { full: false });
    const cardId = cardIds.get(match.card.nameKey);
    if (cardId === undefined) result.notFound.push(name);
    else result.resolved.push({ name, cardId });
  }
  return result;
}
