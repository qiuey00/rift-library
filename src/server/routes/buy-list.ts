import { Hono } from 'hono';
import { z } from 'zod';
import { BuyItemChange, NewBuyItem, NewBuyItems } from '../../shared/api/buy-list';
import { IdParam } from '../../shared/api/common';
import { getDb } from '../db/database';
import { AppError } from '../errors';
import { buyItem, buyList } from '../queries/buy-list';
import { addToBuyList, changeBuyItem, removeBuyItem } from '../services/buy-list';
import { validate } from '../validate';

const itemParam = validate('param', z.object({ id: IdParam }));

/** The item an action just wrote; it is always there, since the action just wrote it. */
function written(id: number) {
  const item = buyItem(getDb(), id);
  if (!item)
    throw new AppError(404, 'buy_item_not_found', 'That card is no longer on the buy list.');
  return item;
}

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const buyListRoutes = new Hono()
  .get('/buy-list', (c) => c.json({ items: buyList(getDb()) }))
  .post('/buy-list', validate('json', NewBuyItem), (c) => {
    const [id] = addToBuyList(getDb(), [c.req.valid('json')]);
    return c.json(written(id), 201);
  })
  .post('/buy-list/bulk', validate('json', NewBuyItems), (c) => {
    addToBuyList(getDb(), c.req.valid('json').items);
    return c.json({ items: buyList(getDb()) }, 201);
  })
  .patch('/buy-list/:id', itemParam, validate('json', BuyItemChange), (c) => {
    const { id } = c.req.valid('param');
    changeBuyItem(getDb(), id, c.req.valid('json'));
    return c.json(written(id));
  })
  .delete('/buy-list/:id', itemParam, (c) => {
    removeBuyItem(getDb(), c.req.valid('param').id);
    return c.body(null, 204);
  });
