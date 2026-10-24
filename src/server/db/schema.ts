import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { Board, CardType, type Domain, Finish, LocationType } from '../../shared/api/common';
import { RemovalReason } from '../../shared/api/copies';

// The whole database. Change it here, then run `npm run db:generate` to write a migration
// into ./migrations, which the server applies when it starts.
//
// Conventions: app rows (cards included) have autoincrement whole-number ids, printings keep
// Riftcodex's ids (text), true/false is stored as 0 or 1, times are UTC ISO 8601 text and
// money is whole US cents.

/** The current UTC time as ISO 8601 text, such as "2026-10-19T02:20:45.123Z". */
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const id = () => integer('id').primaryKey({ autoIncrement: true });
const flag = (name: string) => integer(name, { mode: 'boolean' }).notNull().default(false);
const createdAt = () => text('created_at').notNull().default(now);
/** A shared Zod enum's values, as the non-empty list a text column's `enum` takes. */
const values = <T extends string>(options: readonly T[]) => options as [T, ...T[]];

// Card data from Riftcodex. Nothing loads it until the Riftcodex sync (#7), so the tables
// start empty.

/**
 * One card, with all its printings. Riftcodex has no card-level id, so printings are grouped
 * into cards by name key.
 */
export const cards = sqliteTable(
  'cards',
  {
    id: id(),
    name: text('name').notNull(),
    /** Lower case, each run of spaces collapsed to one; the grouping rule. */
    nameKey: text('name_key').notNull().unique(),
    type: text('type', { enum: values(CardType.options) }).notNull(),
    /** Such as "champion", "signature" or "token". */
    supertype: text('supertype'),
    domains: text('domains', { mode: 'json' }).$type<Domain[]>().notNull().default(sql`'[]'`),
    energy: integer('energy'),
    might: integer('might'),
    power: integer('power'),
    /** The champion the card belongs to, such as "Jinx". */
    championTag: text('champion_tag'),
    rulesText: text('rules_text').notNull().default(''),
    /** False for tokens and other cards a deck can't hold. */
    deckable: integer('deckable', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('cards_name').on(sql`${t.name} COLLATE NOCASE`)],
);

/** One printing of a card. */
export const printings = sqliteTable(
  'printings',
  {
    riftcodexId: text('riftcodex_id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    riftboundId: text('riftbound_id'),
    /** Such as "OGN-001/298". */
    publicCode: text('public_code').notNull(),
    /** Such as "OGN". */
    setCode: text('set_code').notNull(),
    setName: text('set_name').notNull(),
    collectorNumber: text('collector_number').notNull(),
    rarity: text('rarity').notNull(),
    imageUrl: text('image_url'),
    artist: text('artist'),
    alternateArt: flag('alternate_art'),
    overnumbered: flag('overnumbered'),
    signature: flag('signature'),
    /** TCGplayer's product id, which prices are matched by (#25). */
    tcgplayerId: integer('tcgplayer_id'),
    finishes: text('finishes', { mode: 'json' })
      .$type<Finish[]>()
      .notNull()
      .default(sql`'["normal","foil"]'`),
    // TCGplayer market price for each finish, in whole cents; null when there is none.
    priceNormal: integer('price_normal'),
    priceFoil: integer('price_foil'),
  },
  (t) => [
    index('printings_card_id').on(t.cardId),
    index('printings_public_code').on(sql`${t.publicCode} COLLATE NOCASE`),
    index('printings_tcgplayer_id').on(t.tcgplayerId),
  ],
);

/** When cards were last synced and prices last updated. One row at most. */
export const cardDataStatus = sqliteTable(
  'card_data_status',
  {
    id: integer('id').primaryKey().default(1),
    cardsSyncedAt: text('cards_synced_at'),
    pricesUpdatedAt: text('prices_updated_at'),
    cardCount: integer('card_count').notNull().default(0),
    printingCount: integer('printing_count').notNull().default(0),
  },
  (t) => [check('card_data_status_one_row', sql`${t.id} = 1`)],
);

// The collection.

/** A place cards live: a binder, box, deck box, tray or the "to sort" inbox. */
export const locations = sqliteTable(
  'locations',
  {
    id: id(),
    name: text('name').notNull(),
    type: text('type', { enum: values(LocationType.options) }).notNull(),
    parentId: integer('parent_id').references((): AnySQLiteColumn => locations.id),
    /** Order among its siblings. */
    position: integer('position').notNull().default(0),
    /** Hex, such as "#3b82f6"; null to use the parent's. */
    color: text('color'),
    /** Jeff marked it For trade. Locations inside a marked one are for trade too. */
    forTrade: flag('for_trade'),
    createdAt: createdAt(),
    /** Deleting sets this, so History can still name the location. */
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('locations_parent_id').on(t.parentId),
    uniqueIndex('locations_one_inbox').on(t.type).where(sql`${t.type} = 'inbox'`),
  ],
);

/** Alike copies of one printing in one location. */
export const copyStacks = sqliteTable(
  'copy_stacks',
  {
    id: id(),
    printingId: text('printing_id')
      .notNull()
      .references(() => printings.riftcodexId),
    quantity: integer('quantity').notNull(),
    finish: text('finish', { enum: values(Finish.options) }).notNull(),
    /** Such as "near_mint". */
    condition: text('condition').notNull(),
    /** Such as "en". */
    language: text('language').notNull(),
    misprint: flag('misprint'),
    altered: flag('altered'),
    isProxy: flag('is_proxy'),
    purchasePrice: real('purchase_price'),
    purchaseCurrency: text('purchase_currency'),
    locationId: integer('location_id')
      .notNull()
      .references(() => locations.id),
    /** Where copies in a deck box go back to; null when none. */
    cameFromLocationId: integer('came_from_location_id').references(() => locations.id),
    createdAt: createdAt(),
    updatedAt: text('updated_at')
      .notNull()
      .default(now)
      .$onUpdateFn(() => new Date().toISOString()),
  },
  (t) => [
    check('copy_stacks_quantity_above_zero', sql`${t.quantity} > 0`),
    // The merge rule: alike stacks in one place exist as one row. SQLite treats NULLs as
    // all different in a unique index, so an empty came-from counts as 0 here. This is
    // COALESCE(came_from_location_id, 0) written without a comma, which drizzle-kit would
    // split into two broken index columns.
    uniqueIndex('copy_stacks_merge_rule').on(
      t.printingId,
      t.finish,
      t.condition,
      t.language,
      t.misprint,
      t.altered,
      t.isProxy,
      t.locationId,
      sql`(CASE WHEN ${t.cameFromLocationId} IS NULL THEN 0 ELSE ${t.cameFromLocationId} END)`,
    ),
    index('copy_stacks_location_id').on(t.locationId),
  ],
);

// Decks.

export const decks = sqliteTable('decks', {
  id: id(),
  name: text('name').notNull(),
  /** Each deck has its own deck box. */
  deckBoxId: integer('deck_box_id')
    .notNull()
    .unique()
    .references(() => locations.id),
  createdAt: createdAt(),
  updatedAt: text('updated_at')
    .notNull()
    .default(now)
    .$onUpdateFn(() => new Date().toISOString()),
  openedAt: text('opened_at'),
  /** Deleting sets this. */
  deletedAt: text('deleted_at'),
});

/** One card on one board of a deck. */
export const deckSlots = sqliteTable(
  'deck_slots',
  {
    id: id(),
    deckId: integer('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    board: text('board', { enum: values(Board.options) }).notNull(),
    quantity: integer('quantity').notNull(),
    /** The printing of the copy pulled for this slot; null until one is pulled. */
    pickedPrintingId: text('picked_printing_id'),
    // The printing hint from the deck list: a public code, such as "OGN-042", and foil.
    hintPublicCode: text('hint_public_code'),
    hintFoil: flag('hint_foil'),
  },
  (t) => [
    uniqueIndex('deck_slots_deck_card_board').on(t.deckId, t.cardId, t.board),
    check('deck_slots_quantity_above_zero', sql`${t.quantity} > 0`),
  ],
);

/** A slot's tags, such as "Ramp". */
export const deckSlotTags = sqliteTable(
  'deck_slot_tags',
  {
    slotId: integer('slot_id')
      .notNull()
      .references(() => deckSlots.id, { onDelete: 'cascade' }),
    /** As Jeff typed it, trimmed. */
    tag: text('tag').notNull(),
    /** Lower case, each run of spaces turned into -, so "Card draw" and "card-draw" are one tag. */
    tagKey: text('tag_key').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.slotId, t.tagKey] }),
    index('deck_slot_tags_tag_key').on(t.tagKey),
  ],
);

// History. Movements are never deleted.

/** Groups one action's movements into one History entry. */
export const movementBatches = sqliteTable('movement_batches', {
  id: id(),
  kind: text('kind', {
    enum: ['add', 'remove', 'move', 'pick_list', 'put_away', 'swap', 'undo'],
  }).notNull(),
  deckId: integer('deck_id'),
  createdAt: createdAt(),
});

/**
 * Copies of one stack moving, arriving or leaving. Each movement keeps the copies' details
 * itself, because stacks split and merge, so a stack row can be gone by the time undo needs
 * to put the copies back exactly.
 */
export const movements = sqliteTable(
  'movements',
  {
    id: id(),
    batchId: integer('batch_id').notNull(),
    /** No foreign key: stacks split and merge, so the row may be gone. */
    copyStackId: integer('copy_stack_id').notNull(),
    printingId: text('printing_id').notNull(),
    finish: text('finish', { enum: values(Finish.options) }).notNull(),
    condition: text('condition').notNull(),
    language: text('language').notNull(),
    misprint: flag('misprint'),
    altered: flag('altered'),
    isProxy: flag('is_proxy'),
    purchasePrice: real('purchase_price'),
    purchaseCurrency: text('purchase_currency'),
    quantity: integer('quantity').notNull(),
    /** Null for adds. */
    fromLocationId: integer('from_location_id'),
    /** Null when copies are removed. */
    toLocationId: integer('to_location_id'),
    cameFromBefore: integer('came_from_before'),
    cameFromAfter: integer('came_from_after'),
    reason: text('reason', {
      enum: [
        'added',
        'removed',
        'moved',
        'assembled',
        'returned',
        'swapped_out',
        'swapped_in',
        'location_update',
        'undo',
      ],
    }).notNull(),
    /** Why copies were removed (COL-13); null unless the reason is `removed`. */
    removalReason: text('removal_reason', { enum: values(RemovalReason.options) }),
    deckId: integer('deck_id'),
    /** No foreign key: slots can be removed while History still names them. */
    slotId: integer('slot_id'),
    /** The slot's picked printing before this movement, so undo can restore it. */
    pickedBefore: text('picked_before'),
    undoesMovementId: integer('undoes_movement_id'),
    undoneAt: text('undone_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('movements_batch_id').on(t.batchId),
    index('movements_created_at').on(t.createdAt),
    index('movements_deck_id').on(t.deckId),
    index('movements_printing_id').on(t.printingId),
  ],
);

/** The one buy list. Only Jeff adds rows. */
export const buyListItems = sqliteTable(
  'buy_list_items',
  {
    id: id(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id),
    /** A wanted printing, or null for any. */
    printingId: text('printing_id'),
    quantity: integer('quantity').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [check('buy_list_items_quantity_above_zero', sql`${t.quantity} > 0`)],
);
