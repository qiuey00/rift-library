import { sql } from 'drizzle-orm';
import {
  type Board,
  type CardSummary,
  type DeckState,
  Domain,
  type Finish,
  type LocationRef,
  type LocationType,
  type StackRow,
} from '../../shared/api/common';
import type { PrintingHint } from '../../shared/api/decks';
import type {
  MissingLine,
  PickGroup,
  PickLine,
  PickList,
  RuneLine,
} from '../../shared/api/pick-list';
import type { Db } from '../db/database';
import {
  type CardRecord,
  cardColumnsSql,
  type PrintingRecord,
  printingColumnsSql,
  toCardSummary,
  toPrintingSummary,
} from './card-summaries';
import { BOARD_ORDER, isRune as isRuneCard } from './decks';
import { locationPaths, locationTradeFlags } from './locations';
import { stackValue, unitPriceSql } from './value';

// The pick list: one walk past each location to pull a deck's missing copies into its deck
// box. It is worked out every time it opens and never stored, so it shows only what is left.
//
// Storage is every live location that isn't a deck box. Copies of a card are copy stacks of
// any printing, and proxies count like real copies. Runes are never tracked (D-15), so they
// are only counts to add. The swap list reuses `pickList`.

type DeckRecord = { id: number; name: string; deckBoxId: number };

type SlotRecord = CardRecord & {
  id: number;
  deckId: number;
  board: Board;
  quantity: number;
  pickedPrintingId: string | null;
  hintPublicCode: string | null;
  hintFoil: number;
};

type StackRecord = PrintingRecord & {
  stackId: number;
  quantity: number;
  finish: Finish;
  condition: string;
  language: string;
  misprint: number;
  altered: number;
  isProxy: number;
  locationId: number;
  cameFromLocationId: number | null;
  cardId: number;
  unitPrice: number | null;
};

/** Where copies sit and what every row needs to know about locations, loaded once. */
type World = {
  /** Every location (deleted ones too, so a came-from can still be named). */
  refs: Map<number, LocationRef>;
  /** Live location ids by their place in tree order. */
  treeIndex: Map<number, number>;
  /** Live decks by their deck box id. */
  deckByBox: Map<number, DeckRecord>;
  /** Every slot of every live deck, in board order, then by id. */
  slotsByDeck: Map<number, SlotRecord[]>;
  /**
   * card id → every stack of the card in a live location, for the deck's own cards, plus
   * every stack in a deck box (what other decks' states are worked out from).
   */
  stacksByCard: Map<number, StackRecord[]>;
};

const isRune = (slot: SlotRecord) => isRuneCard(slot, slot.board);

/** Runes close the list in domain order (Fury, Calm, Mind, Body, Chaos, Order), then by name. */
function runeOrder(a: RuneLine, b: RuneLine): number {
  const domainOf = (line: RuneLine) => {
    const [domain] = line.card.domains;
    return domain ? Domain.options.indexOf(domain) : Domain.options.length;
  };
  return domainOf(a) - domainOf(b) || a.card.name.localeCompare(b.card.name);
}

/**
 * Loads what one deck's pick list reads. Stacks are only read for the deck's own
 * cards (and stacks in deck boxes), so the answer stays quick with a big collection.
 */
function loadWorld(db: Db, deckId: number): World {
  const paths = locationPaths(db);
  const treeIndex = new Map([...paths.keys()].map((id, index) => [id, index]));

  const locationRows = db.all<{
    id: number;
    name: string;
    type: LocationType;
    parentId: number | null;
    color: string | null;
  }>(sql`SELECT id, name, type, parent_id AS parentId, color FROM locations`);
  const byId = new Map(locationRows.map((row) => [row.id, row]));
  const trade = locationTradeFlags(db);
  const colorOf = (id: number | null): string | null => {
    for (let seen = 0; id !== null && seen <= byId.size; seen += 1) {
      const row = byId.get(id);
      if (!row) return null;
      if (row.color !== null) return row.color;
      id = row.parentId;
    }
    return null;
  };
  const refs = new Map<number, LocationRef>(
    locationRows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        type: row.type,
        // A deleted location (still named as a came-from) has no tree path; its name stands in.
        path: paths.get(row.id) ?? row.name,
        color: colorOf(row.id),
        forTrade: trade.get(row.id) ?? false,
      },
    ]),
  );

  const liveDecks = db.all<DeckRecord>(
    sql`SELECT id, name, deck_box_id AS deckBoxId FROM decks WHERE deleted_at IS NULL`,
  );
  const deckByBox = new Map(liveDecks.map((deck) => [deck.deckBoxId, deck]));

  const slotsByDeck = new Map<number, SlotRecord[]>();
  for (const slot of db.all<SlotRecord>(sql`
    SELECT
      s.id, s.deck_id AS deckId, s.board, s.quantity,
      s.picked_printing_id AS pickedPrintingId, s.hint_public_code AS hintPublicCode,
      s.hint_foil AS hintFoil, ${cardColumnsSql}
    FROM deck_slots AS s
    JOIN decks AS d ON d.id = s.deck_id AND d.deleted_at IS NULL
    JOIN cards AS c ON c.id = s.card_id`)) {
    const list = slotsByDeck.get(slot.deckId) ?? [];
    list.push(slot);
    slotsByDeck.set(slot.deckId, list);
  }
  for (const list of slotsByDeck.values()) {
    list.sort((a, b) => BOARD_ORDER[a.board] - BOARD_ORDER[b.board] || a.id - b.id);
  }

  const stacksByCard = new Map<number, StackRecord[]>();
  for (const stack of db.all<StackRecord>(sql`
    SELECT
      s.id AS stackId, s.quantity, s.finish, s.condition, s.language, s.misprint, s.altered,
      s.is_proxy AS isProxy, s.location_id AS locationId,
      s.came_from_location_id AS cameFromLocationId,
      p.card_id AS cardId, ${printingColumnsSql}, ${unitPriceSql} AS unitPrice
    FROM copy_stacks AS s
    JOIN printings AS p ON p.riftcodex_id = s.printing_id
    WHERE p.card_id IN (SELECT card_id FROM deck_slots WHERE deck_id = ${deckId})
      OR s.location_id IN (SELECT id FROM locations WHERE type = 'deck_box')
    ORDER BY s.id`)) {
    if (!treeIndex.has(stack.locationId)) continue; // in a deleted location
    const list = stacksByCard.get(stack.cardId) ?? [];
    list.push(stack);
    stacksByCard.set(stack.cardId, list);
  }

  return { refs, treeIndex, deckByBox, slotsByDeck, stacksByCard };
}

function cardOf(slot: SlotRecord): CardSummary {
  return toCardSummary(slot);
}

function stackRow(stack: StackRecord, card: CardSummary, world: World): StackRow {
  const location = world.refs.get(stack.locationId);
  if (!location) throw new Error(`Location ${stack.locationId} is missing.`);
  const deck = location.type === 'deck_box' ? world.deckByBox.get(location.id) : undefined;
  return {
    stackId: stack.stackId,
    quantity: stack.quantity,
    card: { ...card, imageUrl: stack.imageUrl },
    printing: toPrintingSummary(stack),
    finish: stack.finish,
    condition: stack.condition,
    language: stack.language,
    misprint: stack.misprint === 1,
    altered: stack.altered === 1,
    isProxy: stack.isProxy === 1,
    location,
    cameFrom:
      stack.cameFromLocationId === null ? null : (world.refs.get(stack.cameFromLocationId) ?? null),
    inDeck: deck ? { deckId: deck.id, deckName: deck.name } : null,
    unitPrice: stack.unitPrice,
    value: stackValue(stack.quantity, stack.unitPrice, stack.isProxy === 1),
  };
}

function hintOf(slot: SlotRecord): PrintingHint | null {
  return slot.hintPublicCode
    ? { publicCode: slot.hintPublicCode, foil: slot.hintFoil === 1 }
    : null;
}

/** True when the stack is the decklist's printing: the picked printing, otherwise the hint. */
function isListedPrinting(slot: SlotRecord, stack: StackRecord): boolean {
  if (slot.pickedPrintingId) return stack.printingId === slot.pickedPrintingId;
  const hint = hintOf(slot);
  if (!hint) return false;
  const code = stack.publicCode.toLowerCase();
  const wanted = hint.publicCode.toLowerCase();
  return (
    (code === wanted || code.startsWith(`${wanted}/`)) && (!hint.foil || stack.finish === 'foil')
  );
}

/** Copies of each card in each deck box, shared out among a deck's slots of that card, in board order. */
function boxCopies(world: World, deckBoxId: number): Map<number, number> {
  const inBox = new Map<number, number>();
  for (const [cardId, stacks] of world.stacksByCard) {
    for (const stack of stacks) {
      if (stack.locationId === deckBoxId) {
        inBox.set(cardId, (inBox.get(cardId) ?? 0) + stack.quantity);
      }
    }
  }
  return inBox;
}

/** How many copies each slot still needs, after the copies already in the deck box. */
function needs(world: World, deck: DeckRecord) {
  const left = boxCopies(world, deck.deckBoxId);
  const result: { slot: SlotRecord; needed: number }[] = [];
  for (const slot of world.slotsByDeck.get(deck.id) ?? []) {
    if (slot.board === 'maybe') continue; // never pulled
    const inBox = Math.min(left.get(slot.cardId) ?? 0, slot.quantity);
    left.set(slot.cardId, (left.get(slot.cardId) ?? 0) - inBox);
    result.push({ slot, needed: slot.quantity - inBox });
  }
  return result;
}

/**
 * The deck's state from where copies are: not assembled while none of its tracked cards is in
 * its box, assembled once every tracked slot is filled, partly assembled in between.
 */
function deckState(world: World, deck: DeckRecord): DeckState {
  const inBox = boxCopies(world, deck.deckBoxId);
  let tracked = 0;
  let filled = 0;
  let touched = 0;
  for (const { slot, needed } of needs(world, deck)) {
    if (isRune(slot)) continue;
    tracked += 1;
    if (needed === 0) filled += 1;
    if ((inBox.get(slot.cardId) ?? 0) > 0) touched += 1;
  }
  if (touched === 0) return 'not_assembled';
  return filled === tracked ? 'assembled' : 'partly_assembled';
}

/** The state a live deck is in now; undefined when there is no such deck. */
export function assemblyDeck(db: Db, deckId: number) {
  const world = loadWorld(db, deckId);
  const deck = [...world.deckByBox.values()].find((d) => d.id === deckId);
  if (!deck) return undefined;
  return { id: deck.id, name: deck.name, state: deckState(world, deck), deckBoxId: deck.deckBoxId };
}

type Choice = { stack: StackRecord; quantity: number };

/** True when the stack sits in a location for trade (marked itself or inside one marked). */
function inTrade(stack: StackRecord, world: World): boolean {
  return world.refs.get(stack.locationId)?.forTrade ?? false;
}

/**
 * Ranks candidate stacks for a slot: copies for trade last, then the decklist's printing
 * first, then real before proxy, then a location already on the route, then location-tree
 * order.
 */
function rank(slot: SlotRecord, stacks: StackRecord[], route: Set<number>, world: World) {
  const key = (stack: StackRecord) => [
    inTrade(stack, world) ? 1 : 0,
    isListedPrinting(slot, stack) ? 0 : 1,
    stack.isProxy === 1 ? 1 : 0,
    route.has(stack.locationId) ? 0 : 1,
    world.treeIndex.get(stack.locationId) ?? Number.MAX_SAFE_INTEGER,
    stack.stackId,
  ];
  return [...stacks].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  });
}

/** Takes up to `needed` copies from the pool, best stack first, re-ranking after each stack. */
function take(
  slot: SlotRecord,
  pool: StackRecord[],
  needed: number,
  route: Set<number>,
  left: Map<number, number>,
  world: World,
): Choice[] {
  const choices: Choice[] = [];
  let rest = needed;
  while (rest > 0) {
    const open = pool.filter((stack) => (left.get(stack.stackId) ?? 0) > 0);
    const [best] = rank(slot, open, route, world);
    if (!best) break;
    const quantity = Math.min(rest, left.get(best.stackId) ?? 0);
    left.set(best.stackId, (left.get(best.stackId) ?? 0) - quantity);
    route.add(best.locationId);
    choices.push({ stack: best, quantity });
    rest -= quantity;
  }
  return choices;
}

/** Works out a live deck's pick list; undefined when there is no such deck. */
export function pickList(db: Db, deckId: number): PickList | undefined {
  const world = loadWorld(db, deckId);
  const deck = [...world.deckByBox.values()].find((d) => d.id === deckId);
  if (!deck) return undefined;

  const isStorage = (stack: StackRecord) => world.refs.get(stack.locationId)?.type !== 'deck_box';
  const otherDeckOf = (stack: StackRecord) =>
    stack.locationId === deck.deckBoxId ? undefined : world.deckByBox.get(stack.locationId);

  const runes = new Map<number, RuneLine>();
  const wanted: { slot: SlotRecord; card: CardSummary; needed: number }[] = [];
  for (const { slot, needed } of needs(world, deck)) {
    if (needed <= 0) continue;
    const card = cardOf(slot);
    if (isRune(slot)) {
      const line = runes.get(slot.cardId) ?? { card, quantity: 0 };
      line.quantity += needed;
      runes.set(slot.cardId, line);
    } else {
      wanted.push({ slot, card, needed });
    }
  }

  // Copies left in each stack as lines claim them (one card can fill a main and a sideboard slot).
  const left = new Map<number, number>();
  for (const stacks of world.stacksByCard.values()) {
    for (const stack of stacks) left.set(stack.stackId, stack.quantity);
  }
  const storageOf = (slot: SlotRecord) =>
    (world.stacksByCard.get(slot.cardId) ?? []).filter(isStorage);
  // Copies for trade are offered only once no other copy is free, other decks' boxes included.
  // A deck box can't be marked for trade, so copies in deck boxes are never trade copies here.
  const isTrade = (stack: StackRecord) => isStorage(stack) && inTrade(stack, world);
  const locationCount = (slot: SlotRecord) =>
    new Set(storageOf(slot).map((s) => s.locationId)).size;

  // The route: slots whose copies all sit in one location fix their stops first, then the rest
  // (fewest places first) prefer locations already on it.
  const route = new Set<number>();
  const order = [...wanted].sort((a, b) => {
    const single = (w: (typeof wanted)[number]) => (locationCount(w.slot) === 1 ? 0 : 1);
    return single(a) - single(b) || locationCount(a.slot) - locationCount(b.slot);
  });

  const storageLines = new Map<number, Choice[]>();
  const otherLines = new Map<number, Choice[]>();
  const missingBySlot = new Map<number, number>();
  for (const { slot, needed } of order) {
    const storage = storageOf(slot);
    const fromStorage = take(
      slot,
      storage.filter((s) => !isTrade(s)),
      needed,
      route,
      left,
      world,
    );
    let rest = needed - fromStorage.reduce((n, c) => n + c.quantity, 0);
    const others = (world.stacksByCard.get(slot.cardId) ?? []).filter((s) => otherDeckOf(s));
    const fromOthers = rest > 0 ? take(slot, others, rest, new Set(), left, world) : [];
    rest -= fromOthers.reduce((n, c) => n + c.quantity, 0);
    const fromTrade = rest > 0 ? take(slot, storage.filter(isTrade), rest, route, left, world) : [];
    rest -= fromTrade.reduce((n, c) => n + c.quantity, 0);
    storageLines.set(slot.id, [...fromStorage, ...fromTrade]);
    otherLines.set(slot.id, fromOthers);
    if (rest > 0) missingBySlot.set(slot.id, rest);
  }

  const states = new Map<number, DeckState>();
  const stateOf = (other: DeckRecord) => {
    let state = states.get(other.id);
    if (!state) {
      state = deckState(world, other);
      states.set(other.id, state);
    }
    return state;
  };

  const groups = new Map<number, PickLine[]>();
  const otherDecks: PickLine[] = [];
  const missing: MissingLine[] = [];
  for (const { slot, card } of wanted) {
    const storage = storageLines.get(slot.id) ?? [];
    const fromOthers = otherLines.get(slot.id) ?? [];
    const used = new Set([...storage, ...fromOthers].map((c) => c.stack.stackId));
    const alternativesIn = (pool: StackRecord[]) =>
      rank(
        slot,
        pool.filter((s) => !used.has(s.stackId)),
        route,
        world,
      ).map((s) => stackRow(s, card, world));
    const storageAlternatives = alternativesIn(storageOf(slot));
    const otherAlternatives = alternativesIn(
      (world.stacksByCard.get(slot.cardId) ?? []).filter((s) => otherDeckOf(s)),
    );

    let number = 0;
    const lineFor = (choice: Choice, alternatives: StackRow[]): PickLine => {
      number += 1;
      return {
        key: `${slot.id}-${number}`,
        slotId: slot.id,
        card,
        quantity: choice.quantity,
        suggested: stackRow(choice.stack, card, world),
        alternatives,
        fromDeck: null,
        fromTrade: isTrade(choice.stack),
      };
    };

    for (const choice of storage) {
      const lines = groups.get(choice.stack.locationId) ?? [];
      lines.push(lineFor(choice, storageAlternatives));
      groups.set(choice.stack.locationId, lines);
    }
    for (const choice of fromOthers) {
      const other = otherDeckOf(choice.stack) as DeckRecord;
      otherDecks.push({
        ...lineFor(choice, otherAlternatives),
        fromDeck: { id: other.id, name: other.name, becomesPartly: stateOf(other) === 'assembled' },
      });
    }
    const short = missingBySlot.get(slot.id);
    if (short) missing.push({ slotId: slot.id, card, quantity: short, hint: hintOf(slot) });
  }

  const pickGroups: PickGroup[] = [...groups]
    .sort(([a], [b]) => (world.treeIndex.get(a) ?? 0) - (world.treeIndex.get(b) ?? 0))
    .map(([locationId, lines]) => ({
      location: world.refs.get(locationId) as LocationRef,
      cardCount: lines.reduce((n, line) => n + line.quantity, 0),
      lines,
    }));

  const walked = [...pickGroups.flatMap((group) => group.lines), ...otherDecks];
  return {
    groups: pickGroups,
    otherDecks,
    missing,
    runes: [...runes.values()].sort(runeOrder),
    totals: { lines: walked.length, cards: walked.reduce((n, line) => n + line.quantity, 0) },
  };
}
