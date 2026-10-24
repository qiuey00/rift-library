import type { BuyItem, BuyList } from '../buy-list';
import { cards, printings } from './deck-cards';

// The buy list with three items, newest first: two of the Jinx Burn deck's missing cards
// and the Ember Signet the decks are short of.

const swiftOx: BuyItem = {
  id: 3,
  card: cards.swiftOx,
  printing: printings.swiftOx,
  quantity: 1,
  note: 'For Jinx Burn',
  createdAt: '2026-10-18T21:52:00Z',
};

const twilightFlare: BuyItem = {
  id: 2,
  card: cards.twilightFlare,
  printing: null,
  quantity: 1,
  note: '',
  createdAt: '2026-10-18T21:51:00Z',
};

const emberSignet: BuyItem = {
  id: 1,
  card: cards.emberSignet,
  printing: null,
  quantity: 1,
  note: '3 decks want it, I own 2',
  createdAt: '2026-10-16T17:20:00Z',
};

/** GET /api/buy-list. */
export const buyListSample: BuyList = {
  items: [swiftOx, twilightFlare, emberSignet],
};

/** POST /api/buy-list and PATCH /api/buy-list/:id. */
export const buyItemSample: BuyItem = swiftOx;
