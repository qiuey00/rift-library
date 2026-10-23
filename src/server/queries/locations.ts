import { type SQL, sql } from 'drizzle-orm';
import type { Db } from '../db/database';

// The location tree, worked out by one recursive query over parent_id and position.
// Deleted locations are left out, and so is anything under a deleted location.

/** The separator in a location path, such as "Closet › Bulk box 2 › Row C". */
export const PATH_SEPARATOR = ' › ';

/**
 * Every live location with its path, effective color and ancestry, sorted into tree order:
 * the inbox first, then the rest depth-first by position, then deck boxes as their own group.
 */
function tree(select: SQL) {
  return sql`
    WITH RECURSIVE tree(id, path, color, ancestry, sort_key, grp) AS (
      SELECT
        id,
        name,
        color,
        '/' || id || '/',
        printf('%010d.%010d', position, id),
        CASE type WHEN 'inbox' THEN 0 WHEN 'deck_box' THEN 2 ELSE 1 END
      FROM locations
      WHERE parent_id IS NULL AND deleted_at IS NULL
      UNION ALL
      SELECT
        child.id,
        tree.path || ${PATH_SEPARATOR} || child.name,
        COALESCE(child.color, tree.color),
        tree.ancestry || child.id || '/',
        tree.sort_key || '/' || printf('%010d.%010d', child.position, child.id),
        CASE child.type WHEN 'inbox' THEN 0 WHEN 'deck_box' THEN 2 ELSE tree.grp END
      FROM locations AS child
      JOIN tree ON child.parent_id = tree.id
      WHERE child.deleted_at IS NULL
    )
    ${select}`;
}

/** Location ids in tree order: the inbox first, then depth-first by position, deck boxes last. */
export function treeOrder(db: Db): number[] {
  return db
    .all<{ id: number }>(tree(sql`SELECT id FROM tree ORDER BY grp, sort_key`))
    .map((row) => row.id);
}

/** A location's names from the top, such as "Closet › Bulk box 2 › Row C"; null if deleted. */
export function locationPath(db: Db, id: number): string | null {
  return db.get<{ path: string }>(tree(sql`SELECT path FROM tree WHERE id = ${id}`))?.path ?? null;
}

/** Every live location's path by id, in tree order. */
export function locationPaths(db: Db): Map<number, string> {
  const rows = db.all<{ id: number; path: string }>(
    tree(sql`SELECT id, path FROM tree ORDER BY grp, sort_key`),
  );
  return new Map(rows.map((row) => [row.id, row.path]));
}

/** The location's own color, or its nearest ancestor's; null when none has one or it's deleted. */
export function effectiveColor(db: Db, id: number): string | null {
  return (
    db.get<{ color: string | null }>(tree(sql`SELECT color FROM tree WHERE id = ${id}`))?.color ??
    null
  );
}

/** Every live location's effective color by id: its own color, or its nearest ancestor's. */
export function locationColors(db: Db): Map<number, string | null> {
  const rows = db.all<{ id: number; color: string | null }>(tree(sql`SELECT id, color FROM tree`));
  return new Map(rows.map((row) => [row.id, row.color]));
}

/** Ids of every live location under this one (not itself), in tree order. */
export function descendantIds(db: Db, id: number): number[] {
  return db
    .all<{ id: number }>(
      tree(sql`
        SELECT id FROM tree
        WHERE instr(ancestry, ${`/${id}/`}) > 0 AND id <> ${id}
        ORDER BY grp, sort_key`),
    )
    .map((row) => row.id);
}

/**
 * Whether each location is for trade: marked itself, or inside a location that is, worked out
 * like the inherited color. Covers deleted locations too (still named as came-from locations),
 * so a deleted location under a marked one still reads as for trade.
 */
export function locationTradeFlags(db: Db): Map<number, boolean> {
  const rows = db.all<{ id: number; forTrade: number }>(sql`
    WITH RECURSIVE trade(id, for_trade) AS (
      SELECT id, for_trade FROM locations WHERE parent_id IS NULL
      UNION ALL
      SELECT child.id, max(child.for_trade, trade.for_trade)
      FROM locations AS child
      JOIN trade ON child.parent_id = trade.id
    )
    SELECT id, for_trade AS forTrade FROM trade`);
  return new Map(rows.map((row) => [row.id, row.forTrade === 1]));
}

/** Whether this location is for trade: marked itself, or inside a location that is. */
export function isForTrade(db: Db, id: number): boolean {
  return locationTradeFlags(db).get(id) ?? false;
}

/** Ids of every location (deleted ones too) that is for trade. */
export function tradeLocationIds(db: Db): number[] {
  return [...locationTradeFlags(db)].filter(([, forTrade]) => forTrade).map(([id]) => id);
}
