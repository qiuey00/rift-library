import { eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppType, app } from '../../src/server/app';
import { type OpenDb, setDb } from '../../src/server/db/database';
import { cards, copyStacks, decks, locations, printings } from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { ErrorBody } from '../../src/shared/api/common';
import {
  LocationNode,
  LocationNotEmptyError,
  LocationTree,
  type UpdateLocationBody,
} from '../../src/shared/api/locations';

// The locations routes against a fresh in-memory database.

const client = hc<AppType>('http://localhost', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

let db: OpenDb;
let inboxId: number;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  inboxId = db.select().from(locations).get()?.id ?? 0;
  db.insert(cards)
    .values({
      oracleId: 'oracle-sol-ring',
      name: 'Sol Ring',
      frontFaceName: 'Sol Ring',
      typeLine: 'Artifact',
      commanderLegality: 'legal',
    })
    .run();
  db.insert(printings)
    .values({
      scryfallId: 'print-sol-ring',
      oracleId: 'oracle-sol-ring',
      setCode: 'eoc',
      setName: 'Edge of Eternities Commander',
      collectorNumber: '57',
      lang: 'en',
      finishes: ['nonfoil'],
      rarity: 'uncommon',
      releasedAt: '2025-08-01',
    })
    .run();
});
afterEach(() => db.$client.close());

async function tree() {
  const res = await client.locations.tree.$get();
  expect(res.status).toBe(200);
  return LocationTree.parse(await res.json()).nodes;
}

async function create(
  name: string,
  type: 'box' | 'binder' | 'tray' | 'deck_box',
  parentId?: number,
) {
  const res = await client.locations.$post({ json: { name, type, parentId } });
  expect(res.status).toBe(200);
  return LocationNode.parse(await res.json());
}

const patch = (id: number, json: UpdateLocationBody) =>
  client.locations[':id'].$patch({ param: { id: String(id) }, json });

const remove = (id: number) => client.locations[':id'].$delete({ param: { id: String(id) } });

async function errorCode(res: Response, status: number) {
  expect(res.status).toBe(status);
  return ErrorBody.parse(await res.json()).error;
}

function addCopies(locationId: number, quantity: number, condition = 'near_mint') {
  db.insert(copyStacks)
    .values({
      scryfallId: 'print-sol-ring',
      quantity,
      finish: 'nonfoil',
      condition,
      language: 'en',
      locationId,
    })
    .run();
}

function addDeck(name: string, deckBoxId: number) {
  return db.insert(decks).values({ name, deckBoxId }).returning().get();
}

const names = (nodes: LocationNode[]) => nodes.map((node) => node.name);

describe('GET /api/locations/tree', () => {
  it('starts with just the inbox', async () => {
    expect(await tree()).toEqual([
      {
        id: inboxId,
        name: 'To sort',
        type: 'inbox',
        parentId: null,
        position: 0,
        color: null,
        effectiveColor: null,
        path: 'To sort',
        depth: 0,
        cardCount: 0,
        totalCount: 0,
        deck: null,
        markedForTrade: false,
        forTrade: false,
        value: 0,
        noPriceCount: 0,
      },
    ]);
  });

  it('lists locations in tree order with paths, depth and counts including children', async () => {
    const deckBox = await create('Hearthhull deck box', 'deck_box');
    const longBox = await create('Long box', 'box');
    const lands = await create('Lands', 'box', longBox.id);
    const basics = await create('Basics', 'tray', lands.id);
    const binder = await create('Rares binder', 'binder');
    addCopies(inboxId, 3);
    addCopies(longBox.id, 1);
    addCopies(lands.id, 4);
    addCopies(basics.id, 10);
    addCopies(basics.id, 2, 'played');
    addCopies(deckBox.id, 1);
    addDeck('Hearthhull', deckBox.id);

    const nodes = await tree();
    expect(names(nodes)).toEqual([
      'To sort',
      'Long box',
      'Lands',
      'Basics',
      'Rares binder',
      'Hearthhull deck box',
    ]);
    const byName = new Map(nodes.map((node) => [node.name, node]));
    expect(byName.get('Basics')).toMatchObject({
      path: 'Long box › Lands › Basics',
      depth: 2,
      cardCount: 12,
      totalCount: 12,
    });
    expect(byName.get('Lands')).toMatchObject({ depth: 1, cardCount: 4, totalCount: 16 });
    expect(byName.get('Long box')).toMatchObject({ cardCount: 1, totalCount: 17 });
    expect(byName.get('To sort')).toMatchObject({ cardCount: 3, totalCount: 3 });
    expect(byName.get('Rares binder')).toMatchObject({ cardCount: 0, totalCount: 0, deck: null });
    expect(byName.get('Hearthhull deck box')?.deck).toEqual({
      id: expect.any(Number),
      name: 'Hearthhull',
    });
    expect(binder.type).toBe('binder');
  });

  it('inherits the nearest ancestor color', async () => {
    const longBox = await create('Long box', 'box');
    const lands = await create('Lands', 'box', longBox.id);
    const basics = await create('Basics', 'tray', lands.id);
    await patch(longBox.id, { color: '#3b6fd8' });
    await patch(basics.id, { color: '#2f9e5b' });

    const byName = new Map((await tree()).map((node) => [node.name, node]));
    expect(byName.get('Long box')).toMatchObject({ color: '#3b6fd8', effectiveColor: '#3b6fd8' });
    expect(byName.get('Lands')).toMatchObject({ color: null, effectiveColor: '#3b6fd8' });
    expect(byName.get('Basics')).toMatchObject({ color: '#2f9e5b', effectiveColor: '#2f9e5b' });
  });

  it('leaves out the deck of a deleted deck', async () => {
    const deckBox = await create('Old deck box', 'deck_box');
    const deck = addDeck('Old deck', deckBox.id);
    db.update(decks)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(decks.id, deck.id))
      .run();
    expect((await tree()).find((node) => node.id === deckBox.id)?.deck).toBeNull();
  });
});

describe('POST /api/locations', () => {
  it('adds each new location last among its siblings', async () => {
    const a = await create('Shelf', 'box');
    const b = await create('Bulk tray', 'tray');
    expect(a).toMatchObject({ parentId: null, position: 1, path: 'Shelf', depth: 0 });
    expect(b.position).toBe(2);

    const first = await create('Trade binder', 'binder', a.id);
    const second = await create('Row A', 'tray', a.id);
    expect(first).toMatchObject({ parentId: a.id, position: 0, path: 'Shelf › Trade binder' });
    expect(second.position).toBe(1);
  });

  it('refuses a missing parent and the inbox as a parent', async () => {
    const missing = await client.locations.$post({
      json: { name: 'Box', type: 'box', parentId: 999 },
    });
    expect((await errorCode(missing, 400)).code).toBe('parent_not_found');

    const inInbox = await client.locations.$post({
      json: { name: 'Box', type: 'box', parentId: inboxId },
    });
    expect((await errorCode(inInbox, 400)).code).toBe('inbox_protected');
  });
});

describe('PATCH /api/locations/:id', () => {
  it('renames and recolors, and clears a color back to the parent’s', async () => {
    const box = await create('Long box', 'box');
    const res = await patch(box.id, { name: 'Big box', color: '#7c5cd6' });
    expect(res.status).toBe(200);
    expect(LocationNode.parse(await res.json())).toMatchObject({
      name: 'Big box',
      path: 'Big box',
      color: '#7c5cd6',
    });

    const cleared = LocationNode.parse(await (await patch(box.id, { color: null })).json());
    expect(cleared).toMatchObject({ color: null, effectiveColor: null });
  });

  it('reorders among siblings, shifting the others', async () => {
    const a = await create('A', 'box');
    const b = await create('B', 'box');
    const c = await create('C', 'box');
    const moved = LocationNode.parse(await (await patch(c.id, { position: 0 })).json());
    expect(moved.position).toBe(0);

    const nodes = await tree();
    expect(names(nodes)).toEqual(['To sort', 'C', 'A', 'B']);
    const positions = new Map(nodes.map((node) => [node.id, node.position]));
    expect([
      positions.get(c.id),
      positions.get(inboxId),
      positions.get(a.id),
      positions.get(b.id),
    ]).toEqual([0, 1, 2, 3]);

    // A position past the end puts it last.
    await patch(c.id, { position: 99 });
    expect(names(await tree())).toEqual(['To sort', 'A', 'B', 'C']);
  });

  it('moves a location under another, closing the gap it leaves', async () => {
    const shelf = await create('Shelf', 'box');
    const closet = await create('Closet', 'box');
    const a = await create('A', 'tray', shelf.id);
    const b = await create('B', 'tray', shelf.id);
    const c = await create('C', 'tray', shelf.id);
    const existing = await create('Existing', 'tray', closet.id);

    const moved = LocationNode.parse(await (await patch(a.id, { parentId: closet.id })).json());
    expect(moved).toMatchObject({ parentId: closet.id, position: 1, path: 'Closet › A', depth: 1 });

    const byId = new Map((await tree()).map((node) => [node.id, node]));
    expect(byId.get(b.id)?.position).toBe(0);
    expect(byId.get(c.id)?.position).toBe(1);
    expect(byId.get(existing.id)?.position).toBe(0);

    // Into a parent at a chosen position, and back to the top level.
    await patch(c.id, { parentId: closet.id, position: 0 });
    expect(names(await tree())).toEqual(['To sort', 'Shelf', 'B', 'Closet', 'C', 'Existing', 'A']);
    const top = LocationNode.parse(await (await patch(b.id, { parentId: null })).json());
    expect(top).toMatchObject({ parentId: null, depth: 0, position: 3 });
  });

  it('refuses a loop', async () => {
    const longBox = await create('Long box', 'box');
    const lands = await create('Lands', 'box', longBox.id);
    const basics = await create('Basics', 'tray', lands.id);

    const intoChild = await errorCode(await patch(longBox.id, { parentId: basics.id }), 400);
    expect(intoChild).toEqual({
      code: 'location_loop',
      message: 'Long box can’t go inside one of its own sections.',
    });
    expect((await errorCode(await patch(lands.id, { parentId: lands.id }), 400)).code).toBe(
      'location_loop',
    );
    expect((await tree()).find((node) => node.id === longBox.id)?.parentId).toBeNull();
  });

  it('refuses renaming or moving the inbox, but allows recoloring it', async () => {
    const box = await create('Box', 'box');
    expect((await errorCode(await patch(inboxId, { name: 'Inbox' }), 400)).code).toBe(
      'inbox_protected',
    );
    expect((await errorCode(await patch(inboxId, { parentId: box.id }), 400)).code).toBe(
      'inbox_protected',
    );
    expect((await patch(inboxId, { color: '#8a6248' })).status).toBe(200);
    expect((await patch(inboxId, { name: 'To sort' })).status).toBe(200);
  });

  it('answers 404 for a missing or deleted location', async () => {
    const box = await create('Box', 'box');
    await remove(box.id);
    expect((await errorCode(await patch(box.id, { name: 'Again' }), 404)).code).toBe(
      'location_not_found',
    );
    expect((await errorCode(await patch(999, { name: 'Again' }), 404)).code).toBe(
      'location_not_found',
    );
  });
});

describe('DELETE /api/locations/:id', () => {
  it('hides an empty location and its children, keeping the rows for History', async () => {
    const longBox = await create('Long box', 'box');
    const lands = await create('Lands', 'box', longBox.id);
    await create('Basics', 'tray', lands.id);
    const after = await create('After', 'box');

    const res = await remove(longBox.id);
    expect(res.status).toBe(204);
    const nodes = await tree();
    expect(names(nodes)).toEqual(['To sort', 'After']);
    expect(nodes.find((node) => node.id === after.id)?.position).toBe(1);

    const rows = db.select().from(locations).all();
    expect(rows).toHaveLength(5);
    expect(
      rows
        .filter((row) => row.deletedAt !== null)
        .map((row) => row.name)
        .sort(),
    ).toEqual(['Basics', 'Lands', 'Long box']);
  });

  it('refuses while it or a child holds copies, with the card count', async () => {
    const longBox = await create('Long box', 'box');
    const lands = await create('Lands', 'box', longBox.id);
    addCopies(lands.id, 1000);
    addCopies(longBox.id, 36);

    const res = await remove(longBox.id);
    expect(res.status).toBe(409);
    expect(LocationNotEmptyError.parse(await res.json())).toEqual({
      error: {
        code: 'location_not_empty',
        message: 'Long box still holds 1,036 cards. Move them first, or send them all to To sort.',
        cardCount: 1036,
      },
    });

    const child = LocationNotEmptyError.parse(await (await remove(lands.id)).json());
    expect(child.error.cardCount).toBe(1000);
    expect(names(await tree())).toEqual(['To sort', 'Long box', 'Lands']);
  });

  it('protects the inbox and a deck’s own deck box, also inside a parent', async () => {
    expect(await errorCode(await remove(inboxId), 400)).toEqual({
      code: 'inbox_protected',
      message: 'To sort is the inbox, so it can’t be renamed or deleted.',
    });

    const deckBox = await create('Hearthhull deck box', 'deck_box');
    addDeck('Hearthhull', deckBox.id);
    expect(await errorCode(await remove(deckBox.id), 400)).toEqual({
      code: 'deck_box_protected',
      message: 'Hearthhull deck box belongs to the Hearthhull deck. Delete the deck to remove it.',
    });

    const shelf = await create('Shelf', 'box');
    const atraxaBox = await create('Atraxa deck box', 'deck_box', shelf.id);
    addDeck('Atraxa', atraxaBox.id);
    expect((await errorCode(await remove(shelf.id), 400)).code).toBe('deck_box_protected');
    expect(names(await tree())).toContain('Shelf');
  });

  it('allows deleting a deck box with no deck', async () => {
    const deckBox = await create('Spare deck box', 'deck_box');
    expect((await remove(deckBox.id)).status).toBe(204);
  });

  it('answers 404 for a location already deleted', async () => {
    const box = await create('Box', 'box');
    expect((await remove(box.id)).status).toBe(204);
    expect((await errorCode(await remove(box.id), 404)).code).toBe('location_not_found');
  });
});
