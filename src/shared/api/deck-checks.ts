import { z } from 'zod';
import { Board, CardSummary, DeckState, Id } from './common';
import { DeckRef, SlotInput } from './decks';

// Deck checks (Riftbound's deck rules) and deck demand (decks wanting more copies than Jeff owns).
// They are warnings only: nothing is blocked. Each schema has a type of the same name.

const Count = z.number().int().nonnegative();
const Quantity = z.number().int().positive();

/**
 * The Riftbound deck rules the checks look at (DECK-6), one check each:
 * - `legend`: exactly one Legend.
 * - `champion`: one Chosen Champion, a champion unit with the Legend's champion tag.
 * - `main_count`: at least 40 main deck cards, the Chosen Champion included.
 * - `copies`: at most 3 copies of a card by name, across every printing, on the champion, main
 *   and sideboard boards together.
 * - `signature`: at most 3 signature cards in the main deck, and every signature card (sideboard
 *   too) with the Legend's champion tag.
 * - `domains`: every champion, main deck, battlefield, rune and sideboard card within the
 *   Legend's domains.
 * - `runes`: 12 runes.
 * - `battlefields`: 3 battlefields, with different names.
 * - `sideboard`: at most 10 sideboard cards (D-42).
 * - `deckable`: no tokens or other cards a deck can't hold, on any board but maybe.
 */
export const DeckCheckCode = z.enum([
  'legend',
  'champion',
  'main_count',
  'copies',
  'signature',
  'domains',
  'runes',
  'battlefields',
  'sideboard',
  'deckable',
]);
export type DeckCheckCode = z.infer<typeof DeckCheckCode>;

/** Whether the list keeps the rule. A warning never blocks anything (D-17). */
export const DeckCheckResult = z.enum(['pass', 'warn']);
export type DeckCheckResult = z.infer<typeof DeckCheckResult>;

/** One deck rule and how the list does against it. */
export const DeckCheck = z.object({
  code: DeckCheckCode,
  result: DeckCheckResult,
  /**
   * Written for Jeff, such as "The main deck has 38 cards; it needs at least 40." for a warning
   * or "The main deck has 40 cards." for a pass.
   */
  message: z.string(),
  /** The cards a warning is about, such as the ones outside the Legend's domains; empty for a pass. */
  cards: z.array(CardSummary),
});
export type DeckCheck = z.infer<typeof DeckCheck>;

/** A card the decks want more copies of than Jeff owns (proxies count as owned). */
export const DemandWarning = z.object({
  card: CardSummary,
  /** Copies the decks' legend, champion, main, battlefield and sideboard boards want. */
  demand: Quantity,
  owned: Count,
  /** demand minus owned, above zero. */
  shortage: Quantity,
  /** The decks that want it. */
  decks: z.array(DeckRef),
  /** Such as "3 decks want Arcane Signet, you own 2". */
  message: z.string(),
});
export type DemandWarning = z.infer<typeof DemandWarning>;

/** GET /api/decks/:id/checks: a check per rule in `DeckCheckCode` order; demand covers this deck's cards. */
export const DeckChecks = z.object({
  checks: z.array(DeckCheck),
  demand: z.array(DemandWarning),
});
export type DeckChecks = z.infer<typeof DeckChecks>;

/** POST /api/deck-checks: an unsaved list, such as an import preview. */
export const ListToCheck = z.object({ slots: z.array(SlotInput) });
export type ListToCheck = z.infer<typeof ListToCheck>;

/** The answer to POST /api/deck-checks. */
export const ListChecks = z.object({ checks: z.array(DeckCheck) });
export type ListChecks = z.infer<typeof ListChecks>;

/** One deck slot holding a card. A deck appears once per board that has the card. */
export const CardDeck = z.object({
  id: Id,
  name: z.string(),
  state: DeckState,
  board: Board,
  quantity: Quantity,
});
export type CardDeck = z.infer<typeof CardDeck>;

/** GET /api/cards/:id/decks: the decks with the card, and its demand warning if it is short. */
export const CardDecks = z.object({
  decks: z.array(CardDeck),
  demand: DemandWarning.nullable(),
});
export type CardDecks = z.infer<typeof CardDecks>;
