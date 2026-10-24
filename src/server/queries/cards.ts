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

/** The characters that start a new word in a card name, such as the space in "Loose Cannon". */
const WORD_BREAKS = [' ', '-', '/', '('];

/**
 * A public code split into its set code (in capitals) and collector number (lower case, no
 * leading zeros), such as OGN and 42 for "ogn-042/298"; null when the text isn't one.
 */
export function parsePublicCode(text: string): { set: string; number: string } | null {
  const match = /^([a-z0-9]{2,5})-([a-z0-9]+)(?:\/\d*)?$/i.exec(text.trim());
  if (!match) return null;
  const number = match[2].toLowerCase().replace(/^0+/, '');
  return { set: match[1].toUpperCase(), number };
}

/** A printing's collector number as `parsePublicCode` reads it, for a query over `printings AS p`. */
const codeNumberSql = sql`lower(ltrim(
  CASE WHEN instr(substr(p.public_code, instr(p.public_code, '-') + 1), '/') > 0
    THEN substr(
      substr(p.public_code, instr(p.public_code, '-') + 1), 1,
      instr(substr(p.public_code, instr(p.public_code, '-') + 1), '/') - 1)
    ELSE substr(p.public_code, instr(p.public_code, '-') + 1)
  END, '0'))`;

export type CardSearchOptions = {
  /** Words from the card's name, or a public code such as "OGN-042" or "ogn-042/298". */
  q: string;
  /** Only cards of this type. */
  type?: CardType;
  /** Only cards with this supertype, such as "champion", ignoring case. */
  supertype?: string;
  /** Only cards whose domains all fit inside these; cards with no domain always fit. */
  domains?: Domain[];
  /** Only cards that belong to this champion, such as "Jinx", ignoring case. */
  championTag?: string;
  /** Only cards a deck can hold (no tokens). */
  deckable?: boolean;
  limit: number;
};

/**
 * Cards found by `q`, ignoring case, best match first:
 * 1. a printing whose public code is the one typed ("OGN-42" finds OGN-042/298),
 * 2. names starting with the text,
 * 3. names with a word starting with the text ("cannon" finds "Jinx, Loose Cannon"),
 * 4. printings whose public code starts with the text ("OGN-04" finds OGN-040 to OGN-049),
 * each in name order.
 */
export function searchCards(db: Db, options: CardSearchOptions): CardSearchResult[] {
  const typed = options.q.trim();
  const text = likeText(typed);
  const starts = `${text}%`;
  const wordStarts = sql.join(
    WORD_BREAKS.map((ch) => sql`c.name LIKE ${`%${ch}${text}%`} ESCAPE '\\'`),
    sql` OR `,
  );

  const code = parsePublicCode(typed);
  const codeMatch = code
    ? sql`EXISTS (
        SELECT 1 FROM printings AS p
        WHERE p.card_id = c.id AND p.public_code LIKE ${`${likeText(code.set)}-%`} ESCAPE '\\'
          AND ${codeNumberSql} = ${code.number}
      )`
    : sql`0`;
  const codeStarts = sql`EXISTS (
    SELECT 1 FROM printings AS p
    WHERE p.card_id = c.id AND p.public_code LIKE ${starts} ESCAPE '\\'
  )`;

  const filters: SQL[] = [];
  if (options.type) filters.push(sql`AND c.type = ${options.type}`);
  if (options.supertype !== undefined) {
    filters.push(sql`AND c.supertype = ${options.supertype} COLLATE NOCASE`);
  }
  if (options.championTag !== undefined) {
    filters.push(sql`AND c.champion_tag = ${options.championTag} COLLATE NOCASE`);
  }
  if (options.deckable !== undefined) {
    filters.push(sql`AND c.deckable = ${options.deckable ? 1 : 0}`);
  }
  if (options.domains !== undefined) {
    // Every one of the card's domains must be among the given ones.
    const allowed = options.domains.length === 0 ? sql`''` : sql.join(options.domains, sql`, `);
    filters.push(
      sql`AND NOT EXISTS (SELECT 1 FROM json_each(c.domains) WHERE value NOT IN (${allowed}))`,
    );
  }

  const rows = db.all<CardRecord & CountsRecord>(sql`
    WITH ranked AS (
      SELECT c.id, c.name,
        CASE
          WHEN ${codeMatch} THEN 0
          WHEN c.name LIKE ${starts} ESCAPE '\\' THEN 1
          WHEN ${wordStarts} THEN 2
          WHEN ${codeStarts} THEN 3
        END AS rank
      FROM cards AS c
      WHERE 1 = 1 ${sql.join(filters, sql` `)}
    ),
    matched AS (
      SELECT id, rank FROM ranked
      WHERE rank IS NOT NULL
      ORDER BY rank, name COLLATE NOCASE, id
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
