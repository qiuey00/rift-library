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
import { Board, Finish, LocationType } from '../../shared/api/common';

// The whole database. Change it here, then run `npm run db:generate` to write a migration
// into ./migrations, which the server applies when it starts.
//
// Conventions: app rows have autoincrement whole-number ids, Scryfall rows keep Scryfall's
// ids (text), true/false is stored as 0 or 1, and times are UTC ISO 8601 text.

/** The current UTC time as ISO 8601 text, such as "2026-10-19T02:20:45.123Z". */
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

const id = () => integer('id').primaryKey({ autoIncrement: true });
const flag = (name: string) => integer(name, { mode: 'boolean' }).notNull().default(false);
const createdAt = () => text('created_at').notNull().default(now);
/** A shared Zod enum's values, as the non-empty list a text column's `enum` takes. */
const values = <T extends string>(options: readonly T[]) => options as [T, ...T[]];

// Card data from Scryfall.

/** A card's columns, shared by `cards` and `cards_staging`. */
const cardColumns = () => ({
  oracleId: text('oracle_id').primaryKey(),
  /** The full "Front // Back" name for double-faced cards. */
  name: text('name').notNull(),
  frontFaceName: text('front_face_name').notNull(),
  typeLine: text('type_line').notNull(),
  manaCost: text('mana_cost').notNull().default(''),
  manaValue: real('mana_value').notNull().default(0),
  /** WUBRG order, such as "BRG"; "" for colorless. */
  colorIdentity: text('color_identity').notNull().default(''),
  commanderLegality: text('commander_legality', {
    enum: ['legal', 'not_legal', 'banned', 'restricted'],
  }).notNull(),
  keywords: text('keywords', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  canBeCommander: flag('can_be_commander'),
  isBasicLand: flag('is_basic_land'),
  /** A deck can hold any number of this card. */
  allowsMany: flag('allows_many'),
});

/** A printing's columns, shared by `printings` and `printings_staging`. */
const printingColumns = () => ({
  scryfallId: text('scryfall_id').primaryKey(),
  setCode: text('set_code').notNull(),
  setName: text('set_name').notNull(),
  collectorNumber: text('collector_number').notNull(),
  lang: text('lang').notNull(),
  finishes: text('finishes', { mode: 'json' }).$type<Finish[]>().notNull(),
  rarity: text('rarity').notNull(),
  /** A date, such as "2024-08-02". */
  releasedAt: text('released_at').notNull(),
  imageSmall: text('image_small'),
  imageNormal: text('image_normal'),
  /** The name this printing carries instead of the card's, such as "T'Challa's Protection". */
  flavorName: text('flavor_name'),
  // TCGplayer market price for each finish (Scryfall's usd fields), in whole cents; null when
  // Scryfall has none.
  priceUsd: integer('price_usd'),
  priceUsdFoil: integer('price_usd_foil'),
  priceUsdEtched: integer('price_usd_etched'),
});

/** One card, with all its printings. */
export const cards = sqliteTable('cards', cardColumns(), (t) => [
  index('cards_name').on(sql`${t.name} COLLATE NOCASE`),
  index('cards_front_face_name').on(sql`${t.frontFaceName} COLLATE NOCASE`),
]);

/** One printing of a card. */
export const printings = sqliteTable(
  'printings',
  {
    ...printingColumns(),
    oracleId: text('oracle_id')
      .notNull()
      .references(() => cards.oracleId),
  },
  (t) => [
    index('printings_oracle_id').on(t.oracleId),
    index('printings_set_code_collector_number').on(t.setCode, t.collectorNumber),
    index('printings_flavor_name').on(sql`${t.flavorName} COLLATE NOCASE`),
  ],
);

// A card data load fills these first, then swaps them into `cards` and `printings` in one
// transaction, so the app keeps working while a load runs. Empty between loads.

export const cardsStaging = sqliteTable('cards_staging', cardColumns());

export const printingsStaging = sqliteTable('printings_staging', {
  ...printingColumns(),
  oracleId: text('oracle_id').notNull(),
});

/** Which Scryfall file the app last loaded, and when it last checked. One row at most. */
export const cardDataStatus = sqliteTable(
  'card_data_status',
  {
    id: integer('id').primaryKey().default(1),
    bulkUpdatedAt: text('bulk_updated_at'),
    lastCheckedAt: text('last_checked_at'),
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
    scryfallId: text('scryfall_id')
      .notNull()
      .references(() => printings.scryfallId),
    quantity: integer('quantity').notNull(),
    finish: text('finish', { enum: values(Finish.options) }).notNull(),
    /** As ManaBox writes it, such as "near_mint". */
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
      t.scryfallId,
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
    oracleId: text('oracle_id')
      .notNull()
      .references(() => cards.oracleId),
    board: text('board', { enum: values(Board.options) }).notNull(),
    quantity: integer('quantity').notNull(),
    /** The printing of the copy pulled for this slot; null until one is pulled. */
    pickedScryfallId: text('picked_scryfall_id'),
    // The printing hint from the decklist, such as Moxfield's "(SET) 123 *F*".
    hintSetCode: text('hint_set_code'),
    hintCollectorNumber: text('hint_collector_number'),
    hintFoil: flag('hint_foil'),
  },
  (t) => [
    uniqueIndex('deck_slots_deck_card_board').on(t.deckId, t.oracleId, t.board),
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
    enum: ['import', 'add', 'move', 'pick_list', 'put_away', 'swap', 'undo'],
  }).notNull(),
  deckId: integer('deck_id'),
  importId: integer('import_id'),
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
    scryfallId: text('scryfall_id').notNull(),
    finish: text('finish', { enum: values(Finish.options) }).notNull(),
    condition: text('condition').notNull(),
    language: text('language').notNull(),
    misprint: flag('misprint'),
    altered: flag('altered'),
    isProxy: flag('is_proxy'),
    purchasePrice: real('purchase_price'),
    purchaseCurrency: text('purchase_currency'),
    quantity: integer('quantity').notNull(),
    /** Null for imports and adds. */
    fromLocationId: integer('from_location_id'),
    /** Null when copies are removed. */
    toLocationId: integer('to_location_id'),
    cameFromBefore: integer('came_from_before'),
    cameFromAfter: integer('came_from_after'),
    reason: text('reason', {
      enum: [
        'imported',
        'added',
        'moved',
        'assembled',
        'returned',
        'swapped_out',
        'swapped_in',
        'location_update',
        'undo',
      ],
    }).notNull(),
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
    index('movements_scryfall_id').on(t.scryfallId),
  ],
);

/** One ManaBox or Moxfield import. */
export const imports = sqliteTable('imports', {
  id: id(),
  kind: text('kind', {
    enum: ['manabox_add', 'manabox_update', 'moxfield_new', 'moxfield_update'],
  }).notNull(),
  fileName: text('file_name'),
  targetLocationId: integer('target_location_id'),
  deckId: integer('deck_id'),
  rowCount: integer('row_count').notNull().default(0),
  cardCount: integer('card_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  createdAt: createdAt(),
});

/** Which location each ManaBox binder or deck imports into. */
export const binderMappings = sqliteTable(
  'binder_mappings',
  {
    manaboxName: text('manabox_name').notNull(),
    manaboxType: text('manabox_type', { enum: ['binder', 'deck'] }).notNull(),
    locationId: integer('location_id')
      .notNull()
      .references(() => locations.id),
  },
  (t) => [primaryKey({ columns: [t.manaboxName, t.manaboxType] })],
);

/** The one buy list. Only Jeff adds rows. */
export const buyListItems = sqliteTable(
  'buy_list_items',
  {
    id: id(),
    oracleId: text('oracle_id')
      .notNull()
      .references(() => cards.oracleId),
    /** A wanted printing, or null for any. */
    scryfallId: text('scryfall_id'),
    quantity: integer('quantity').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [check('buy_list_items_quantity_above_zero', sql`${t.quantity} > 0`)],
);
