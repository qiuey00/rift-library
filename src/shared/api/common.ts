import { z } from 'zod';

// Schemas every area's API uses. Each schema has a type of the same name.

/** App row ids are whole numbers. Scryfall ids (oracle ids, printing ids) are strings. */
export const Id = z.number().int().positive();
export type Id = z.infer<typeof Id>;

/** Money is always whole US cents, such as 41280 for $412.80. */
export const Cents = z.number().int().nonnegative();
export type Cents = z.infer<typeof Cents>;

/** An app id taken from a path or query string, where it arrives as text, such as `/decks/:id`. */
export const IdParam = z.coerce.number().int().positive();

export const Finish = z.enum(['nonfoil', 'foil', 'etched']);
export type Finish = z.infer<typeof Finish>;

export const LocationType = z.enum(['binder', 'box', 'deck_box', 'tray', 'inbox']);
export type LocationType = z.infer<typeof LocationType>;

export const Board = z.enum(['commander', 'main', 'maybe']);
export type Board = z.infer<typeof Board>;

export const SlotStatus = z.enum(['in_box', 'free', 'other_decks', 'missing', 'basic']);
export type SlotStatus = z.infer<typeof SlotStatus>;

export const DeckState = z.enum(['not_assembled', 'partly_assembled', 'assembled']);
export type DeckState = z.infer<typeof DeckState>;

/** Every error answer: an HTTP status plus this body. The message is written for Jeff to read. */
export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/** One card (all its printings), from Scryfall's card data. */
export const CardSummary = z.object({
  oracleId: z.string(),
  /** The full "Front // Back" name for double-faced cards. */
  name: z.string(),
  frontFaceName: z.string(),
  manaCost: z.string(),
  manaValue: z.number(),
  typeLine: z.string(),
  /** Such as "BRG"; "" for colorless. */
  colorIdentity: z.string(),
  imageSmall: z.string().nullable(),
  imageNormal: z.string().nullable(),
  canBeCommander: z.boolean(),
  isBasicLand: z.boolean(),
});
export type CardSummary = z.infer<typeof CardSummary>;

/** One printing of a card, from Scryfall's card data. */
export const PrintingSummary = z.object({
  scryfallId: z.string(),
  oracleId: z.string(),
  setCode: z.string(),
  setName: z.string(),
  collectorNumber: z.string(),
  lang: z.string(),
  finishes: z.array(Finish),
  rarity: z.string(),
  imageSmall: z.string().nullable(),
  imageNormal: z.string().nullable(),
});
export type PrintingSummary = z.infer<typeof PrintingSummary>;

export const LocationRef = z.object({
  id: Id,
  name: z.string(),
  type: LocationType,
  /** Such as "Long box › Lands". */
  path: z.string(),
  /** The effective color, inherited from the parent when the location has none of its own. */
  color: z.string().nullable(),
  /** Marked For trade itself, or inside a location that is. */
  forTrade: z.boolean(),
});
export type LocationRef = z.infer<typeof LocationRef>;

/** What tells copies of one printing apart. */
export const CopyDetails = z.object({
  finish: Finish,
  /** Such as "near_mint". */
  condition: z.string(),
  /** Such as "en". */
  language: z.string(),
  misprint: z.boolean(),
  altered: z.boolean(),
  isProxy: z.boolean(),
});
export type CopyDetails = z.infer<typeof CopyDetails>;

/** One copy stack: alike copies in one location. */
export const StackRow = z.object({
  stackId: Id,
  quantity: z.number().int().positive(),
  card: CardSummary,
  printing: PrintingSummary,
  ...CopyDetails.shape,
  location: LocationRef,
  /** Where copies in a deck box go back to; null outside deck boxes and for added proxies. */
  cameFrom: LocationRef.nullable(),
  inDeck: z.object({ deckId: Id, deckName: z.string() }).nullable(),
  /** Scryfall's price for one copy in the stack's finish; null when it has none. */
  unitPrice: Cents.nullable(),
  /** quantity × unitPrice; 0 for proxies and stacks with no price. */
  value: Cents,
});
export type StackRow = z.infer<typeof StackRow>;

/** The answer to an action that moves copies. */
export const ActionResult = z.object({
  /** Shown in the undo bar, such as "Moved 3 cards to Long box". */
  message: z.string(),
  /** The movement batch the undo bar undoes; null when nothing can be undone. */
  batchId: Id.nullable(),
});
export type ActionResult = z.infer<typeof ActionResult>;
