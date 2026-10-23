import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DeckRef } from '../../shared/api/decks';
import type { HexColor, LocationNode } from '../../shared/api/locations';
import type { Db } from '../db/database';
import { copyStacks, decks, locations } from '../db/schema';
import { locationPaths } from './locations';
import { treeWorth } from './value';

// The location tree as the Locations screen shows it: every live location in tree order,
// with its path, inherited color, depth, card counts, owning deck, whether it is for trade and
// what it is worth.

/** Every live location as a `LocationNode`, in tree order. */
export function locationTree(db: Db): LocationNode[] {
  // Tree order and paths come from the recursive query, which also leaves out anything
  // under a deleted location.
  const paths = locationPaths(db);
  const rows = new Map(
    db
      .select()
      .from(locations)
      .where(isNull(locations.deletedAt))
      .all()
      .map((row) => [row.id, row]),
  );

  const counts = new Map(
    db
      .select({
        locationId: copyStacks.locationId,
        count: sql<number>`sum(${copyStacks.quantity})`,
      })
      .from(copyStacks)
      .groupBy(copyStacks.locationId)
      .all()
      .map((row) => [row.locationId, row.count]),
  );

  const deckByBox = new Map<number, DeckRef>(
    db
      .select({ id: decks.id, name: decks.name, deckBoxId: decks.deckBoxId })
      .from(decks)
      .where(isNull(decks.deletedAt))
      .all()
      .map((deck) => [deck.deckBoxId, { id: deck.id, name: deck.name }]),
  );

  const worth = treeWorth(db, new Map([...rows.values()].map((row) => [row.id, row.parentId])));

  const nodes = new Map<number, LocationNode>();
  // Tree order puts every parent before its children, except that deck boxes come last as
  // their own group, so a deck box's parent is always listed already too.
  for (const [id, path] of paths) {
    const row = rows.get(id);
    if (!row) continue;
    const parent = row.parentId === null ? undefined : nodes.get(row.parentId);
    nodes.set(id, {
      id,
      name: row.name,
      type: row.type,
      parentId: row.parentId,
      position: row.position,
      color: row.color as HexColor | null,
      effectiveColor: (row.color as HexColor | null) ?? parent?.effectiveColor ?? null,
      path,
      depth: parent ? parent.depth + 1 : 0,
      cardCount: counts.get(id) ?? 0,
      totalCount: 0,
      deck: deckByBox.get(id) ?? null,
      markedForTrade: row.forTrade,
      // For trade when it or a location it sits in is marked, like the inherited color.
      forTrade: row.forTrade || (parent?.forTrade ?? false),
      value: worth.get(id)?.value ?? 0,
      noPriceCount: worth.get(id)?.noPriceCount ?? 0,
    });
  }

  // Each location's copies count toward it and every ancestor.
  for (const node of nodes.values()) {
    let at: LocationNode | undefined = node;
    while (at) {
      at.totalCount += node.cardCount;
      at = at.parentId === null ? undefined : nodes.get(at.parentId);
    }
  }

  return [...nodes.values()];
}

/** One live location as a `LocationNode`; undefined when it is missing or deleted. */
export function locationNode(db: Db, id: number): LocationNode | undefined {
  return locationTree(db).find((node) => node.id === id);
}

/** The live deck whose deck box this is, if any. */
export function deckForBox(db: Db, locationId: number): DeckRef | undefined {
  return db
    .select({ id: decks.id, name: decks.name })
    .from(decks)
    .where(and(eq(decks.deckBoxId, locationId), isNull(decks.deletedAt)))
    .get();
}

/** Copies (stack quantities) directly in any of these locations. */
export function copiesIn(db: Db, locationIds: number[]): number {
  if (locationIds.length === 0) return 0;
  return (
    db
      .select({ count: sql<number>`coalesce(sum(${copyStacks.quantity}), 0)` })
      .from(copyStacks)
      .where(inArray(copyStacks.locationId, locationIds))
      .get()?.count ?? 0
  );
}
