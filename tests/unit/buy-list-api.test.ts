import { hc } from 'hono/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { type AppType, app } from '../../src/server/app';
import type { OpenDb } from '../../src/server/db/database';
import { setDb } from '../../src/server/db/database';
import { buyListItems } from '../../src/server/db/schema';
import { createTestDb, insertCard, insertPrinting } from '../../src/server/db/test-db';
import { BuyItem, BuyList } from '../../src/shared/api/buy-list';
import { ErrorBody } from '../../src/shared/api/common';

// The same typed client the screens use (src/client/api.ts), answered by the app in memory.
const api = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
}).api;

const signet = 1;
const sol = 2;
const signetCmm = 'print-signet-cmm';
const signetM3c = 'print-signet-m3c';
const solCmm = 'print-sol-cmm';

let db: OpenDb;

beforeEach(() => {
  db = createTestDb();
  setDb(db);
  insertCard(db, { id: signet, name: 'Ember Signet', energy: 2 });
  insertCard(db, { id: sol, name: 'Sun Disc', energy: 1 });
  const printing = { finishes: ['normal' as const], setCode: 'VEN', setName: 'Vendetta' };
  insertPrinting(db, {
    ...printing,
    riftcodexId: signetCmm,
    cardId: signet,
    collectorNumber: '367',
    imageUrl: 'cmm.webp',
  });
  insertPrinting(db, {
    ...printing,
    riftcodexId: signetM3c,
    cardId: signet,
    setCode: 'SPP',
    setName: 'Store Promos',
    collectorNumber: '279',
    imageUrl: 'm3c.webp',
  });
  insertPrinting(db, { ...printing, riftcodexId: solCmm, cardId: sol, collectorNumber: '400' });
});

async function body<T extends z.ZodType>(res: Response, schema: T, status = 200) {
  expect(res.status).toBe(status);
  return schema.parse(await res.json());
}

async function add(json: { cardId: number; printingId?: string; quantity: number; note?: string }) {
  return body(await api['buy-list'].$post({ json }), BuyItem, 201);
}

async function list() {
  return (await body(await api['buy-list'].$get(), BuyList)).items;
}

describe('buy list', () => {
  it('starts empty', async () => {
    expect(await list()).toEqual([]);
  });

  it('adds a card for any printing, with its card and its first printing’s picture', async () => {
    const item = await add({ cardId: signet, quantity: 2, note: 'For Jinx Burn' });
    expect(item).toMatchObject({
      card: { id: signet, name: 'Ember Signet', imageUrl: 'm3c.webp' },
      printing: null,
      quantity: 2,
      note: 'For Jinx Burn',
    });
    expect(item.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(await list()).toEqual([item]);
  });

  it('adds a card with a wanted printing, showing that printing’s picture', async () => {
    const item = await add({ cardId: signet, printingId: signetCmm, quantity: 1 });
    expect(item.printing).toMatchObject({ printingId: signetCmm, setCode: 'VEN' });
    expect(item.card.imageUrl).toBe('cmm.webp');
    expect(item.note).toBe('');
  });

  it('raises the quantity when the same card and printing is added again', async () => {
    const first = await add({ cardId: signet, printingId: signetCmm, quantity: 1, note: 'Old' });
    const again = await add({ cardId: signet, printingId: signetCmm, quantity: 2, note: 'New' });
    expect(again.id).toBe(first.id);
    expect(again.quantity).toBe(3);
    expect(again.note).toBe('New');

    // An empty note keeps the old one.
    const blank = await add({ cardId: signet, printingId: signetCmm, quantity: 1, note: ' ' });
    expect(blank).toMatchObject({ quantity: 4, note: 'New' });
    expect(await list()).toHaveLength(1);
  });

  it('merges on "any printing" too, apart from items with a wanted printing', async () => {
    const any = await add({ cardId: signet, quantity: 1 });
    const again = await add({ cardId: signet, quantity: 1 });
    expect(again).toMatchObject({ id: any.id, quantity: 2 });

    const cmm = await add({ cardId: signet, printingId: signetCmm, quantity: 1 });
    const m3c = await add({ cardId: signet, printingId: signetM3c, quantity: 1 });
    expect(new Set([any.id, cmm.id, m3c.id]).size).toBe(3);
    expect(await list()).toHaveLength(3);
  });

  it('lists the newest items first', async () => {
    const older = await add({ cardId: sol, quantity: 1 });
    db.update(buyListItems).set({ createdAt: '2026-10-01T10:00:00.000Z' }).run();
    const newer = await add({ cardId: signet, quantity: 1 });
    expect((await list()).map((item) => item.id)).toEqual([newer.id, older.id]);
    expect((await list())[1].createdAt).toBe('2026-10-01T10:00:00Z');
  });

  it('adds several cards at once and answers with the whole list', async () => {
    await add({ cardId: sol, quantity: 1 });
    const res = await api['buy-list'].bulk.$post({
      json: {
        items: [
          { cardId: signet, quantity: 1, note: 'For Jinx Burn' },
          { cardId: sol, quantity: 2 },
          { cardId: signet, quantity: 1 },
        ],
      },
    });
    const { items } = await body(res, BuyList, 201);
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.card.id === signet)).toMatchObject({
      quantity: 2,
      note: 'For Jinx Burn',
    });
    expect(items.find((item) => item.card.id === sol)?.quantity).toBe(3);
  });

  it('adds nothing from a bulk add when one card is wrong', async () => {
    const res = await api['buy-list'].bulk.$post({
      json: {
        items: [
          { cardId: signet, quantity: 1 },
          { cardId: 999, quantity: 1 },
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
      json: { cardId: signet, printingId: solCmm, quantity: 1 },
    });
    expect((await body(res, ErrorBody, 400)).error.code).toBe('printing_not_found');
  });

  it('refuses a quantity of 0 when adding or editing', async () => {
    const res = await api['buy-list'].$post({ json: { cardId: signet, quantity: 0 } });
    expect((await body(res, ErrorBody, 400)).error.code).toBe('invalid_request');

    const item = await add({ cardId: signet, quantity: 1 });
    const edit = await api['buy-list'][':id'].$patch({
      param: { id: String(item.id) },
      json: { quantity: 0 },
    });
    expect((await body(edit, ErrorBody, 400)).error.code).toBe('invalid_request');
    expect((await list())[0].quantity).toBe(1);
  });

  it('edits the quantity and the note', async () => {
    const item = await add({ cardId: signet, quantity: 1, note: 'For Jinx Burn' });
    const param = { id: String(item.id) };

    const quantity = await api['buy-list'][':id'].$patch({ param, json: { quantity: 3 } });
    expect(await body(quantity, BuyItem)).toMatchObject({ quantity: 3, note: 'For Jinx Burn' });

    const note = await api['buy-list'][':id'].$patch({ param, json: { note: '' } });
    expect(await body(note, BuyItem)).toMatchObject({ quantity: 3, note: '' });

    const empty = await api['buy-list'][':id'].$patch({ param, json: {} });
    expect((await body(empty, ErrorBody, 400)).error.code).toBe('invalid_request');
  });

  it('removes an item', async () => {
    const item = await add({ cardId: signet, quantity: 1 });
    await add({ cardId: sol, quantity: 1 });
    const res = await api['buy-list'][':id'].$delete({ param: { id: String(item.id) } });
    expect(res.status).toBe(204);
    expect((await list()).map((row) => row.card.id)).toEqual([sol]);
  });

  it('answers 404 for an item that is gone', async () => {
    const param = { id: '99' };
    const edit = await api['buy-list'][':id'].$patch({ param, json: { quantity: 2 } });
    expect((await body(edit, ErrorBody, 404)).error.code).toBe('buy_item_not_found');
    const remove = await api['buy-list'][':id'].$delete({ param });
    expect((await body(remove, ErrorBody, 404)).error.code).toBe('buy_item_not_found');
  });
});
