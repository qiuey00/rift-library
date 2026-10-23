import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpenDb } from '../../src/server/db/database';
import { locations } from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import {
  descendantIds,
  effectiveColor,
  locationPath,
  locationPaths,
  treeOrder,
} from '../../src/server/queries/locations';
import type { LocationType } from '../../src/shared/api/common';

describe('location queries', () => {
  let db: OpenDb;
  let ids: Record<string, number>;

  const add = (
    key: string,
    type: LocationType,
    position: number,
    parent?: string,
    color: string | null = null,
  ) => {
    ids[key] = db
      .insert(locations)
      .values({ name: key, type, position, color, parentId: parent ? ids[parent] : null })
      .returning()
      .get().id;
  };

  // Added out of order, so tree order has to come from position, not from ids.
  //   To sort (inbox)
  //   Closet (#ff0000)        position 1
  //     Bulk box 2            position 2
  //       Row C (#00ff00)     position 1
  //       Row A               position 0
  //     Bulk box 1            position 1
  //   Shelf                   position 0
  //     Trade binder          position 0
  //     Atraxa deck box       position 1, a deck box on a shelf
  //   Edgar deck box          position 3
  //   Old box (deleted)       position 5
  //     Lost tray             under a deleted location
  beforeEach(() => {
    db = createTestDb();
    ids = { inbox: db.select().from(locations).get()?.id ?? 0 };
    add('Edgar deck box', 'deck_box', 3);
    add('Closet', 'box', 1, undefined, '#ff0000');
    add('Bulk box 2', 'box', 2, 'Closet');
    add('Row C', 'tray', 1, 'Bulk box 2', '#00ff00');
    add('Row A', 'tray', 0, 'Bulk box 2');
    add('Bulk box 1', 'box', 1, 'Closet');
    add('Shelf', 'box', 0);
    add('Atraxa deck box', 'deck_box', 1, 'Shelf');
    add('Trade binder', 'binder', 0, 'Shelf');
    add('Old box', 'box', 5);
    add('Lost tray', 'tray', 0, 'Old box');
    db.update(locations)
      .set({ deletedAt: '2026-10-19T00:00:00.000Z' })
      .where(eq(locations.id, ids['Old box']))
      .run();
  });
  afterEach(() => db.$client.close());

  const names = (list: number[]) =>
    list.map((id) => Object.keys(ids).find((key) => ids[key] === id));

  it('orders the tree depth-first by position, inbox first and deck boxes last', () => {
    expect(names(treeOrder(db))).toEqual([
      'inbox',
      'Shelf',
      'Trade binder',
      'Closet',
      'Bulk box 1',
      'Bulk box 2',
      'Row A',
      'Row C',
      'Atraxa deck box',
      'Edgar deck box',
    ]);
  });

  it('names a location from the top', () => {
    expect(locationPath(db, ids['Row C'])).toBe('Closet › Bulk box 2 › Row C');
    expect(locationPath(db, ids.Closet)).toBe('Closet');
    expect(locationPath(db, ids.inbox)).toBe('To sort');
  });

  it('lists every path by id in tree order', () => {
    const paths = locationPaths(db);
    expect([...paths.keys()]).toEqual(treeOrder(db));
    expect(paths.get(ids['Row A'])).toBe('Closet › Bulk box 2 › Row A');
    expect(paths.get(ids['Atraxa deck box'])).toBe('Shelf › Atraxa deck box');
  });

  it('inherits the nearest ancestor color', () => {
    expect(effectiveColor(db, ids['Row C'])).toBe('#00ff00');
    expect(effectiveColor(db, ids['Row A'])).toBe('#ff0000');
    expect(effectiveColor(db, ids['Bulk box 1'])).toBe('#ff0000');
    expect(effectiveColor(db, ids.Closet)).toBe('#ff0000');
    expect(effectiveColor(db, ids.Shelf)).toBeNull();
  });

  it('lists descendants, not the location itself', () => {
    expect(names(descendantIds(db, ids.Closet))).toEqual([
      'Bulk box 1',
      'Bulk box 2',
      'Row A',
      'Row C',
    ]);
    expect(names(descendantIds(db, ids['Bulk box 2']))).toEqual(['Row A', 'Row C']);
    expect(descendantIds(db, ids['Row C'])).toEqual([]);
  });

  it('leaves out deleted locations and anything under them', () => {
    expect(treeOrder(db)).not.toContain(ids['Old box']);
    expect(treeOrder(db)).not.toContain(ids['Lost tray']);
    expect(locationPath(db, ids['Old box'])).toBeNull();
    expect(locationPath(db, ids['Lost tray'])).toBeNull();
    expect(locationPaths(db).has(ids['Old box'])).toBe(false);
    expect(effectiveColor(db, ids['Old box'])).toBeNull();
    expect(descendantIds(db, ids['Old box'])).toEqual([]);

    db.update(locations)
      .set({ deletedAt: '2026-10-19T00:00:00.000Z' })
      .where(eq(locations.id, ids['Row A']))
      .run();
    expect(descendantIds(db, ids.Closet)).not.toContain(ids['Row A']);
  });

  it('keeps ids apart that share digits, such as 1 and 10', () => {
    // A descendant's ancestry is matched by whole ids, so the inbox (id 1) has none even
    // though "Trade binder" (id 10) sits under "Shelf" with an ancestry of /8/10/.
    expect(ids.inbox).toBe(1);
    expect(ids['Trade binder']).toBe(10);
    add('Trade sleeve', 'tray', 0, 'Trade binder');
    expect(descendantIds(db, ids.inbox)).toEqual([]);
    expect(names(descendantIds(db, ids.Shelf))).toEqual([
      'Trade binder',
      'Trade sleeve',
      'Atraxa deck box',
    ]);
  });
});
