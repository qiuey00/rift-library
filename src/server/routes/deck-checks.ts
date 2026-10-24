import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { IdParam } from '../../shared/api/common';
import type { CardDecks, DeckChecks, ListChecks } from '../../shared/api/deck-checks';
import { ListToCheck } from '../../shared/api/deck-checks';
import { getDb } from '../db/database';
import { cards, deckSlots } from '../db/schema';
import { AppError } from '../errors';
import { checkList } from '../queries/deck-checks';
import { findDeck } from '../queries/decks';
import { cardDecks, demandWarnings } from '../queries/demand';
import { validate } from '../validate';

// Mounted at /api in src/server/app.ts. Chain each route onto this instance, as in
// `new Hono().get(...).post(...)`, so the typed client in src/client/api.ts sees it.
export const deckChecksRoutes = new Hono()
  .get('/decks/:id/checks', validate('param', z.object({ id: IdParam })), (c) => {
    const db = getDb();
    const { id } = c.req.valid('param');
    if (!findDeck(db, id)) {
      throw new AppError(404, 'deck_not_found', 'This deck was deleted or doesn’t exist.');
    }
    const slots = db
      .select({
        cardId: deckSlots.cardId,
        board: deckSlots.board,
        quantity: deckSlots.quantity,
      })
      .from(deckSlots)
      .where(eq(deckSlots.deckId, id))
      .orderBy(deckSlots.id)
      .all();
    const demand = demandWarnings(
      db,
      slots.filter((slot) => slot.board !== 'maybe').map((slot) => slot.cardId),
    );
    const answer: DeckChecks = { checks: checkList(db, slots), demand: [...demand.values()] };
    return c.json(answer);
  })
  .post('/deck-checks', validate('json', ListToCheck), (c) => {
    const answer: ListChecks = { checks: checkList(getDb(), c.req.valid('json').slots) };
    return c.json(answer);
  })
  .get('/cards/:id/decks', validate('param', z.object({ id: IdParam })), (c) => {
    const db = getDb();
    const { id } = c.req.valid('param');
    const card = db.select({ id: cards.id }).from(cards).where(eq(cards.id, id)).get();
    if (!card) {
      throw new AppError(404, 'card_not_found', 'This card isn’t in the card data.');
    }
    const answer: CardDecks = {
      decks: cardDecks(db, id),
      demand: demandWarnings(db, [id]).get(id) ?? null,
    };
    return c.json(answer);
  });
