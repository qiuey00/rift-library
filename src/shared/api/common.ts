import { z } from 'zod';

// Schemas every area's API uses. Each schema has a type of the same name.

/** App row ids are whole numbers, card ids included. Printing ids are Riftcodex's ids, as strings. */
export const Id = z.number().int().positive();
export type Id = z.infer<typeof Id>;

/** Money is always whole US cents, such as 41280 for $412.80. */
export const Cents = z.number().int().nonnegative();
export type Cents = z.infer<typeof Cents>;

/** An app id taken from a path or query string, where it arrives as text, such as `/decks/:id`. */
export const IdParam = z.coerce.number().int().positive();

export const Finish = z.enum(['normal', 'foil']);
export type Finish = z.infer<typeof Finish>;

export const LocationType = z.enum(['binder', 'box', 'deck_box', 'tray', 'inbox']);
export type LocationType = z.infer<typeof LocationType>;

/**
 * A deck's seven boards. Every board but maybe holds real cards that live in the deck box;
 * rune slots are always available (D-15).
 */
export const Board = z.enum([
  'legend',
  'champion',
  'main',
  'battlefield',
  'rune',
  'sideboard',
  'maybe',
]);
export type Board = z.infer<typeof Board>;

export const SlotStatus = z.enum(['in_box', 'free', 'other_decks', 'missing', 'rune']);
export type SlotStatus = z.infer<typeof SlotStatus>;

/** Riftbound's six domains. */
export const Domain = z.enum(['fury', 'calm', 'mind', 'body', 'chaos', 'order']);
export type Domain = z.infer<typeof Domain>;

/** A card's type, from its first printing that isn't alternate art. */
export const CardType = z.enum([
  'legend',
  'unit',
  'spell',
  'gear',
  'battlefield',
  'rune',
  'token',
  'other',
]);
export type CardType = z.infer<typeof CardType>;

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

/** One card (all its printings), from the card data. */
export const CardSummary = z.object({
  id: Id,
  name: z.string(),
  type: CardType,
  /** Such as "champion", "signature" or "token"; null for none. */
  supertype: z.string().nullable(),
  /** Empty for cards with no domain, such as battlefields. */
  domains: z.array(Domain),
  /** Null for cards without the number, such as battlefields and legends. */
  energy: z.number().int().nullable(),
  might: z.number().int().nullable(),
  power: z.number().int().nullable(),
  /** The champion the card belongs to, such as "Jinx"; null for none. */
  championTag: z.string().nullable(),
  /** The image of its first printing that isn't alternate art; null when there is none. */
  imageUrl: z.string().nullable(),
});
export type CardSummary = z.infer<typeof CardSummary>;

/** One printing's price per finish, in whole cents; null when there is none. */
export const PrintingPrices = z.object({ normal: Cents.nullable(), foil: Cents.nullable() });
export type PrintingPrices = z.infer<typeof PrintingPrices>;

/** One printing of a card, from the card data. */
export const PrintingSummary = z.object({
  /** Riftcodex's id. */
  printingId: z.string(),
  /** Such as "OGN-042/298". */
  publicCode: z.string(),
  /** Such as "OGN". Screens show sets by their code. */
  setCode: z.string(),
  setName: z.string(),
  collectorNumber: z.string(),
  /** Such as "rare". */
  rarity: z.string(),
  imageUrl: z.string().nullable(),
  alternateArt: z.boolean(),
  overnumbered: z.boolean(),
  signature: z.boolean(),
  finishes: z.array(Finish),
  unitPrice: PrintingPrices,
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
  /** The price of one copy in the stack's finish; null when there is none. */
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
