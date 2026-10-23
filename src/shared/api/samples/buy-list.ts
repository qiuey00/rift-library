import type { BuyItem, BuyList } from '../buy-list';
import { cards, printings } from './deck-cards';

// The buy list with three items, newest first: two of the Hearthhull deck's missing cards
// and the Arcane Signet the decks are short of.

const soulOfWindgrace: BuyItem = {
  id: 3,
  card: cards.soulOfWindgrace,
  printing: printings.soulOfWindgrace,
  quantity: 1,
  note: 'For Hearthhull',
  createdAt: '2026-10-18T21:52:00Z',
};

const splendidReclamation: BuyItem = {
  id: 2,
  card: cards.splendidReclamation,
  printing: null,
  quantity: 1,
  note: '',
  createdAt: '2026-10-18T21:51:00Z',
};

const arcaneSignet: BuyItem = {
  id: 1,
  card: cards.arcaneSignet,
  printing: null,
  quantity: 1,
  note: '3 decks want it, I own 2',
  createdAt: '2026-10-16T17:20:00Z',
};

/** GET /api/buy-list. */
export const buyListSample: BuyList = {
  items: [soulOfWindgrace, splendidReclamation, arcaneSignet],
};

/** POST /api/buy-list and PATCH /api/buy-list/:id. */
export const buyItemSample: BuyItem = soulOfWindgrace;
