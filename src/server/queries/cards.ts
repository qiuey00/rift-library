import { type SQL, sql } from 'drizzle-orm';
import type { CardCounts, CardDetailsResponse, CardSearchResult } from '../../shared/api/cards';
import type { CardType, Domain } from '../../shared/api/common';
import type { Db } from '../db/database';
import {
  type CardRecord,
  cardColumnsSql,
  type PrintingRecord,
  printingColumnsSql,
  printingOrder,
  toCardSummary,
  toPrintingSummary,
} from './card-summaries';

// Card search (the search box on every screen) and the card page.
//
// What the counts mean:
// - owned: the quantities of every copy stack of the card, across all its printings,
//   proxies included.
// - proxies: the owned copies that are proxies.
// - inDecks: the owned copies whose location is a deck box.
// - free: owned − inDecks.

type CountsRecord = {
  owned: number;
  proxies: number;
  inDecks: number;
};

/** Copy counts of one card (`c.id`), as columns. */
const countColumns = sql`
  (SELECT COALESCE(SUM(s.quantity), 0) FROM copy_stacks AS s
    JOIN printings AS p ON p.riftcodex_id = s.printing_id
    WHERE p.card_id = c.id) AS owned,
  (SELECT COALESCE(SUM(s.quantity), 0) FROM copy_stacks AS s
    JOIN printings AS p ON p.riftcodex_id = s.printing_id
    WHERE p.card_id = c.id AND s.is_proxy = 1) AS proxies,
  (SELECT COALESCE(SUM(s.quantity), 0) FROM copy_stacks AS s
    JOIN printings AS p ON p.riftcodex_id = s.printing_id
    JOIN locations AS l ON l.id = s.location_id
    WHERE p.card_id = c.id AND l.type = 'deck_box') AS inDecks`;

function toCounts(record: CountsRecord): CardCounts {
  return {
    owned: record.owned,
    proxies: record.proxies,
    inDecks: record.inDecks,
    free: record.owned - record.inDecks,
  };
}

/** Text for LIKE that matches itself literally: `%`, `_` and `\` lose their meaning. */
function likeText(text: string) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export type CardSearchOptions = {
  /** Words from the card's name. */
  q: string;
  /** Only cards of this type. */
  type?: CardType;
  /** Only cards whose domains all fit inside these; cards with no domain always fit. */
  domains?: Domain[];
  limit: number;
};

/**
 * Cards whose name holds `q`, ignoring case: names starting with it first, then names
 * containing it, each in name order. Public codes come with #8.
 */
export function searchCards(db: Db, options: CardSearchOptions): CardSearchResult[] {
  const text = likeText(options.q.trim());
  const starts = `${text}%`;
  const contains = `%${text}%`;

  const filters: SQL[] = [];
  if (options.type) filters.push(sql`AND c.type = ${options.type}`);
  if (options.domains !== undefined) {
    // Every one of the card's domains must be among the given ones.
    const allowed = options.domains.length === 0 ? sql`''` : sql.join(options.domains, sql`, `);
    filters.push(
      sql`AND NOT EXISTS (SELECT 1 FROM json_each(c.domains) WHERE value NOT IN (${allowed}))`,
    );
  }

  const rows = db.all<CardRecord & CountsRecord>(sql`
    WITH matched AS (
      SELECT c.id,
        CASE WHEN c.name LIKE ${starts} ESCAPE '\\' THEN 0 ELSE 1 END AS rank
      FROM cards AS c
      WHERE (c.name LIKE ${contains} ESCAPE '\\'
          -- A public code such as OGN-042 finds the card printed with it.
          OR EXISTS (
            SELECT 1 FROM printings AS p
            WHERE p.card_id = c.id AND p.public_code LIKE ${starts} ESCAPE '\\'
          ))
        ${sql.join(filters, sql` `)}
      ORDER BY rank, c.name COLLATE NOCASE, c.id
      LIMIT ${options.limit}
    )
    SELECT ${cardColumnsSql}, ${countColumns}
    FROM matched AS m
    JOIN cards AS c ON c.id = m.id
    ORDER BY m.rank, c.name COLLATE NOCASE, c.id`);

  return rows.map((row) => {
    const counts = toCounts(row);
    return { ...toCardSummary(row), owned: counts.owned, free: counts.free };
  });
}

/** One card with its printings (by set and number) and copy counts; undefined if it isn't known. */
export function cardDetails(db: Db, cardId: number): CardDetailsResponse | undefined {
  const row = db.get<CardRecord & CountsRecord & { rulesText: string; deckable: number }>(sql`
    SELECT ${cardColumnsSql}, ${countColumns}, c.rules_text AS rulesText, c.deckable
    FROM cards AS c
    WHERE c.id = ${cardId}`);
  if (!row) return undefined;

  const printings = db.all<PrintingRecord>(sql`
    SELECT ${printingColumnsSql}
    FROM printings AS p
    WHERE p.card_id = ${cardId}
    ORDER BY ${printingOrder}`);

  return {
    card: { ...toCardSummary(row), rulesText: row.rulesText, deckable: row.deckable === 1 },
    printings: printings.map(toPrintingSummary),
    counts: toCounts(row),
  };
}
