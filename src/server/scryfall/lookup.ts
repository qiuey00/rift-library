import type { Db } from '../db/database';
import { cards, printings } from '../db/schema';
import { AppError } from '../errors';
import { cardToRows, isPaperPrinting, ScryfallCard } from './card-rows';
import { excludedSet } from './load';

// Fetches cards the app doesn't know yet (a set out this week, a non-English printing) from
// Scryfall's collection endpoint, instead of waiting for the next bulk download. Found cards are
// written into `cards` and `printings` the same way a bulk load writes them.

export const COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
/** Scryfall takes at most 75 identifiers per request. */
export const MAX_PER_REQUEST = 75;
/** Scryfall asks for 50–100 ms between requests. */
export const REQUEST_GAP_MS = 100;

export type CardIdentifier =
  | { id: string }
  | { name: string }
  | { set: string; collector_number: string };

export interface ResolvedCard {
  identifier: CardIdentifier;
  scryfallId: string;
  oracleId: string;
}

export interface LookupResult {
  resolved: ResolvedCard[];
  /** Identifiers Scryfall doesn't know, or knows only as online-only printings. */
  not_found: CardIdentifier[];
}

/** Scryfall couldn't be reached or didn't answer properly. */
export class ScryfallUnavailableError extends AppError {
  constructor(options?: { cause?: unknown }) {
    super(
      503,
      'scryfall_unavailable',
      "Couldn't reach Scryfall; unknown cards are listed to fix or skip",
    );
    this.name = 'ScryfallUnavailableError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export async function lookupCards(db: Db, identifiers: CardIdentifier[]): Promise<LookupResult> {
  // The browser tests run offline: there, every lookup answers as if Scryfall can't be reached.
  if (process.env.SCRYFALL_LOOKUP === 'off') throw new ScryfallUnavailableError();
  const result: LookupResult = { resolved: [], not_found: [] };
  for (let start = 0; start < identifiers.length; start += MAX_PER_REQUEST) {
    if (start > 0) await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
    const chunk = identifiers.slice(start, start + MAX_PER_REQUEST);
    const found = await fetchCollection(chunk);
    const { resolved, not_found } = saveFound(db, chunk, found);
    result.resolved.push(...resolved);
    result.not_found.push(...not_found);
  }
  return result;
}

/** One request; the card objects Scryfall found (not checked yet). */
async function fetchCollection(identifiers: CardIdentifier[]): Promise<unknown[]> {
  let body: unknown;
  try {
    const response = await fetch(COLLECTION_URL, {
      method: 'POST',
      headers: {
        'User-Agent': 'RiftLibrary/0.1',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identifiers }),
    });
    if (!response.ok) throw new Error(`Scryfall answered ${response.status}`);
    body = await response.json();
  } catch (err) {
    throw new ScryfallUnavailableError({ cause: err });
  }
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new ScryfallUnavailableError({ cause: new Error('Scryfall answered without data') });
  }
  return data;
}

/**
 * Writes the paper printings Scryfall found, in one transaction, and matches each identifier
 * to one of them. Identifiers with no paper printing are not found.
 */
function saveFound(db: Db, identifiers: CardIdentifier[], found: unknown[]): LookupResult {
  const paper = found.flatMap((value) => {
    const parsed = ScryfallCard.safeParse(value);
    return parsed.success && isPaperPrinting(parsed.data) ? [parsed.data] : [];
  });
  const rows = paper.map((found) => ({ found, ...cardToRows(found) }));

  db.transaction((tx) => {
    for (const { card, printing } of rows) {
      tx.insert(cards)
        .values(card)
        .onConflictDoUpdate({ target: cards.oracleId, set: excludedSet(cards) })
        .run();
      tx.insert(printings)
        .values(printing)
        .onConflictDoUpdate({ target: printings.scryfallId, set: excludedSet(printings) })
        .run();
    }
  });

  const result: LookupResult = { resolved: [], not_found: [] };
  for (const identifier of identifiers) {
    const match = rows.find(({ found }) => matches(identifier, found));
    if (match) {
      result.resolved.push({
        identifier,
        scryfallId: match.printing.scryfallId,
        oracleId: match.printing.oracleId,
      });
    } else {
      result.not_found.push(identifier);
    }
  }
  return result;
}

/** Whether Scryfall's card answers this identifier. Names match ignoring case, on either face. */
function matches(identifier: CardIdentifier, card: ScryfallCard) {
  if ('id' in identifier) return card.id === identifier.id;
  if ('name' in identifier) {
    const name = identifier.name.trim().toLowerCase();
    const names = [card.name, ...(card.card_faces ?? []).map((face) => face.name)];
    return names.some((candidate) => candidate.toLowerCase() === name);
  }
  return (
    card.set.toLowerCase() === identifier.set.toLowerCase() &&
    card.collector_number.toLowerCase() === identifier.collector_number.toLowerCase()
  );
}
