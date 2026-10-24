import { z } from 'zod';
import { CardSummary, CardType, Domain, IdParam, PrintingSummary } from './common';

// Card search (the search box on every screen) and the card page.
//
//   GET /api/cards?q=jinx       → CardSearchResponse
//   GET /api/cards/:id          → CardDetailsResponse; 404 `card_not_found`
//
// What the counts mean, everywhere in this file:
// - owned: the quantities of every copy stack of the card, across all its printings,
//   proxies included.
// - proxies: the owned copies that are proxies.
// - inDecks: the owned copies sitting in deck boxes.
// - free: owned − inDecks.

export const CardSearchQuery = z.object({
  /**
   * The start of any word of the card's name, or a public code such as "OGN-042",
   * "ogn-42" or "ogn-042/298".
   */
  q: z.string().trim().min(1),
  /** Keeps only cards of this type, such as 'legend' when picking a deck's Legend. */
  type: CardType.optional(),
  /** Keeps only cards with this supertype, such as 'champion', ignoring case. */
  supertype: z.string().trim().min(1).optional(),
  /**
   * Keeps only cards whose domains all fit inside these, comma separated, such as
   * 'fury,chaos' for a Fury and Chaos Legend's deck; cards with no domain always fit.
   */
  domains: z
    .string()
    .transform((text) => (text === '' ? [] : text.split(',')))
    .pipe(z.array(Domain))
    .optional(),
  /** Keeps only cards of this champion, such as 'Jinx', ignoring case. */
  championTag: z.string().trim().min(1).optional(),
  /** '1' keeps only cards a deck can hold, leaving out tokens. */
  deckable: z.literal('1').optional(),
  /** The most results to answer with. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CardSearchQuery = z.infer<typeof CardSearchQuery>;

export const CardSearchResult = CardSummary.extend({
  owned: z.number().int().nonnegative(),
  free: z.number().int().nonnegative(),
});
export type CardSearchResult = z.infer<typeof CardSearchResult>;

export const CardSearchResponse = z.object({
  /** Best match first; empty when nothing matches. */
  results: z.array(CardSearchResult),
});
export type CardSearchResponse = z.infer<typeof CardSearchResponse>;

export const CardParams = z.object({
  /** The card's app id. */
  id: IdParam,
});
export type CardParams = z.infer<typeof CardParams>;

export const CardDetails = CardSummary.extend({
  rulesText: z.string(),
  /** False for tokens and other cards a deck can't hold. */
  deckable: z.boolean(),
});
export type CardDetails = z.infer<typeof CardDetails>;

export const CardCounts = z.object({
  owned: z.number().int().nonnegative(),
  proxies: z.number().int().nonnegative(),
  inDecks: z.number().int().nonnegative(),
  free: z.number().int().nonnegative(),
});
export type CardCounts = z.infer<typeof CardCounts>;

export const CardDetailsResponse = z.object({
  card: CardDetails,
  /** Every printing of the card, by set and collector number. */
  printings: z.array(PrintingSummary),
  counts: CardCounts,
});
export type CardDetailsResponse = z.infer<typeof CardDetailsResponse>;
