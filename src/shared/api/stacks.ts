import { z } from 'zod';
import { Cents, IdParam, StackRow } from './common';
import { LocationNode } from './locations';

// The stacks area: lists of copy stacks for the Collection screen, a location's contents and
// a card's copies. Routes in src/server/routes/stacks.ts.

/**
 * GET /api/stacks query. `q` is the search text read by `parseCollectionQuery` in
 * src/shared/collection-query.ts; a term it can't use answers 400 `invalid_query` with that
 * term's message.
 */
export const StacksQuery = z.object({
  q: z.string().optional(),
  /**
   * `name` (the default): card name, then set, then collector number. `value` goes highest
   * first and `recent` newest first; `location` follows the location tree and `set` the set code.
   */
  sort: z.enum(['name', 'value', 'location', 'set', 'recent']).default('name'),
  /** The `nextCursor` of the page before. */
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});
export type StacksQuery = z.infer<typeof StacksQuery>;

/** GET /api/stacks: one page of copy stacks. */
export const StacksPage = z.object({
  rows: z.array(StackRow),
  /** For every stack the search matches, not only this page. */
  total: z.object({
    stacks: z.number().int().nonnegative(),
    /** Stack quantities added up, proxies included. */
    cards: z.number().int().nonnegative(),
    proxies: z.number().int().nonnegative(),
    /** What the matched non-proxy copies are worth. */
    value: Cents,
    /** Matched non-proxy cards with no price. */
    noPriceCount: z.number().int().nonnegative(),
  }),
  /** Send as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type StacksPage = z.infer<typeof StacksPage>;

/** GET /api/collection/value: the whole collection, deck boxes included. */
export const CollectionValue = z.object({
  /** What every non-proxy copy is worth. */
  value: Cents,
  /** Copies, proxies included. */
  cards: z.number().int().nonnegative(),
  /** Non-proxy cards with no price. */
  noPriceCount: z.number().int().nonnegative(),
  proxies: z.number().int().nonnegative(),
  /** When the loaded card data file (its prices) was made; null before the first load. */
  pricesUpdatedAt: z.iso.datetime().nullable(),
});
export type CollectionValue = z.infer<typeof CollectionValue>;

/** GET /api/locations/:id/stacks query. */
export const LocationStacksQuery = z.object({
  /** '1' also lists the stacks in its child locations. */
  includeChildren: z.enum(['0', '1']).optional(),
});
export type LocationStacksQuery = z.infer<typeof LocationStacksQuery>;

/**
 * GET /api/locations/:id/stacks: the location (as in the tree), its stacks, and the stacks out
 * in decks from it.
 */
export const LocationStacks = z.object({
  location: LocationNode,
  rows: z.array(StackRow),
  /**
   * Stacks in deck boxes whose came-from location is this location or one inside it, whatever
   * `includeChildren` says. Each row's `inDeck` names its deck.
   */
  outInDecks: z.array(StackRow),
});
export type LocationStacks = z.infer<typeof LocationStacks>;

/** `:id` in /api/cards/:id/copies: a card's id. */
export const CardIdParams = z.object({ id: IdParam });

/** How many copies of a card there are. */
export const CopyCounts = z.object({
  /** Stack quantities across every printing, proxies included. */
  owned: z.number().int().nonnegative(),
  proxies: z.number().int().nonnegative(),
  /** Owned copies sitting in deck boxes. */
  inDecks: z.number().int().nonnegative(),
  /** owned − inDecks. */
  free: z.number().int().nonnegative(),
});
export type CopyCounts = z.infer<typeof CopyCounts>;

/** GET /api/cards/:id/copies: every stack of any printing of the card. */
export const CardCopies = z.object({
  rows: z.array(StackRow),
  counts: CopyCounts,
});
export type CardCopies = z.infer<typeof CardCopies>;
