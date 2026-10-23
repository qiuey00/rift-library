import { z } from 'zod';
import { Cents, ErrorBody, Id, IdParam, LocationType } from './common';
import { DeckRef } from './decks';

// The locations area: the location tree, and creating, changing and deleting locations.
// Routes in src/server/routes/locations.ts.

/** A location's color, such as "#3b6fd8". */
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a color such as #3b6fd8');
export type HexColor = z.infer<typeof HexColor>;

/** One location in the tree. */
export const LocationNode = z.object({
  id: Id,
  name: z.string(),
  type: LocationType,
  parentId: Id.nullable(),
  /** Its order among its siblings, from 0. */
  position: z.number().int().nonnegative(),
  /** Its own color; null when it has none and uses its parent's. */
  color: HexColor.nullable(),
  /** Its own color, or its nearest ancestor's. */
  effectiveColor: HexColor.nullable(),
  /** Such as "Long box › Lands". */
  path: z.string(),
  /** 0 for top-level locations. */
  depth: z.number().int().nonnegative(),
  /** Copies directly in it (stack quantities, proxies included). */
  cardCount: z.number().int().nonnegative(),
  /** Copies in it and all its children. */
  totalCount: z.number().int().nonnegative(),
  /** For a deck box that belongs to a deck. */
  deck: DeckRef.nullable(),
  /** Its own For trade switch. */
  markedForTrade: z.boolean(),
  /** Marked For trade itself, or inside a location that is. */
  forTrade: z.boolean(),
  /** What every non-proxy copy in it and the locations inside it is worth. */
  value: Cents,
  /** Non-proxy cards in it and inside it with no price. */
  noPriceCount: z.number().int().nonnegative(),
});
export type LocationNode = z.infer<typeof LocationNode>;

/**
 * GET /api/locations/tree: every location that isn't deleted, flat, in tree order: the
 * "To sort" inbox first, then depth-first by position, deck boxes last. The screen puts a
 * top-level location with `forTrade` in its Trade binders section.
 */
export const LocationTree = z.object({ nodes: z.array(LocationNode) });
export type LocationTree = z.infer<typeof LocationTree>;

export const LocationName = z.string().trim().min(1).max(100);

/** POST /api/locations → `LocationNode`. A new location goes last among its siblings. */
export const CreateLocationBody = z.object({
  name: LocationName,
  type: LocationType.exclude(['inbox']),
  /** Leave out for a top-level location. */
  parentId: Id.optional(),
});
export type CreateLocationBody = z.infer<typeof CreateLocationBody>;

/**
 * PATCH /api/locations/:id → `LocationNode`. Send only what changes. A new position shifts
 * its siblings. Errors: 400 `inbox_protected` when renaming the inbox or marking it For
 * trade; 400 `deck_box_not_for_trade` when marking a deck box For trade; 400 `location_loop`
 * when the new parent would put a location inside itself.
 */
export const UpdateLocationBody = z
  .object({
    name: LocationName.optional(),
    color: HexColor.nullable().optional(),
    /** null moves it to the top level. */
    parentId: Id.nullable().optional(),
    position: z.number().int().nonnegative().optional(),
    /** Its own For trade switch. */
    forTrade: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Send at least one of name, color, parentId, position or forTrade',
  });
export type UpdateLocationBody = z.infer<typeof UpdateLocationBody>;

/** `:id` in /api/locations/:id and the routes under it. */
export const LocationIdParams = z.object({ id: IdParam });

/**
 * DELETE /api/locations/:id → 204, hiding it and its children. Errors: 409
 * `location_not_empty` (this body) when it or a child holds copies; 400 `inbox_protected`;
 * 400 `deck_box_protected` for a deck box that belongs to a deck (deleting the deck handles it).
 */
export const LocationNotEmptyError = z.object({
  error: ErrorBody.shape.error.extend({
    code: z.literal('location_not_empty'),
    /** Copies in it and its children. */
    cardCount: z.number().int().positive(),
  }),
});
export type LocationNotEmptyError = z.infer<typeof LocationNotEmptyError>;
