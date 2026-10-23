import { z } from 'zod';
import { CardSummary, Id, IdParam, LocationRef, PrintingSummary } from './common';
import { DeckRef } from './decks';

// The history area: every movement, one day at a time. Routes in src/server/routes/history.ts.

/** Why copies moved. */
export const MovementReason = z.enum([
  'imported',
  'added',
  'moved',
  /** Pulled into a deck box from a pick list. */
  'assembled',
  /** Put back from a deck box with the put-away list. */
  'returned',
  'swapped_out',
  'swapped_in',
  /** Changed by an update import of a location. */
  'location_update',
  'undo',
]);
export type MovementReason = z.infer<typeof MovementReason>;

/** One movement: copies of one stack changing location. Times are UTC, such as "2026-10-18T19:02:11Z". */
export const MovementRow = z.object({
  id: Id,
  createdAt: z.iso.datetime(),
  card: CardSummary,
  printing: PrintingSummary,
  quantity: z.number().int().positive(),
  /** null for imported and added copies. Deleted locations are still named. */
  from: LocationRef.nullable(),
  /** null when an update import removed the copies. */
  to: LocationRef.nullable(),
  reason: MovementReason,
  deck: DeckRef.nullable(),
  /** When it was undone; null while it stands. */
  undoneAt: z.iso.datetime().nullable(),
});
export type MovementRow = z.infer<typeof MovementRow>;

export const BatchKind = z.enum(['import', 'pick_list', 'put_away', 'swap', 'move', 'add', 'undo']);
export type BatchKind = z.infer<typeof BatchKind>;

/** The movements of one action shown as one entry that expands. */
export const HistoryBatch = z.object({
  id: Id,
  kind: BatchKind,
  /** Such as "Imported 389 cards" or "Pick list · Hearthhull · 12 cards". */
  summary: z.string(),
  deck: DeckRef.nullable(),
  createdAt: z.iso.datetime(),
  /** True when every movement in it is undone. */
  undone: z.boolean(),
  /** Newest first. */
  movements: z.array(MovementRow),
});
export type HistoryBatch = z.infer<typeof HistoryBatch>;

/**
 * Batches of kind import, pick_list, put_away, swap and undo are one `batch` entry; other
 * movements are `movement` entries of their own.
 */
export const HistoryEntry = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('movement'), movement: MovementRow }),
  z.object({ kind: z.literal('batch'), batch: HistoryBatch }),
]);
export type HistoryEntry = z.infer<typeof HistoryEntry>;

/** GET /api/history query. */
export const HistoryQuery = z.object({
  /** A date such as "2026-10-18": the answer is the latest day on or before it with history. Default today. */
  before: z.iso.date().optional(),
  /**
   * The browser's offset from UTC in minutes, as `new Date().getTimezoneOffset()` gives it
   * (420 for UTC−7), so days follow Jeff's clock.
   */
  offset: z.coerce.number().int().min(-840).max(720),
  /** An oracle id: movements of any printing of the card. */
  card: z.guid().optional(),
  /** Movements from or to that location or its children. */
  location: IdParam.optional(),
  deck: IdParam.optional(),
});
export type HistoryQuery = z.infer<typeof HistoryQuery>;

/** GET /api/history: one day's entries, newest first. */
export const HistoryDay = z.object({
  /** The day shown, such as "2026-10-18"; `before` (or today) when nothing matches. */
  day: z.iso.date(),
  entries: z.array(HistoryEntry),
  /** Send as `before` for the next older day (the day before `day`); null when there is no older history. */
  nextBefore: z.iso.date().nullable(),
});
export type HistoryDay = z.infer<typeof HistoryDay>;
