import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Board, DeckState, LocationRef } from '../../shared/api/common';
import type {
  BoardCounts,
  DeckCounts,
  DeckRef,
  DeckSummary,
  DeckView,
  SlotRow,
} from '../../shared/api/decks';
import type { Db } from '../db/database';
import {
  cards,
  copyStacks,
  deckSlots,
  deckSlotTags,
  decks,
  locations,
  printings,
} from '../db/schema';
import { cardImages, cardSummary, printingSummary } from './card-summaries';
import { locationColors, locationPaths, locationTradeFlags } from './locations';

// Decks worked out from where copies sit. Nothing here is stored (no reservations): a copy's
// location is the only truth, so two decks can both see the same free copy.
//
// Storage is every live location that isn't a deck box. Copies of a card are copy stacks of
// any printing, and proxies count like real copies. Deleted decks are left out everywhere.

type CardRow = typeof cards.$inferSelect;
type PrintingRow = typeof printings.$inferSelect;
type DeckRow = typeof decks.$inferSelect;
type SlotDbRow = typeof deckSlots.$inferSelect;
type LocationRow = typeof locations.$inferSelect;

/** The live deck, or undefined when it doesn't exist or was deleted. */
export function findDeck(db: Db, id: number): DeckRow | undefined {
  return db
    .select()
    .from(decks)
    .where(and(eq(decks.id, id), isNull(decks.deletedAt)))
    .get();
}

/** Copies in one place, by card. */
type Pile = { quantity: number; proxy: boolean };

/** Where copies of the deck's cards sit, gathered once for every deck being worked out. */
type Holdings = {
  /** deck box id → card id → copies there. */
  boxes: Map<number, Map<number, Pile>>;
  /** deck box id → every copy in it. */
  boxTotals: Map<number, number>;
  /** card id → storage location id → copies there. */
  storage: Map<number, Map<number, number>>;
  /** Live decks by their deck box id. */
  deckByBox: Map<number, DeckRow>;
  /** Live location ids in tree order, with their paths. */
  paths: Map<number, string>;
  /** Live location ids by their place in tree order. */
  treeIndex: Map<number, number>;
  /** Live locations' effective colors. */
  colors: Map<number, string | null>;
  /** Whether each location is for trade (marked, or inside a marked location). */
  trade: Map<number, boolean>;
  /** Every location by id. */
  locations: Map<number, LocationRow>;
  images: Map<number, string>;
};

function holdings(db: Db, liveDecks: DeckRow[], cardIds: number[]): Holdings {
  const paths = locationPaths(db);
  const deckByBox = new Map(liveDecks.map((deck) => [deck.deckBoxId, deck]));
  const boxIds = new Set(liveDecks.map((deck) => deck.deckBoxId));
  const deckBoxType = new Set(
    db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.type, 'deck_box'))
      .all()
      .map((row) => row.id),
  );

  const boxes = new Map<number, Map<number, Pile>>();
  const boxTotals = new Map<number, number>();
  const storage = new Map<number, Map<number, number>>();

  for (const total of db
    .select({
      locationId: copyStacks.locationId,
      quantity: sql<number>`sum(${copyStacks.quantity})`,
    })
    .from(copyStacks)
    .groupBy(copyStacks.locationId)
    .all()) {
    if (boxIds.has(total.locationId)) boxTotals.set(total.locationId, total.quantity);
  }

  if (cardIds.length > 0) {
    const stacks = db
      .select({
        cardId: printings.cardId,
        locationId: copyStacks.locationId,
        quantity: copyStacks.quantity,
        isProxy: copyStacks.isProxy,
      })
      .from(copyStacks)
      .innerJoin(printings, eq(printings.riftcodexId, copyStacks.printingId))
      .where(inArray(printings.cardId, cardIds))
      .all();
    for (const stack of stacks) {
      if (!paths.has(stack.locationId)) continue; // in a deleted location
      if (boxIds.has(stack.locationId)) {
        const box = boxes.get(stack.locationId) ?? new Map<number, Pile>();
        boxes.set(stack.locationId, box);
        const pile = box.get(stack.cardId) ?? { quantity: 0, proxy: false };
        pile.quantity += stack.quantity;
        pile.proxy ||= stack.isProxy;
        box.set(stack.cardId, pile);
      } else if (!deckBoxType.has(stack.locationId)) {
        const spots = storage.get(stack.cardId) ?? new Map<number, number>();
        storage.set(stack.cardId, spots);
        spots.set(stack.locationId, (spots.get(stack.locationId) ?? 0) + stack.quantity);
      }
      // A deck box with no live deck is neither storage nor a deck: its copies are left out.
    }
  }

  return {
    boxes,
    boxTotals,
    storage,
    deckByBox,
    paths,
    treeIndex: new Map([...paths.keys()].map((id, index) => [id, index])),
    colors: locationColors(db),
    trade: locationTradeFlags(db),
    locations: new Map(
      db
        .select()
        .from(locations)
        .all()
        .map((row) => [row.id, row]),
    ),
    images: cardImages(db, cardIds),
  };
}

type SlotWithCard = {
  slot: SlotDbRow;
  card: CardRow;
  picked: PrintingRow | null;
  /** The decklist's printing: the picked printing, otherwise the one the hint names. */
  printing: PrintingRow | null;
  /** The slot's tags, sorted by name ignoring case. */
  tags: string[];
};

/**
 * The printing each unpicked slot's hint names, by slot id: the hint is a public code with or
 * without the set size, such as "OGN-042" for "OGN-042/298". Printings that aren't alternate
 * art come first.
 */
function hintedPrintings(db: Db, deckIds: number[]): Map<number, PrintingRow> {
  const rows = db
    .select({ slotId: deckSlots.id, printing: printings })
    .from(deckSlots)
    .innerJoin(
      printings,
      and(
        eq(printings.cardId, deckSlots.cardId),
        sql`(lower(${printings.publicCode}) = lower(${deckSlots.hintPublicCode})
          OR lower(${printings.publicCode}) LIKE lower(${deckSlots.hintPublicCode}) || '/%')`,
      ),
    )
    .where(and(inArray(deckSlots.deckId, deckIds), isNull(deckSlots.pickedPrintingId)))
    .orderBy(printings.alternateArt, printings.riftcodexId)
    .all();
  const bySlot = new Map<number, PrintingRow>();
  for (const { slotId, printing } of rows) {
    if (!bySlot.has(slotId)) bySlot.set(slotId, printing);
  }
  return bySlot;
}

function slotsOf(db: Db, deckIds: number[]): SlotWithCard[] {
  if (deckIds.length === 0) return [];
  const picked = db
    .select()
    .from(printings)
    .where(
      inArray(
        printings.riftcodexId,
        db
          .select({ id: deckSlots.pickedPrintingId })
          .from(deckSlots)
          .where(inArray(deckSlots.deckId, deckIds)),
      ),
    )
    .all();
  const pickedById = new Map(picked.map((p) => [p.riftcodexId, p]));
  const hinted = hintedPrintings(db, deckIds);
  const tags = slotTags(db, deckIds);
  return db
    .select()
    .from(deckSlots)
    .innerJoin(cards, eq(cards.id, deckSlots.cardId))
    .where(inArray(deckSlots.deckId, deckIds))
    .orderBy(deckSlots.id)
    .all()
    .map((row) => {
      const picked = row.deck_slots.pickedPrintingId
        ? (pickedById.get(row.deck_slots.pickedPrintingId) ?? null)
        : null;
      const printing = picked ?? hinted.get(row.deck_slots.id) ?? null;
      const slotTags = tags.get(row.deck_slots.id) ?? [];
      return { slot: row.deck_slots, card: row.cards, picked, printing, tags: slotTags };
    });
}

/** Each slot's tags, by slot id, sorted by name ignoring case. */
function slotTags(db: Db, deckIds: number[]): Map<number, string[]> {
  const rows = db
    .select({ slotId: deckSlotTags.slotId, tag: deckSlotTags.tag })
    .from(deckSlotTags)
    .innerJoin(deckSlots, eq(deckSlots.id, deckSlotTags.slotId))
    .where(inArray(deckSlots.deckId, deckIds))
    .orderBy(sql`lower(${deckSlotTags.tag})`, deckSlotTags.tag)
    .all();
  const bySlot = new Map<number, string[]>();
  for (const { slotId, tag } of rows) {
    const list = bySlot.get(slotId);
    if (list) list.push(tag);
    else bySlot.set(slotId, [tag]);
  }
  return bySlot;
}

/** The order boards are listed in. */
export const BOARD_ORDER: Record<Board, number> = {
  legend: 0,
  champion: 1,
  main: 2,
  battlefield: 3,
  rune: 4,
  sideboard: 5,
  maybe: 6,
};

/**
 * The boards whose cards are pulled into the deck box, count toward demand and decide the
 * deck's state (DECK-9, DECK-10, D-29). The rune board is always available and the maybe board
 * is never pulled.
 */
export const PULLED_BOARDS: Board[] = ['legend', 'champion', 'main', 'battlefield', 'sideboard'];

/** Runes are always available, as basic lands were in Library of Gathering (D-15). */
export function isRune(card: Pick<CardRow, 'type'>, board?: Board): boolean {
  return card.type === 'rune' || board === 'rune';
}

/** Every slot of one deck with its status, in board order, plus the deck's counts and state. */
function workOut(deck: DeckRow, slots: SlotWithCard[], held: Holdings) {
  const box = held.boxes.get(deck.deckBoxId) ?? new Map<number, Pile>();
  // Copies in the box are shared out among the deck's slots of that card, in board order.
  const left = new Map([...box].map(([cardId, pile]) => [cardId, pile.quantity]));
  const order = [...slots].sort(
    (a, b) => BOARD_ORDER[a.slot.board] - BOARD_ORDER[b.slot.board] || a.slot.id - b.slot.id,
  );

  const counts: DeckCounts = { inBox: 0, free: 0, otherDecks: 0, missing: 0, runes: 0 };
  let tracked = 0;
  let filled = 0;
  let touched = 0;
  const rows = new Map<number, SlotRow>();

  for (const { slot, card, picked, printing, tags } of order) {
    const pile = box.get(card.id);
    const row: SlotRow = {
      id: slot.id,
      card: cardSummary(card, held.images.get(card.id)),
      board: slot.board,
      quantity: slot.quantity,
      pickedPrinting: picked ? printingSummary(picked) : null,
      printing: printing ? printingSummary(printing) : null,
      hint: slot.hintPublicCode ? { publicCode: slot.hintPublicCode, foil: slot.hintFoil } : null,
      status: null,
      inBoxQuantity: 0,
      inBoxProxy: pile?.proxy ?? false,
      where: { locations: [], freeCount: 0, otherDecks: [] },
      tags,
    };
    rows.set(slot.id, row);
    if (slot.board === 'maybe') continue; // never pulled
    if (isRune(card, slot.board)) {
      row.status = 'rune';
      counts.runes += slot.quantity;
      continue;
    }

    const inBox = Math.min(left.get(card.id) ?? 0, slot.quantity);
    left.set(card.id, (left.get(card.id) ?? 0) - inBox);
    row.inBoxQuantity = inBox;

    tracked += 1;
    if (inBox > 0 || (pile?.quantity ?? 0) > 0) touched += 1;
    counts.inBox += inBox;
    if (inBox >= slot.quantity) {
      row.status = 'in_box';
      filled += 1;
      continue;
    }

    const rest = slot.quantity - inBox;
    row.where = where(deck, card.id, held);
    const inOtherDecks = otherDeckCopies(deck, card.id, held);
    row.status = row.where.freeCount > 0 ? 'free' : inOtherDecks > 0 ? 'other_decks' : 'missing';
    // The counts split the rest by where copies are: free first, then other decks.
    const free = Math.min(rest, row.where.freeCount);
    const others = Math.min(rest - free, inOtherDecks);
    counts.free += free;
    counts.otherDecks += others;
    counts.missing += rest - free - others;
  }

  const state: DeckState =
    touched === 0 ? 'not_assembled' : filled === tracked ? 'assembled' : 'partly_assembled';

  const first = (board: Board) => {
    const card = order.find((s) => s.slot.board === board)?.card;
    return card ? cardSummary(card, held.images.get(card.id)) : null;
  };
  const legend = first('legend');
  const summary: DeckSummary = {
    id: deck.id,
    name: deck.name,
    deckBoxId: deck.deckBoxId,
    legend,
    champion: first('champion'),
    domains: legend?.domains ?? [],
    state,
    counts,
    boxCopyCount: held.boxTotals.get(deck.deckBoxId) ?? 0,
    openedAt: deck.openedAt,
  };
  return { summary, slots: order.map((s) => rows.get(s.slot.id) as SlotRow) };
}

function otherDeckCopies(deck: DeckRow, cardId: number, held: Holdings) {
  let total = 0;
  for (const [boxId, box] of held.boxes) {
    if (boxId !== deck.deckBoxId) total += box.get(cardId)?.quantity ?? 0;
  }
  return total;
}

/** Storage spots with free copies (most first, then tree order) and other decks holding one. */
function where(deck: DeckRow, cardId: number, held: Holdings): SlotRow['where'] {
  const spots = held.storage.get(cardId) ?? new Map<number, number>();
  const best = [...spots].sort(
    ([a, qa], [b, qb]) => qb - qa || (held.treeIndex.get(a) ?? 0) - (held.treeIndex.get(b) ?? 0),
  );
  const refs = locationRefs(
    best.map(([id]) => id),
    held,
  );

  const otherDecks: DeckRef[] = [];
  for (const [boxId, box] of held.boxes) {
    const other = held.deckByBox.get(boxId);
    if (other && boxId !== deck.deckBoxId && (box.get(cardId)?.quantity ?? 0) > 0) {
      otherDecks.push({ id: other.id, name: other.name });
    }
  }
  otherDecks.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

  return {
    locations: refs,
    freeCount: best.reduce((n, [, quantity]) => n + quantity, 0),
    otherDecks,
  };
}

function locationRefs(ids: number[], held: Holdings): LocationRef[] {
  return ids.flatMap((id) => {
    const row = held.locations.get(id);
    if (!row) return [];
    return [
      {
        id,
        name: row.name,
        type: row.type,
        path: held.paths.get(id) ?? row.name,
        color: held.colors.get(id) ?? null,
        forTrade: held.trade.get(id) ?? false,
      },
    ];
  });
}

/** Works out the given live decks, in the order given. */
function workOutDecks(db: Db, liveDecks: DeckRow[]) {
  const slots = slotsOf(
    db,
    liveDecks.map((deck) => deck.id),
  );
  const cardIds = [...new Set(slots.map((s) => s.card.id))];
  // Every live deck's box counts as "another deck" for the ones being worked out.
  const allLive = db.select().from(decks).where(isNull(decks.deletedAt)).all();
  const held = holdings(db, allLive, cardIds);
  return liveDecks.map((deck) =>
    workOut(
      deck,
      slots.filter((s) => s.slot.deckId === deck.id),
      held,
    ),
  );
}

/** GET /api/decks: most recently opened first, never-opened decks last, newest first. */
export function deckList(db: Db): DeckSummary[] {
  const live = db
    .select()
    .from(decks)
    .where(isNull(decks.deletedAt))
    .orderBy(sql`${decks.openedAt} IS NULL`, desc(decks.openedAt), desc(decks.id))
    .all();
  return workOutDecks(db, live).map((deck) => deck.summary);
}

/** One live deck's summary; undefined when it doesn't exist or was deleted. */
export function deckSummary(db: Db, id: number): DeckSummary | undefined {
  const deck = findDeck(db, id);
  return deck ? workOutDecks(db, [deck])[0].summary : undefined;
}

/** One live deck with every slot; undefined when it doesn't exist or was deleted. */
export function deckView(db: Db, id: number): DeckView | undefined {
  const deck = findDeck(db, id);
  if (!deck) return undefined;
  const [{ summary, slots }] = workOutDecks(db, [deck]);
  return { deck: summary, slots, boards: boardCounts(slots) };
}

/** Cards on each board, by slot quantity. */
function boardCounts(slots: SlotRow[]): BoardCounts {
  const boards: BoardCounts = {
    legend: 0,
    champion: 0,
    main: 0,
    battlefield: 0,
    rune: 0,
    sideboard: 0,
    maybe: 0,
  };
  for (const slot of slots) boards[slot.board] += slot.quantity;
  return boards;
}

/** One slot of a live deck, worked out; undefined when it isn't there. */
export function slotRow(db: Db, deckId: number, slotId: number): SlotRow | undefined {
  return deckView(db, deckId)?.slots.find((slot) => slot.id === slotId);
}

/** Every copy in the deck box, needed or not. */
export function boxCopyCount(db: Db, deckBoxId: number): number {
  return (
    db
      .select({ quantity: sql<number>`coalesce(sum(${copyStacks.quantity}), 0)` })
      .from(copyStacks)
      .where(eq(copyStacks.locationId, deckBoxId))
      .get()?.quantity ?? 0
  );
}
