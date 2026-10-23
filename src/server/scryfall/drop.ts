import { sql } from 'drizzle-orm';
import type { Db } from '../db/database';
import { type CardIdentifier, lookupCards } from './lookup';

// Works out which card a browser drop names, for dragging cards in from scryfall.com and
// edhrec.com. A drop carries `text/uri-list`, `text/html` and `text/plain` strings:
//
// - Scryfall search results: the card page URL, and the <img> whose file is named by the
//   printing's Scryfall id (cards.scryfall.io/grid/front/b/e/<id>.webp).
// - A Scryfall card page's big image: the image URL itself.
// - EDHREC card tiles: the card URL (edhrec.com/cards/<slug>), and an <a> holding an <img>
//   from card-images.edhrec.com, also named by the Scryfall id.
//
// Other browsers may send only the URL, so each kind works alone.

/** What a drop says about the card, best first. */
export type DropClue = CardIdentifier | { slug: string };

export type CardDrop = { uriList?: string; html?: string; text?: string };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** An image named by a printing's Scryfall id, on Scryfall's or EDHREC's image host. */
const IMAGE_ID = new RegExp(
  `https?://(?:cards\\.scryfall\\.io|card-images\\.edhrec\\.com)/[^\\s"'<>]*/(${UUID})\\.\\w+`,
  'gi',
);
const API_ID = new RegExp(`https?://api\\.scryfall\\.com/cards/(${UUID})`, 'gi');
const SCRYFALL_PAGE = /https?:\/\/(?:www\.)?scryfall\.com\/card\/([a-z0-9]+)\/([^/\s"'<>?#]+)/gi;
const EDHREC_PAGE = /https?:\/\/(?:www\.)?edhrec\.com\/(?:cards|commanders)\/([a-z0-9-]+)/gi;

/** The clues in a drop, best first, without repeats. */
export function dropClues(drop: CardDrop): DropClue[] {
  const all = [drop.uriList, drop.html, drop.text].filter(Boolean).join('\n');
  const clues: DropClue[] = [];
  for (const [, id] of all.matchAll(IMAGE_ID)) clues.push({ id: id.toLowerCase() });
  for (const [, id] of all.matchAll(API_ID)) clues.push({ id: id.toLowerCase() });
  for (const [, set, number] of all.matchAll(SCRYFALL_PAGE)) {
    clues.push({ set: set.toLowerCase(), collector_number: decodeURIComponent(number) });
  }
  for (const [, slug] of all.matchAll(EDHREC_PAGE)) clues.push({ slug });
  const name = cardName(drop.text);
  if (name) clues.push({ name });

  const seen = new Set<string>();
  return clues.filter((clue) => {
    const key = JSON.stringify(clue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Plain text that could be a card name, such as "Sol Ring" or a decklist line "1x Sol Ring". */
function cardName(text: string | undefined) {
  const line = text?.trim();
  if (!line || line.length > 150 || /[\n\r]|:\/\//.test(line)) return undefined;
  return line.replace(/^\d+x?\s+/i, '').trim() || undefined;
}

/** A card name the way EDHREC writes it in URLs, such as "the-theorist-jace-beleren". */
export function edhrecSlug(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
}

/** The card's oracle id from the card data, or undefined. */
function findLocally(db: Db, clue: DropClue): string | undefined {
  let row: { oracleId: string } | undefined;
  if ('id' in clue) {
    row = db.get(sql`SELECT oracle_id AS oracleId FROM printings WHERE scryfall_id = ${clue.id}`);
  } else if ('set' in clue) {
    row = db.get(sql`
      SELECT oracle_id AS oracleId FROM printings
      WHERE set_code = ${clue.set} AND collector_number = ${clue.collector_number}
      LIMIT 1`);
  } else if ('name' in clue) {
    row = db.get(sql`
      SELECT oracle_id AS oracleId FROM cards
      WHERE name = ${clue.name} COLLATE NOCASE OR front_face_name = ${clue.name} COLLATE NOCASE
      ORDER BY name = ${clue.name} COLLATE NOCASE DESC
      LIMIT 1`);
  } else {
    // Words in the slug, in order, narrow the names down; the slug itself then picks one.
    const pattern = `%${clue.slug.split('-').join('%')}%`;
    const candidates = db.all<{ oracleId: string; name: string; frontFaceName: string }>(sql`
      SELECT oracle_id AS oracleId, name, front_face_name AS frontFaceName FROM cards
      WHERE front_face_name LIKE ${pattern} OR name LIKE ${pattern}`);
    row = candidates.find(
      (card) => edhrecSlug(card.frontFaceName) === clue.slug || edhrecSlug(card.name) === clue.slug,
    );
  }
  return row?.oracleId;
}

/**
 * The oracle id of the card a drop names, or undefined when it names none. Looks in the card
 * data first, then asks Scryfall about the best clue it can ask about (an EDHREC slug isn't
 * one). Throws `ScryfallUnavailableError` when Scryfall is needed but can't be reached.
 */
export async function resolveDrop(db: Db, drop: CardDrop): Promise<string | undefined> {
  const clues = dropClues(drop);
  for (const clue of clues) {
    const oracleId = findLocally(db, clue);
    if (oracleId) return oracleId;
  }
  const askable = clues.filter((clue): clue is CardIdentifier => !('slug' in clue));
  if (askable.length === 0) return undefined;
  const { resolved } = await lookupCards(db, askable.slice(0, 1));
  return resolved[0]?.oracleId;
}
