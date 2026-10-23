import { Hono } from 'hono';
import { CardParams, CardSearchQuery } from '../../shared/api/cards';
import { getDb } from '../db/database';
import { AppError } from '../errors';
import { cardDetails, searchCards } from '../queries/cards';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const cardsRoutes = new Hono()
  .get('/cards/search', validate('query', CardSearchQuery), (c) => {
    const { q, commander, identity, limit } = c.req.valid('query');
    const results = searchCards(getDb(), { q, commander: commander === '1', identity, limit });
    return c.json({ results });
  })
  .get('/cards/:oracleId', validate('param', CardParams), (c) => {
    const { oracleId } = c.req.valid('param');
    const details = cardDetails(getDb(), oracleId);
    if (!details) {
      throw new AppError(
        404,
        'card_not_found',
        "That card isn't in the card data. If it's new, press Refresh card data in Settings.",
      );
    }
    return c.json(details);
  });
