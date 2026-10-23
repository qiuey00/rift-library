import { z } from 'zod';
import { Board, CardSummary, DeckState, Id } from './common';
import { DeckRef, SlotInput } from './decks';

// Deck checks (Commander rules) and deck demand (decks wanting more copies than Jeff owns).
// They are warnings only: nothing is blocked. Each schema has a type of the same name.

const Count = z.number().int().nonnegative();
const Quantity = z.number().int().positive();

export const DeckWarningKind = z.enum([
  'count',
  'singleton',
  'color_identity',
  'banned',
  'commander',
]);
export type DeckWarningKind = z.infer<typeof DeckWarningKind>;

/** One Commander rule the list breaks. */
export const DeckWarning = z.object({
  kind: DeckWarningKind,
  /** Written for Jeff, such as "Dockside Extortionist is banned in Commander." */
  message: z.string(),
  /** The cards it is about; empty for the card count. */
  cards: z.array(CardSummary),
});
export type DeckWarning = z.infer<typeof DeckWarning>;

/** A card the decks want more copies of than Jeff owns (proxies count as owned). */
export const DemandWarning = z.object({
  card: CardSummary,
  /** Copies the decks' commander and main boards want. */
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

/** GET /api/decks/:id/checks: demand covers this deck's cards. */
export const DeckChecks = z.object({
  warnings: z.array(DeckWarning),
  demand: z.array(DemandWarning),
});
export type DeckChecks = z.infer<typeof DeckChecks>;

/** POST /api/deck-checks: an unsaved list, such as an import preview. */
export const ListToCheck = z.object({ slots: z.array(SlotInput) });
export type ListToCheck = z.infer<typeof ListToCheck>;

/** The answer to POST /api/deck-checks. */
export const ListChecks = z.object({ warnings: z.array(DeckWarning) });
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

/** GET /api/cards/:oracleId/decks: the decks with the card, and its demand warning if it is short. */
export const CardDecks = z.object({
  decks: z.array(CardDeck),
  demand: DemandWarning.nullable(),
});
export type CardDecks = z.infer<typeof CardDecks>;
