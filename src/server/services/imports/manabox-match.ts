import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/database';
import { printings } from '../../db/schema';
import { type CardIdentifier, lookupCards, ScryfallUnavailableError } from '../../scryfall/lookup';
import type { ManaBoxRow } from './manabox-parse';

// Finds the printing each ManaBox row stands for, for both ManaBox import modes (add copies,
// update a location). Rows the app doesn't know are looked up on Scryfall; nothing else is
// written.

export interface ManaBoxMatch {
  /** The parser's row number to the printing's Scryfall ID. */
  matched: Map<number, string>;
  /** Rows whose printing neither the app nor Scryfall knows, in file order. */
  unknown: ManaBoxRow[];
  /** Scryfall couldn't be reached, so `unknown` holds every row the app doesn't know. */
  lookupFailed: boolean;
}

/** How many ids to check in one query. */
const CHUNK = 500;

/**
 * Finds each row's printing: by its Scryfall ID, or by set code and collector number when the
 * ID is empty. Rows not found are sent to Scryfall in one `lookupCards` call.
 */
export async function matchManaBoxRows(db: Db, rows: ManaBoxRow[]): Promise<ManaBoxMatch> {
  const matched = new Map<number, string>();
  const known = knownIds(
    db,
    rows.flatMap((row) => (row.scryfallId ? [row.scryfallId] : [])),
  );

  const missing: ManaBoxRow[] = [];
  for (const row of rows) {
    const scryfallId = row.scryfallId
      ? known.has(row.scryfallId)
        ? row.scryfallId
        : undefined
      : bySetAndNumber(db, row);
    if (scryfallId) matched.set(row.row, scryfallId);
    else missing.push(row);
  }
  if (missing.length === 0) return { matched, unknown: [], lookupFailed: false };

  const identifiers = new Map<string, CardIdentifier>();
  for (const row of missing) identifiers.set(identifierKey(identifierFor(row)), identifierFor(row));
  let found: Map<string, string>;
  try {
    const result = await lookupCards(db, [...identifiers.values()]);
    found = new Map(
      result.resolved.map(({ identifier, scryfallId }) => [identifierKey(identifier), scryfallId]),
    );
  } catch (err) {
    if (err instanceof ScryfallUnavailableError) {
      return { matched, unknown: missing, lookupFailed: true };
    }
    throw err;
  }

  const unknown: ManaBoxRow[] = [];
  for (const row of missing) {
    const scryfallId = found.get(identifierKey(identifierFor(row)));
    if (scryfallId) matched.set(row.row, scryfallId);
    else unknown.push(row);
  }
  return { matched, unknown, lookupFailed: false };
}

/** The ids among these that are in `printings`. */
function knownIds(db: Db, ids: string[]): Set<string> {
  const unique = [...new Set(ids)];
  const known = new Set<string>();
  for (let start = 0; start < unique.length; start += CHUNK) {
    const chunk = unique.slice(start, start + CHUNK);
    for (const { id } of db
      .select({ id: printings.scryfallId })
      .from(printings)
      .where(inArray(printings.scryfallId, chunk))
      .all()) {
      known.add(id);
    }
  }
  return known;
}

/**
 * The printing with this set code and collector number. Printings in several languages share
 * them, so the row's language wins, then English, then the first one.
 */
function bySetAndNumber(db: Db, row: ManaBoxRow): string | undefined {
  const candidates = db
    .select({ id: printings.scryfallId, lang: printings.lang })
    .from(printings)
    .where(
      and(
        eq(sql`lower(${printings.setCode})`, row.setCode.toLowerCase()),
        eq(sql`lower(${printings.collectorNumber})`, row.collectorNumber.toLowerCase()),
      ),
    )
    .all();
  const best =
    candidates.find((printing) => printing.lang === row.language) ??
    candidates.find((printing) => printing.lang === 'en') ??
    candidates[0];
  return best?.id;
}

function identifierFor(row: ManaBoxRow): CardIdentifier {
  return row.scryfallId
    ? { id: row.scryfallId }
    : { set: row.setCode, collector_number: row.collectorNumber };
}

function identifierKey(identifier: CardIdentifier): string {
  if ('id' in identifier) return `id:${identifier.id}`;
  if ('name' in identifier) return `name:${identifier.name.toLowerCase()}`;
  return `set:${identifier.set.toLowerCase()}:${identifier.collector_number.toLowerCase()}`;
}
