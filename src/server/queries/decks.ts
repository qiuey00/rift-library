import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { CardSummary, DeckState, LocationRef, PrintingSummary } from '../../shared/api/common';
import type { DeckCounts, DeckRef, DeckSummary, DeckView, SlotRow } from '../../shared/api/decks';
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

const WUBRG = 'WUBRG';

type Images = Pick<CardSummary, 'imageSmall' | 'imageNormal'>;
const NO_IMAGES: Images = { imageSmall: null, imageNormal: null };

/** A card as the API shows it, with the images of the printing `cardImages` chose. */
export function cardSummary(card: CardRow, images: Images = NO_IMAGES): CardSummary {
  return {
    oracleId: card.oracleId,
    name: card.name,
    frontFaceName: card.frontFaceName,
    manaCost: card.manaCost,
    manaValue: card.manaValue,
    typeLine: card.typeLine,
    colorIdentity: card.colorIdentity,
    ...images,
    canBeCommander: card.canBeCommander,
    isBasicLand: card.isBasicLand,
  };
}

export function printingSummary(printing: PrintingRow): PrintingSummary {
  return {
    printingId: printing.printingId,
    oracleId: printing.oracleId,
    setCode: printing.setCode,
    setName: printing.setName,
    collectorNumber: printing.collectorNumber,
    lang: printing.lang,
    finishes: printing.finishes,
    rarity: printing.rarity,
    imageSmall: printing.imageSmall,
    imageNormal: printing.imageNormal,
  };
}

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
  /** deck box id → oracle id → copies there. */
  boxes: Map<number, Map<string, Pile>>;
  /** deck box id → every copy in it. */
  boxTotals: Map<number, number>;
  /** oracle id → storage location id → copies there. */
  storage: Map<string, Map<number, number>>;
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
  images: Map<string, Images>;
};

function holdings(db: Db, liveDecks: DeckRow[], oracleIds: string[]): Holdings {
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

  const boxes = new Map<number, Map<string, Pile>>();
  const boxTotals = new Map<number, number>();
  const storage = new Map<string, Map<number, number>>();

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

  if (oracleIds.length > 0) {
    const stacks = db
      .select({
        oracleId: printings.oracleId,
        locationId: copyStacks.locationId,
        quantity: copyStacks.quantity,
        isProxy: copyStacks.isProxy,
      })
      .from(copyStacks)
      .innerJoin(printings, eq(printings.printingId, copyStacks.printingId))
      .where(inArray(printings.oracleId, oracleIds))
      .all();
    for (const stack of stacks) {
      if (!paths.has(stack.locationId)) continue; // in a deleted location
      if (boxIds.has(stack.locationId)) {
        const box = boxes.get(stack.locationId) ?? new Map<string, Pile>();
        boxes.set(stack.locationId, box);
        const pile = box.get(stack.oracleId) ?? { quantity: 0, proxy: false };
        pile.quantity += stack.quantity;
        pile.proxy ||= stack.isProxy;
        box.set(stack.oracleId, pile);
      } else if (!deckBoxType.has(stack.locationId)) {
        const spots = storage.get(stack.oracleId) ?? new Map<number, number>();
        storage.set(stack.oracleId, spots);
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
    images: cardImages(db, oracleIds),
  };
}

/** Each card's images from its newest printing, English first. */
export function cardImages(db: Db, oracleIds: string[]): Map<string, Images> {
  const images = new Map<string, Images>();
  if (oracleIds.length === 0) return images;
  const rows = db
    .select()
    .from(printings)
    .where(inArray(printings.oracleId, oracleIds))
    .orderBy(sql`${printings.lang} = 'en' DESC`, desc(printings.releasedAt))
    .all();
  for (const row of rows) {
    if (!images.has(row.oracleId)) {
      images.set(row.oracleId, { imageSmall: row.imageSmall, imageNormal: row.imageNormal });
    }
  }
  return images;
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

/** The printing each unpicked slot's hint names, by slot id, English first. */
function hintedPrintings(db: Db, deckIds: number[]): Map<number, PrintingRow> {
  const rows = db
    .select({ slotId: deckSlots.id, printing: printings })
    .from(deckSlots)
    .innerJoin(
      printings,
      and(
        eq(printings.oracleId, deckSlots.oracleId),
        eq(printings.collectorNumber, deckSlots.hintCollectorNumber),
        sql`lower(${printings.setCode}) = lower(${deckSlots.hintSetCode})`,
      ),
    )
    .where(and(inArray(deckSlots.deckId, deckIds), isNull(deckSlots.pickedPrintingId)))
    .all();
  const bySlot = new Map<number, PrintingRow>();
  for (const { slotId, printing } of rows) {
    if (!bySlot.has(slotId) || printing.lang === 'en') bySlot.set(slotId, printing);
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
        printings.printingId,
        db
          .select({ id: deckSlots.pickedPrintingId })
          .from(deckSlots)
          .where(inArray(deckSlots.deckId, deckIds)),
      ),
    )
    .all();
  const pickedById = new Map(picked.map((p) => [p.printingId, p]));
  const hinted = hintedPrintings(db, deckIds);
  const tags = slotTags(db, deckIds);
  return db
    .select()
    .from(deckSlots)
    .innerJoin(cards, eq(cards.oracleId, deckSlots.oracleId))
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

const BOARD_ORDER = { commander: 0, main: 1, maybe: 2 } as const;

/** Every slot of one deck with its status, plus the deck's counts and state. */
function workOut(deck: DeckRow, slots: SlotWithCard[], held: Holdings) {
  const box = held.boxes.get(deck.deckBoxId) ?? new Map<string, Pile>();
  // Copies in the box are shared out among the deck's slots of that card, commander first.
  const left = new Map([...box].map(([oracleId, pile]) => [oracleId, pile.quantity]));
  const order = [...slots].sort(
    (a, b) => BOARD_ORDER[a.slot.board] - BOARD_ORDER[b.slot.board] || a.slot.id - b.slot.id,
  );

  const counts: DeckCounts = { inBox: 0, free: 0, otherDecks: 0, missing: 0, basics: 0 };
  let tracked = 0;
  let filled = 0;
  let touched = 0;
  const rows = new Map<number, SlotRow>();

  for (const { slot, card, picked, printing, tags } of order) {
    const pile = box.get(card.oracleId);
    const row: SlotRow = {
      id: slot.id,
      card: cardSummary(card, held.images.get(card.oracleId)),
      board: slot.board,
      quantity: slot.quantity,
      pickedPrinting: picked ? printingSummary(picked) : null,
      printing: printing ? printingSummary(printing) : null,
      hint:
        slot.hintSetCode && slot.hintCollectorNumber
          ? {
              setCode: slot.hintSetCode,
              collectorNumber: slot.hintCollectorNumber,
              foil: slot.hintFoil,
            }
          : null,
      status: null,
      inBoxQuantity: 0,
      inBoxProxy: pile?.proxy ?? false,
      where: { locations: [], freeCount: 0, otherDecks: [] },
      tags,
    };
    rows.set(slot.id, row);
    if (slot.board === 'maybe') continue; // never pulled

    const inBox = Math.min(left.get(card.oracleId) ?? 0, slot.quantity);
    left.set(card.oracleId, (left.get(card.oracleId) ?? 0) - inBox);
    row.inBoxQuantity = inBox;

    if (card.isBasicLand) {
      row.status = 'basic';
      counts.basics += slot.quantity;
      continue;
    }

    tracked += 1;
    if (inBox > 0 || (pile?.quantity ?? 0) > 0) touched += 1;
    counts.inBox += inBox;
    if (inBox >= slot.quantity) {
      row.status = 'in_box';
      filled += 1;
      continue;
    }

    const rest = slot.quantity - inBox;
    row.where = where(deck, card.oracleId, held);
    const inOtherDecks = otherDeckCopies(deck, card.oracleId, held);
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

  const commanders = order.filter((s) => s.slot.board === 'commander').map((s) => s.card);
  const colors = new Set(commanders.flatMap((card) => [...card.colorIdentity]));
  const summary: DeckSummary = {
    id: deck.id,
    name: deck.name,
    deckBoxId: deck.deckBoxId,
    commanders: commanders.map((card) => cardSummary(card, held.images.get(card.oracleId))),
    colorIdentity: [...WUBRG].filter((color) => colors.has(color)).join(''),
    state,
    counts,
    boxCopyCount: held.boxTotals.get(deck.deckBoxId) ?? 0,
    openedAt: deck.openedAt,
  };
  return { summary, slots: slots.map((s) => rows.get(s.slot.id) as SlotRow) };
}

function otherDeckCopies(deck: DeckRow, oracleId: string, held: Holdings) {
  let total = 0;
  for (const [boxId, box] of held.boxes) {
    if (boxId !== deck.deckBoxId) total += box.get(oracleId)?.quantity ?? 0;
  }
  return total;
}

/** Storage spots with free copies (most first, then tree order) and other decks holding one. */
function where(deck: DeckRow, oracleId: string, held: Holdings): SlotRow['where'] {
  const spots = held.storage.get(oracleId) ?? new Map<number, number>();
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
    if (other && boxId !== deck.deckBoxId && (box.get(oracleId)?.quantity ?? 0) > 0) {
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
  const oracleIds = [...new Set(slots.map((s) => s.card.oracleId))];
  // Every live deck's box counts as "another deck" for the ones being worked out.
  const allLive = db.select().from(decks).where(isNull(decks.deletedAt)).all();
  const held = holdings(db, allLive, oracleIds);
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
  return { deck: summary, slots };
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
