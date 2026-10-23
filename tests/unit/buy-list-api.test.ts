import { hc } from 'hono/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { type AppType, app } from '../../src/server/app';
import type { OpenDb } from '../../src/server/db/database';
import { setDb } from '../../src/server/db/database';
import { buyListItems, cards, printings } from '../../src/server/db/schema';
import { createTestDb } from '../../src/server/db/test-db';
import { BuyItem, BuyList } from '../../src/shared/api/buy-list';
import { ErrorBody } from '../../src/shared/api/common';

// The same typed client the screens use (src/client/api.ts), answered by the app in memory.
const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

const signet = 'oracle-arcane-signet';
const sol = 'oracle-sol-ring';
const signetCmm = 'print-signet-cmm';
const signetM3c = 'print-signet-m3c';
const solCmm = 'print-sol-cmm';

let db: OpenDb;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  db.insert(cards)
    .values([
      {
        oracleId: signet,
        name: 'Arcane Signet',
        frontFaceName: 'Arcane Signet',
        typeLine: 'Artifact',
        manaCost: '{2}',
        manaValue: 2,
        commanderLegality: 'legal',
      },
      {
        oracleId: sol,
        name: 'Sol Ring',
        frontFaceName: 'Sol Ring',
        typeLine: 'Artifact',
        manaCost: '{1}',
        manaValue: 1,
        commanderLegality: 'legal',
      },
    ])
    .run();
  const printing = {
    lang: 'en',
    finishes: ['nonfoil' as const],
    rarity: 'common',
  };
  db.insert(printings)
    .values([
      {
        ...printing,
        scryfallId: signetCmm,
        oracleId: signet,
        setCode: 'cmm',
        setName: 'Commander Masters',
        collectorNumber: '367',
        releasedAt: '2023-08-04',
        imageSmall: 'cmm-small.jpg',
        imageNormal: 'cmm-normal.jpg',
      },
      {
        ...printing,
        scryfallId: signetM3c,
        oracleId: signet,
        setCode: 'm3c',
        setName: 'Modern Horizons 3 Commander',
        collectorNumber: '279',
        releasedAt: '2024-06-14',
        imageSmall: 'm3c-small.jpg',
        imageNormal: 'm3c-normal.jpg',
      },
      {
        ...printing,
        scryfallId: solCmm,
        oracleId: sol,
        setCode: 'cmm',
        setName: 'Commander Masters',
        collectorNumber: '400',
        releasedAt: '2023-08-04',
        rarity: 'uncommon',
      },
    ])
    .run();
});

async function body<T extends z.ZodType>(res: Response, schema: T, status = 200) {
  expect(res.status).toBe(status);
  return schema.parse(await res.json());
}

async function add(json: {
  oracleId: string;
  scryfallId?: string;
  quantity: number;
  note?: string;
}) {
  return body(await api['buy-list'].$post({ json }), BuyItem, 201);
}

async function list() {
  return (await body(await api['buy-list'].$get(), BuyList)).items;
}

describe('buy list', () => {
  it('starts empty', async () => {
    expect(await list()).toEqual([]);
  });

  it('adds a card for any printing, with its card and the newest printing’s picture', async () => {
    const item = await add({ oracleId: signet, quantity: 2, note: 'For Hearthhull' });
    expect(item).toMatchObject({
      card: { oracleId: signet, name: 'Arcane Signet', imageSmall: 'm3c-small.jpg' },
      printing: null,
      quantity: 2,
      note: 'For Hearthhull',
    });
    expect(item.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(await list()).toEqual([item]);
  });

  it('adds a card with a wanted printing, showing that printing’s picture', async () => {
    const item = await add({ oracleId: signet, scryfallId: signetCmm, quantity: 1 });
    expect(item.printing).toMatchObject({ scryfallId: signetCmm, setCode: 'cmm' });
    expect(item.card.imageSmall).toBe('cmm-small.jpg');
    expect(item.note).toBe('');
  });

  it('raises the quantity when the same card and printing is added again', async () => {
    const first = await add({ oracleId: signet, scryfallId: signetCmm, quantity: 1, note: 'Old' });
    const again = await add({ oracleId: signet, scryfallId: signetCmm, quantity: 2, note: 'New' });
    expect(again.id).toBe(first.id);
    expect(again.quantity).toBe(3);
    expect(again.note).toBe('New');

    // An empty note keeps the old one.
    const blank = await add({ oracleId: signet, scryfallId: signetCmm, quantity: 1, note: ' ' });
    expect(blank).toMatchObject({ quantity: 4, note: 'New' });
    expect(await list()).toHaveLength(1);
  });

  it('merges on "any printing" too, apart from items with a wanted printing', async () => {
    const any = await add({ oracleId: signet, quantity: 1 });
    const again = await add({ oracleId: signet, quantity: 1 });
    expect(again).toMatchObject({ id: any.id, quantity: 2 });

    const cmm = await add({ oracleId: signet, scryfallId: signetCmm, quantity: 1 });
    const m3c = await add({ oracleId: signet, scryfallId: signetM3c, quantity: 1 });
    expect(new Set([any.id, cmm.id, m3c.id]).size).toBe(3);
    expect(await list()).toHaveLength(3);
  });

  it('lists the newest items first', async () => {
    const older = await add({ oracleId: sol, quantity: 1 });
    db.update(buyListItems).set({ createdAt: '2026-10-01T10:00:00.000Z' }).run();
    const newer = await add({ oracleId: signet, quantity: 1 });
    expect((await list()).map((item) => item.id)).toEqual([newer.id, older.id]);
    expect((await list())[1].createdAt).toBe('2026-10-01T10:00:00Z');
  });

  it('adds several cards at once and answers with the whole list', async () => {
    await add({ oracleId: sol, quantity: 1 });
    const res = await api['buy-list'].bulk.$post({
      json: {
        items: [
          { oracleId: signet, quantity: 1, note: 'For Hearthhull' },
          { oracleId: sol, quantity: 2 },
          { oracleId: signet, quantity: 1 },
        ],
      },
    });
    const { items } = await body(res, BuyList, 201);
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.card.oracleId === signet)).toMatchObject({
      quantity: 2,
      note: 'For Hearthhull',
    });
    expect(items.find((item) => item.card.oracleId === sol)?.quantity).toBe(3);
  });

  it('adds nothing from a bulk add when one card is wrong', async () => {
    const res = await api['buy-list'].bulk.$post({
      json: {
        items: [
          { oracleId: signet, quantity: 1 },
          { oracleId: 'no-such-card', quantity: 1 },
        ],
      },
    });
    expect((await body(res, ErrorBody, 400)).error.code).toBe('card_not_found');
    expect(await list()).toEqual([]);

    const none = await api['buy-list'].bulk.$post({ json: { items: [] } });
    expect((await body(none, ErrorBody, 400)).error.code).toBe('invalid_request');
  });

  it('refuses a printing of another card', async () => {
    const res = await api['buy-list'].$post({
      json: { oracleId: signet, scryfallId: solCmm, quantity: 1 },
    });
    expect((await body(res, ErrorBody, 400)).error.code).toBe('printing_not_found');
  });

  it('refuses a quantity of 0 when adding or editing', async () => {
    const res = await api['buy-list'].$post({ json: { oracleId: signet, quantity: 0 } });
    expect((await body(res, ErrorBody, 400)).error.code).toBe('invalid_request');

    const item = await add({ oracleId: signet, quantity: 1 });
    const edit = await api['buy-list'][':id'].$patch({
      param: { id: String(item.id) },
      json: { quantity: 0 },
    });
    expect((await body(edit, ErrorBody, 400)).error.code).toBe('invalid_request');
    expect((await list())[0].quantity).toBe(1);
  });

  it('edits the quantity and the note', async () => {
    const item = await add({ oracleId: signet, quantity: 1, note: 'For Hearthhull' });
    const param = { id: String(item.id) };

    const quantity = await api['buy-list'][':id'].$patch({ param, json: { quantity: 3 } });
    expect(await body(quantity, BuyItem)).toMatchObject({ quantity: 3, note: 'For Hearthhull' });

    const note = await api['buy-list'][':id'].$patch({ param, json: { note: '' } });
    expect(await body(note, BuyItem)).toMatchObject({ quantity: 3, note: '' });

    const empty = await api['buy-list'][':id'].$patch({ param, json: {} });
    expect((await body(empty, ErrorBody, 400)).error.code).toBe('invalid_request');
  });

  it('removes an item', async () => {
    const item = await add({ oracleId: signet, quantity: 1 });
    await add({ oracleId: sol, quantity: 1 });
    const res = await api['buy-list'][':id'].$delete({ param: { id: String(item.id) } });
    expect(res.status).toBe(204);
    expect((await list()).map((row) => row.card.oracleId)).toEqual([sol]);
  });

  it('answers 404 for an item that is gone', async () => {
    const param = { id: '99' };
    const edit = await api['buy-list'][':id'].$patch({ param, json: { quantity: 2 } });
    expect((await body(edit, ErrorBody, 404)).error.code).toBe('buy_item_not_found');
    const remove = await api['buy-list'][':id'].$delete({ param });
    expect((await body(remove, ErrorBody, 404)).error.code).toBe('buy_item_not_found');
  });
});
