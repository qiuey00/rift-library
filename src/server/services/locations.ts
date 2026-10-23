import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import type {
  CreateLocationBody,
  LocationNode,
  LocationNotEmptyError,
  UpdateLocationBody,
} from '../../shared/api/locations';
import type { Db } from '../db/database';
import { locations } from '../db/schema';
import { AppError } from '../errors';
import { copiesIn, deckForBox, locationNode } from '../queries/location-tree';
import { descendantIds } from '../queries/locations';

// Creating, changing and deleting locations (LOC-1, LOC-2, LOC-3, LOC-5). Each action runs
// in one transaction.

/** Refused delete of a location that still holds copies, answered as 409 with the count. */
export class LocationNotEmpty extends AppError {
  readonly cardCount: number;

  constructor(name: string, cardCount: number) {
    const cards = `${cardCount.toLocaleString('en-US')} ${cardCount === 1 ? 'card' : 'cards'}`;
    super(
      409,
      'location_not_empty',
      `${name} still holds ${cards}. Move them first, or send them all to To sort.`,
    );
    this.cardCount = cardCount;
  }

  body(): LocationNotEmptyError {
    return {
      error: { code: 'location_not_empty', message: this.message, cardCount: this.cardCount },
    };
  }
}

type LocationRow = typeof locations.$inferSelect;

/** A live location, or 404. */
function liveLocation(db: Db, id: number): LocationRow {
  const row = db
    .select()
    .from(locations)
    .where(and(eq(locations.id, id), isNull(locations.deletedAt)))
    .get();
  if (!row) {
    throw new AppError(404, 'location_not_found', 'That location no longer exists.');
  }
  return row;
}

/** The location a new or moved location goes into: live, and not the inbox. */
function checkParent(db: Db, parentId: number): LocationRow {
  const parent = db
    .select()
    .from(locations)
    .where(and(eq(locations.id, parentId), isNull(locations.deletedAt)))
    .get();
  if (!parent) {
    throw new AppError(400, 'parent_not_found', 'The location to put it in no longer exists.');
  }
  if (parent.type === 'inbox') {
    throw new AppError(
      400,
      'inbox_protected',
      'To sort is the inbox, so other locations can’t go inside it.',
    );
  }
  return parent;
}

const inboxProtected = () =>
  new AppError(400, 'inbox_protected', 'To sort is the inbox, so it can’t be renamed or deleted.');

/** Live locations under one parent (null for the top level), in order. */
function siblings(db: Db, parentId: number | null, except?: number) {
  return db
    .select({ id: locations.id, position: locations.position })
    .from(locations)
    .where(
      and(
        parentId === null ? isNull(locations.parentId) : eq(locations.parentId, parentId),
        isNull(locations.deletedAt),
        except === undefined ? undefined : ne(locations.id, except),
      ),
    )
    .orderBy(asc(locations.position), asc(locations.id))
    .all();
}

/**
 * Numbers a parent's live children 0, 1, 2... in their current order, with `insert` placed
 * at `index` (clamped to the end) when given.
 */
function renumber(db: Db, parentId: number | null, insert?: { id: number; index: number }) {
  const ids = siblings(db, parentId, insert?.id).map((row) => row.id);
  if (insert) ids.splice(Math.min(insert.index, ids.length), 0, insert.id);
  ids.forEach((id, position) => {
    db.update(locations).set({ position, parentId }).where(eq(locations.id, id)).run();
  });
}

function nodeFor(db: Db, id: number): LocationNode {
  const node = locationNode(db, id);
  if (!node) throw new Error(`Location ${id} is missing from the tree.`);
  return node;
}

/** Adds a location last among its siblings. */
export function createLocation(db: Db, body: CreateLocationBody): LocationNode {
  return db.transaction((tx) => {
    const parentId = body.parentId ?? null;
    if (parentId !== null) checkParent(tx, parentId);
    const position = siblings(tx, parentId).length;
    const { id } = tx
      .insert(locations)
      .values({ name: body.name, type: body.type, parentId, position })
      .returning({ id: locations.id })
      .get();
    return nodeFor(tx, id);
  });
}

/** Renames, recolors, moves, reorders or marks For trade a location (TRADE-1). */
export function updateLocation(db: Db, id: number, body: UpdateLocationBody): LocationNode {
  return db.transaction((tx) => {
    const row = liveLocation(tx, id);
    const isInbox = row.type === 'inbox';

    if (body.name !== undefined && body.name !== row.name) {
      if (isInbox) throw inboxProtected();
      tx.update(locations).set({ name: body.name }).where(eq(locations.id, id)).run();
    }
    if (body.color !== undefined) {
      tx.update(locations).set({ color: body.color }).where(eq(locations.id, id)).run();
    }
    if (body.forTrade !== undefined && body.forTrade !== row.forTrade) {
      if (isInbox) {
        throw new AppError(400, 'inbox_protected', 'The To sort inbox can’t be for trade.');
      }
      if (row.type === 'deck_box') {
        throw new AppError(400, 'deck_box_not_for_trade', 'A deck box can’t be for trade.');
      }
      tx.update(locations).set({ forTrade: body.forTrade }).where(eq(locations.id, id)).run();
    }

    const newParent = body.parentId === undefined ? row.parentId : body.parentId;
    if (newParent !== row.parentId) {
      if (isInbox) {
        throw new AppError(
          400,
          'inbox_protected',
          'To sort is the inbox, so it stays at the top level.',
        );
      }
      if (newParent !== null) {
        checkParent(tx, newParent);
        if (newParent === id) {
          throw new AppError(400, 'location_loop', `${row.name} can’t go inside itself.`);
        }
        if (descendantIds(tx, id).includes(newParent)) {
          throw new AppError(
            400,
            'location_loop',
            `${row.name} can’t go inside one of its own sections.`,
          );
        }
      }
      // Place it in its new parent (last unless a position was sent), then close the gap
      // it left.
      renumber(tx, newParent, { id, index: body.position ?? Number.MAX_SAFE_INTEGER });
      renumber(tx, row.parentId);
    } else if (body.position !== undefined) {
      renumber(tx, row.parentId, { id, index: body.position });
    }

    return nodeFor(tx, id);
  });
}

/**
 * Hides a location and everything under it (a soft delete, so History can still name
 * them). Refused for the inbox, for a deck's own deck box, and while copies remain.
 */
export function deleteLocation(db: Db, id: number): void {
  db.transaction((tx) => {
    const row = liveLocation(tx, id);
    if (row.type === 'inbox') throw inboxProtected();

    const ids = [id, ...descendantIds(tx, id)];
    for (const locationId of ids) {
      const deck = deckForBox(tx, locationId);
      if (deck) {
        const box = locationId === id ? row.name : liveLocation(tx, locationId).name;
        const inside = locationId === id ? '' : `, which is inside ${row.name},`;
        throw new AppError(
          400,
          'deck_box_protected',
          `${box}${inside} belongs to the ${deck.name} deck. Delete the deck to remove it.`,
        );
      }
    }

    const cardCount = copiesIn(tx, ids);
    if (cardCount > 0) throw new LocationNotEmpty(row.name, cardCount);

    const deletedAt = new Date().toISOString();
    for (const locationId of ids) {
      tx.update(locations).set({ deletedAt }).where(eq(locations.id, locationId)).run();
    }
    renumber(tx, row.parentId);
  });
}
