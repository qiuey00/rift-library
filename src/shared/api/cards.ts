import { z } from 'zod';
import { CardSummary, PrintingSummary } from './common';

// Card search (the search box on every screen) and the card page.
//
//   GET /api/cards/search?q=arcane    → CardSearchResponse
//   GET /api/cards/:oracleId          → CardDetailsResponse; 404 `card_not_found`
//
// What the counts mean, everywhere in this file:
// - owned: the quantities of every copy stack of the card, across all its printings,
//   proxies included.
// - proxies: the owned copies that are proxies.
// - inDecks: the owned copies sitting in deck boxes.
// - free: owned − inDecks.

export const CardSearchQuery = z.object({
  /** Words from the card's name. */
  q: z.string().trim().min(1),
  /** '1' keeps only cards that can be commanders. */
  commander: z.literal('1').optional(),
  /**
   * Keeps only cards whose color identity fits inside this one, such as 'BRG' for a Jund
   * deck: letters from WUBRG, in any order; '' keeps only colorless cards.
   */
  identity: z
    .string()
    .regex(/^[WUBRG]*$/, 'Use the letters W, U, B, R and G')
    .optional(),
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
  /** Scryfall's oracle id for the card. */
  oracleId: z.guid(),
});
export type CardParams = z.infer<typeof CardParams>;

export const CardDetails = CardSummary.extend({
  /** Scryfall's keywords, such as "Partner" or "Station"; the deck checks use them for partners. */
  keywords: z.array(z.string()),
  /** Scryfall's word for the card in Commander: 'legal', 'not_legal' or 'banned'. */
  commanderLegality: z.string(),
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
  /** Every paper printing of the card, newest first. */
  printings: z.array(PrintingSummary),
  counts: CardCounts,
});
export type CardDetailsResponse = z.infer<typeof CardDetailsResponse>;
