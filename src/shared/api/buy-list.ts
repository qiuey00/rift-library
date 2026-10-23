import { z } from 'zod';
import { CardSummary, Id, PrintingSummary } from './common';

// The one buy list. Only Jeff adds cards to it; deck shortages never add them on their own.
// Each schema has a type of the same name.

const Quantity = z.number().int().positive();

export const BuyItem = z.object({
  id: Id,
  card: CardSummary,
  /** Null when any printing will do. */
  printing: PrintingSummary.nullable(),
  quantity: Quantity,
  /** "" when there is no note. */
  note: z.string(),
  /** UTC, such as "2026-10-18T21:40:00Z". */
  createdAt: z.iso.datetime(),
});
export type BuyItem = z.infer<typeof BuyItem>;

/** GET /api/buy-list: newest first. */
export const BuyList = z.object({ items: z.array(BuyItem) });
export type BuyList = z.infer<typeof BuyList>;

/** POST /api/buy-list. The same card and printing again raises that item's quantity. */
export const NewBuyItem = z.object({
  oracleId: z.string().min(1),
  /** Leave out when any printing will do. */
  printingId: z.string().min(1).optional(),
  quantity: Quantity,
  note: z.string().optional(),
});
export type NewBuyItem = z.infer<typeof NewBuyItem>;

/** POST /api/buy-list/bulk, such as every missing card from a pick list. */
export const NewBuyItems = z.object({ items: z.array(NewBuyItem).min(1, 'Add at least one card') });
export type NewBuyItems = z.infer<typeof NewBuyItems>;

/** PATCH /api/buy-list/:id. */
export const BuyItemChange = z
  .object({ quantity: Quantity.optional(), note: z.string().optional() })
  .refine((change) => change.quantity !== undefined || change.note !== undefined, {
    message: 'Send a quantity, a note or both',
  });
export type BuyItemChange = z.infer<typeof BuyItemChange>;
