import { and, eq, isNull, sql } from 'drizzle-orm';
import type { CardSummary, DeckState, Finish, LocationRef } from '../../shared/api/common';
import type { AssemblyDeck } from '../../shared/api/pick-list';
import type { PutAwayGroup, PutAwayLine, PutAwayResponse } from '../../shared/api/put-away';
import type { Db } from '../db/database';
import { decks, locations } from '../db/schema';
import { effectiveColor, isForTrade, locationPaths } from './locations';

// The put-away list: cards leave a deck box the way they came in, back to the spot they left.
// It is worked out every time it opens and never stored. The swap list reuses
// `putAwayList` and `destinationFor`.

type DeckRow = { id: number; name: string; deckBoxId: number };

/** A live deck, or undefined. */
export function findLiveDeck(db: Db, id: number): DeckRow | undefined {
  return db
    .select({ id: decks.id, name: decks.name, deckBoxId: decks.deckBoxId })
    .from(decks)
    .where(and(eq(decks.id, id), isNull(decks.deletedAt)))
    .get();
}

/** The "To sort" inbox's id. */
export function inboxId(db: Db): number {
  const inbox = db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.type, 'inbox'), isNull(locations.deletedAt)))
    .get();
  if (!inbox) throw new Error('The "To sort" inbox is missing');
  return inbox.id;
}

/**
 * Where a copy stack in a deck box goes back to: its came-from location, or the "To sort"
 * inbox when it has none (such as a proxy added straight into the box) or that location has
 * since been deleted. Nothing is put away to a guessed location.
 */
export function destinationFor(
  db: Db,
  stack: { cameFromLocationId: number | null },
  paths: Map<number, string> = locationPaths(db),
): number {
  const cameFrom = stack.cameFromLocationId;
  return cameFrom !== null && paths.has(cameFrom) ? cameFrom : inboxId(db);
}

/** A location as the API names it; deleted ones (still named as a came-from) use their name. */
export function locationRef(db: Db, id: number, paths: Map<number, string>): LocationRef {
  const row = db
    .select({ id: locations.id, name: locations.name, type: locations.type })
    .from(locations)
    .where(eq(locations.id, id))
    .get();
  if (!row) throw new Error(`Location ${id} is missing`);
  return {
    ...row,
    path: paths.get(id) ?? row.name,
    color: effectiveColor(db, id),
    forTrade: isForTrade(db, id),
  };
}

type BoxStack = {
  stackId: number;
  quantity: number;
  finish: Finish;
  condition: string;
  language: string;
  misprint: number;
  altered: number;
  isProxy: number;
  cameFromLocationId: number | null;
  printingId: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  lang: string;
  finishes: string;
  rarity: string;
  imageSmall: string | null;
  imageNormal: string | null;
  oracleId: string;
  name: string;
  frontFaceName: string;
  manaCost: string;
  manaValue: number;
  typeLine: string;
  colorIdentity: string;
  canBeCommander: number;
  isBasicLand: number;
};

/** Every copy stack in a deck box, by card name. */
function boxStacks(db: Db, deckBoxId: number): BoxStack[] {
  return db.all<BoxStack>(sql`
    SELECT
      s.id AS stackId, s.quantity, s.finish, s.condition, s.language, s.misprint, s.altered,
      s.is_proxy AS isProxy, s.came_from_location_id AS cameFromLocationId,
      p.printing_id AS printingId, p.set_code AS setCode, p.set_name AS setName,
      p.collector_number AS collectorNumber, p.lang, p.finishes, p.rarity,
      p.image_small AS imageSmall, p.image_normal AS imageNormal,
      c.oracle_id AS oracleId, c.name, c.front_face_name AS frontFaceName,
      c.mana_cost AS manaCost, c.mana_value AS manaValue, c.type_line AS typeLine,
      c.color_identity AS colorIdentity, c.can_be_commander AS canBeCommander,
      c.is_basic_land AS isBasicLand
    FROM copy_stacks AS s
    JOIN printings AS p ON p.printing_id = s.printing_id
    JOIN cards AS c ON c.oracle_id = p.oracle_id
    WHERE s.location_id = ${deckBoxId}
    ORDER BY c.name COLLATE NOCASE, s.id`);
}

function cardOf(stack: BoxStack): CardSummary {
  return {
    oracleId: stack.oracleId,
    name: stack.name,
    frontFaceName: stack.frontFaceName,
    manaCost: stack.manaCost,
    manaValue: stack.manaValue,
    typeLine: stack.typeLine,
    colorIdentity: stack.colorIdentity,
    imageSmall: stack.imageSmall,
    imageNormal: stack.imageNormal,
    canBeCommander: stack.canBeCommander === 1,
    isBasicLand: stack.isBasicLand === 1,
  };
}

const BOARD_ORDER = { commander: 0, main: 1, maybe: 2 } as const;

/**
 * The deck's state from what its box holds, by the deck queries' rule: maybeboard and basic
 * land slots don't count; copies in the box are shared out among slots of that card,
 * commander first. Not assembled while no counted slot has a copy in the box, assembled when
 * every counted slot is full, partly assembled otherwise.
 */
export function deckState(db: Db, deck: DeckRow): DeckState {
  const slots = db
    .all<{ id: number; board: keyof typeof BOARD_ORDER; quantity: number; oracleId: string }>(sql`
      SELECT s.id, s.board, s.quantity, s.oracle_id AS oracleId
      FROM deck_slots AS s
      JOIN cards AS c ON c.oracle_id = s.oracle_id
      WHERE s.deck_id = ${deck.id} AND s.board <> 'maybe' AND c.is_basic_land = 0`)
    .sort((a, b) => BOARD_ORDER[a.board] - BOARD_ORDER[b.board] || a.id - b.id);
  const inBox = new Map(
    db
      .all<{ oracleId: string; quantity: number }>(sql`
        SELECT p.oracle_id AS oracleId, SUM(s.quantity) AS quantity
        FROM copy_stacks AS s
        JOIN printings AS p ON p.printing_id = s.printing_id
        WHERE s.location_id = ${deck.deckBoxId}
        GROUP BY p.oracle_id`)
      .map((row) => [row.oracleId, row.quantity]),
  );
  const left = new Map(inBox);
  let filled = 0;
  let touched = 0;
  for (const slot of slots) {
    if ((inBox.get(slot.oracleId) ?? 0) > 0) touched += 1;
    const here = Math.min(left.get(slot.oracleId) ?? 0, slot.quantity);
    left.set(slot.oracleId, (left.get(slot.oracleId) ?? 0) - here);
    if (here >= slot.quantity) filled += 1;
  }
  if (touched === 0) return 'not_assembled';
  return filled === slots.length ? 'assembled' : 'partly_assembled';
}

export function assemblyDeck(db: Db, deck: DeckRow): AssemblyDeck {
  return { id: deck.id, name: deck.name, state: deckState(db, deck) };
}

/**
 * Every copy stack in the deck's box with its destination, grouped by destination in
 * location-tree order (the same order as the pick list). Undefined when there is no such deck.
 */
export function putAwayList(db: Db, deckId: number): PutAwayResponse | undefined {
  const deck = findLiveDeck(db, deckId);
  if (!deck) return undefined;
  const paths = locationPaths(db);
  const order = new Map([...paths.keys()].map((id, index) => [id, index]));
  const refs = new Map<number, LocationRef>();
  const ref = (id: number) => {
    let found = refs.get(id);
    if (!found) {
      found = locationRef(db, id, paths);
      refs.set(id, found);
    }
    return found;
  };

  const groups = new Map<number, PutAwayLine[]>();
  for (const stack of boxStacks(db, deck.deckBoxId)) {
    const destination = destinationFor(db, stack, paths);
    const line: PutAwayLine = {
      stackId: stack.stackId,
      card: cardOf(stack),
      printing: {
        printingId: stack.printingId,
        oracleId: stack.oracleId,
        setCode: stack.setCode,
        setName: stack.setName,
        collectorNumber: stack.collectorNumber,
        lang: stack.lang,
        finishes: JSON.parse(stack.finishes),
        rarity: stack.rarity,
        imageSmall: stack.imageSmall,
        imageNormal: stack.imageNormal,
      },
      finish: stack.finish,
      condition: stack.condition,
      language: stack.language,
      misprint: stack.misprint === 1,
      altered: stack.altered === 1,
      isProxy: stack.isProxy === 1,
      quantity: stack.quantity,
      destination: ref(destination),
      cameFrom: stack.cameFromLocationId === null ? null : ref(stack.cameFromLocationId),
    };
    const lines = groups.get(destination) ?? [];
    lines.push(line);
    groups.set(destination, lines);
  }

  const sorted: PutAwayGroup[] = [...groups]
    .sort(([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map(([id, lines]) => ({ location: ref(id), lines }));
  const lines = sorted.flatMap((group) => group.lines);
  return {
    deck: assemblyDeck(db, deck),
    groups: sorted,
    totals: { lines: lines.length, cards: lines.reduce((sum, line) => sum + line.quantity, 0) },
  };
}
