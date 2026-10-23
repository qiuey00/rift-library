import { type SQL, sql } from 'drizzle-orm';
import type { CardCounts, CardDetailsResponse, CardSearchResult } from '../../shared/api/cards';
import type { CardSummary, Finish, PrintingSummary } from '../../shared/api/common';
import type { Db } from '../db/database';

// Card search (the search box on every screen) and the card page.
//
// What the counts mean:
// - owned: the quantities of every copy stack of the card, across all its printings,
//   proxies included.
// - proxies: the owned copies that are proxies.
// - inDecks: the owned copies whose location is a deck box.
// - free: owned − inDecks.

type CardRecord = {
  oracleId: string;
  name: string;
  frontFaceName: string;
  manaCost: string;
  manaValue: number;
  typeLine: string;
  colorIdentity: string;
  canBeCommander: number;
  isBasicLand: number;
  imageSmall: string | null;
  imageNormal: string | null;
};

type CountsRecord = {
  owned: number;
  proxies: number;
  inDecks: number;
};

type PrintingRecord = Omit<PrintingSummary, 'finishes'> & { finishes: string };

const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;

/**
 * The card's own columns, plus the images of its newest printing (English first, then any
 * language), since Scryfall keeps images on printings.
 */
const cardColumns = sql`
  c.oracle_id AS oracleId, c.name, c.front_face_name AS frontFaceName,
  c.mana_cost AS manaCost, c.mana_value AS manaValue, c.type_line AS typeLine,
  c.color_identity AS colorIdentity, c.can_be_commander AS canBeCommander,
  c.is_basic_land AS isBasicLand, img.image_small AS imageSmall,
  img.image_normal AS imageNormal`;

const imageJoin = sql`
  LEFT JOIN printings AS img ON img.scryfall_id = (
    SELECT p.scryfall_id FROM printings AS p
    WHERE p.oracle_id = c.oracle_id
    ORDER BY p.image_normal IS NULL, p.lang <> 'en', p.released_at DESC, p.scryfall_id
    LIMIT 1
  )`;

/** Copy counts of one card (`c.oracle_id`), as columns. */
const countColumns = sql`
  (SELECT COALESCE(SUM(s.quantity), 0) FROM copy_stacks AS s
    JOIN printings AS p ON p.scryfall_id = s.scryfall_id
    WHERE p.oracle_id = c.oracle_id) AS owned,
  (SELECT COALESCE(SUM(s.quantity), 0) FROM copy_stacks AS s
    JOIN printings AS p ON p.scryfall_id = s.scryfall_id
    WHERE p.oracle_id = c.oracle_id AND s.is_proxy = 1) AS proxies,
  (SELECT COALESCE(SUM(s.quantity), 0) FROM copy_stacks AS s
    JOIN printings AS p ON p.scryfall_id = s.scryfall_id
    JOIN locations AS l ON l.id = s.location_id
    WHERE p.oracle_id = c.oracle_id AND l.type = 'deck_box') AS inDecks`;

function toCardSummary(record: CardRecord): CardSummary {
  return {
    oracleId: record.oracleId,
    name: record.name,
    frontFaceName: record.frontFaceName,
    manaCost: record.manaCost,
    manaValue: record.manaValue,
    typeLine: record.typeLine,
    colorIdentity: record.colorIdentity,
    imageSmall: record.imageSmall,
    imageNormal: record.imageNormal,
    canBeCommander: record.canBeCommander === 1,
    isBasicLand: record.isBasicLand === 1,
  };
}

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
  /** Only cards that can be commanders. */
  commander?: boolean;
  /** Only cards whose color identity fits inside these letters, such as 'BRG'. */
  identity?: string;
  limit: number;
};

/**
 * Cards whose name or front face name holds `q`, ignoring case: names starting with it
 * first, then names containing it, each in name order.
 */
export function searchCards(db: Db, options: CardSearchOptions): CardSearchResult[] {
  const text = likeText(options.q.trim());
  const starts = `${text}%`;
  const contains = `%${text}%`;

  const filters: SQL[] = [];
  if (options.commander) filters.push(sql`AND c.can_be_commander = 1`);
  if (options.identity !== undefined) {
    // Every color letter outside the given ones must be missing from the card's identity.
    for (const letter of WUBRG) {
      if (!options.identity.includes(letter)) {
        filters.push(sql`AND instr(c.color_identity, ${letter}) = 0`);
      }
    }
  }

  const rows = db.all<CardRecord & CountsRecord>(sql`
    WITH matched AS (
      SELECT c.oracle_id,
        CASE WHEN c.name LIKE ${starts} ESCAPE '\\'
          OR c.front_face_name LIKE ${starts} ESCAPE '\\' THEN 0 ELSE 1 END AS rank
      FROM cards AS c
      WHERE (c.name LIKE ${contains} ESCAPE '\\' OR c.front_face_name LIKE ${contains} ESCAPE '\\')
        ${sql.join(filters, sql` `)}
      ORDER BY rank, c.name COLLATE NOCASE, c.oracle_id
      LIMIT ${options.limit}
    )
    SELECT ${cardColumns}, ${countColumns}
    FROM matched AS m
    JOIN cards AS c ON c.oracle_id = m.oracle_id
    ${imageJoin}
    ORDER BY m.rank, c.name COLLATE NOCASE, c.oracle_id`);

  return rows.map((row) => {
    const counts = toCounts(row);
    return { ...toCardSummary(row), owned: counts.owned, free: counts.free };
  });
}

/** One card with its printings (newest first) and copy counts; undefined if it isn't known. */
export function cardDetails(db: Db, oracleId: string): CardDetailsResponse | undefined {
  const row = db.get<
    CardRecord & CountsRecord & { keywords: string; commanderLegality: string }
  >(sql`
    SELECT ${cardColumns}, ${countColumns},
      c.keywords, c.commander_legality AS commanderLegality
    FROM cards AS c
    ${imageJoin}
    WHERE c.oracle_id = ${oracleId}`);
  if (!row) return undefined;

  const printings = db.all<PrintingRecord>(sql`
    SELECT scryfall_id AS scryfallId, oracle_id AS oracleId, set_code AS setCode,
      set_name AS setName, collector_number AS collectorNumber, lang, finishes, rarity,
      image_small AS imageSmall, image_normal AS imageNormal
    FROM printings
    WHERE oracle_id = ${oracleId}
    ORDER BY released_at DESC, set_code, CAST(collector_number AS INTEGER), collector_number`);

  return {
    card: {
      ...toCardSummary(row),
      keywords: JSON.parse(row.keywords) as string[],
      commanderLegality: row.commanderLegality,
    },
    printings: printings.map((p) => ({ ...p, finishes: JSON.parse(p.finishes) as Finish[] })),
    counts: toCounts(row),
  };
}
