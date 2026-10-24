import type { Board } from '../../shared/api/common';
import type {
  DeckChanges,
  DeckListCreate,
  DeckListLine,
  DeckListPreview,
  DeckListRequest,
  DeckListUpdated,
  ListedSlot,
  UnmatchedLine,
} from '../../shared/api/deck-lists';
import type { BoardCounts, DeckSummary, PrintingHint } from '../../shared/api/decks';
import type { Db } from '../db/database';
import type { cards, printings } from '../db/schema';
import { type LookupOptions, matchLines, type NumberedLine } from '../decklists/match';
import { type ParsedLine, parseDeckList } from '../decklists/parse';
import { PreviewStore } from '../decklists/previews';
import { AppError } from '../errors';
import { cardImages, cardSummary, printingSummary } from '../queries/card-summaries';
import { checkList } from '../queries/deck-checks';
import { BOARD_ORDER, boxCopyCount, deckSummary, deckView, findDeck } from '../queries/decks';
import { createDeck, type DeckSlotInput, replaceSlots, tagKey } from './decks';

// Making a deck from a deck list (DECK-14, DECK-15) and updating a deck from one (CHG-1). The
// preview reads the text, matches every card line and writes no deck; cards Riftcodex finds are
// saved to the card data. Create makes the deck from a kept preview with its own deck box, not
// assembled. Update replaces the deck's slots; no copies move, so when the deck box holds copies
// the swap list takes it from there (CHG-2).

type CardRow = typeof cards.$inferSelect;
type PrintingRow = typeof printings.$inferSelect;

/** One matched card line, on the board its card goes to. */
type Row = {
  lineNumber: number;
  card: CardRow;
  board: Board;
  quantity: number;
  hint: PrintingHint | null;
  printing: PrintingRow | null;
  tags: string[];
};

/** A slot the list makes: matched lines for one card on one board, added up. */
type Slot = {
  card: CardRow;
  board: Board;
  quantity: number;
  hint: PrintingHint | null;
  printing: PrintingRow | null;
  tags: string[];
  lineNumbers: number[];
};

/** What a read of the text keeps for making the deck later. */
type ReadList = {
  parsed: ParsedLine[];
  rows: Row[];
  unmatched: UnmatchedLine[];
  skips: Set<number>;
  /** False when no card line has a tag, so an update keeps the deck's tags. */
  hasTags: boolean;
  lookupFailed: boolean;
};

const previews = new PreviewStore<ReadList>();

/**
 * The board a card line's card goes to: runes and battlefields listed on the main deck (or
 * with no heading) go to their own boards, so a list without headings still reads right.
 */
function boardFor(card: CardRow, board: Board): Board {
  if (board !== 'main') return board;
  if (card.type === 'rune') return 'rune';
  if (card.type === 'battlefield') return 'battlefield';
  return 'main';
}

/** Parses and matches the text with Jeff's fixes and skips. */
async function readList(
  db: Db,
  request: DeckListRequest,
  options: LookupOptions,
): Promise<ReadList> {
  const parsed = parseDeckList(request.text);
  const skips = new Set(request.skips ?? []);
  const fixes = new Map((request.fixes ?? []).map((fix) => [fix.lineNumber, fix.cardId]));
  const cardLines = parsed.filter(
    (line): line is ParsedLine & NumberedLine =>
      line.kind === 'card' && !skips.has(line.lineNumber),
  );
  const matches = await matchLines(db, cardLines, fixes, options);
  const rows: Row[] = [];
  const unmatched: UnmatchedLine[] = [];
  for (const line of cardLines) {
    const card = matches.cards.get(line.lineNumber);
    if (!card) {
      unmatched.push({
        lineNumber: line.lineNumber,
        name: line.name,
        quantity: line.quantity,
        board: line.board,
      });
      continue;
    }
    const printing = matches.printings.get(line.lineNumber) ?? null;
    const publicCode = printing?.publicCode.split('/')[0] ?? line.publicCode;
    rows.push({
      lineNumber: line.lineNumber,
      card,
      board: boardFor(card, line.board),
      quantity: line.quantity,
      hint: publicCode ? { publicCode, foil: line.foil } : null,
      printing,
      tags: line.tags,
    });
  }
  return {
    parsed,
    rows,
    unmatched,
    skips,
    hasTags: cardLines.some((line) => line.tags.length > 0),
    lookupFailed: matches.lookupFailed,
  };
}

/**
 * The Legend the list proposes (DECK-15): the first card on the Legend board, else the first
 * Legend on the main deck.
 */
function proposedLegend(rows: Row[]): CardRow | null {
  const listed = rows.find((row) => row.board === 'legend');
  if (listed) return listed.card;
  return rows.find((row) => row.board === 'main' && row.card.type === 'legend')?.card ?? null;
}

/**
 * The Chosen Champion the list proposes (DECK-15): the first card on the champion board, else
 * the first champion unit on the main deck with the Legend's champion tag.
 */
function proposedChampion(rows: Row[], legend: CardRow | null): CardRow | null {
  const listed = rows.find((row) => row.board === 'champion');
  if (listed) return listed.card;
  const tag = legend?.championTag?.toLowerCase();
  if (!tag) return null;
  return (
    rows.find(
      (row) =>
        row.board === 'main' &&
        row.card.type === 'unit' &&
        row.card.supertype === 'champion' &&
        row.card.championTag?.toLowerCase() === tag,
    )?.card ?? null
  );
}

/**
 * The deck's slots from the matched rows, with exactly this Legend and Chosen Champion. Each
 * keeps its line on its own board when the list has it there, else takes one card from the
 * first main deck line naming it (whose printing hint and tags it gets), else is added with
 * no line. Other cards on those two boards are left out. Rows for one card on one board merge
 * into one slot, in board order, then line order.
 */
function slotsFor(rows: Row[], legendId: number | null, championId: number | null): Slot[] {
  let out = rows.map((row) => ({ ...row, lineNumbers: [row.lineNumber] }));
  const extra: Slot[] = [];
  for (const [board, cardId] of [
    ['legend', legendId],
    ['champion', championId],
  ] as const) {
    const keep = out.find((row) => row.board === board && row.card.id === cardId);
    out = out.filter((row) => row.board !== board || row === keep);
    if (keep) {
      keep.quantity = 1;
      continue;
    }
    if (cardId === null) continue;
    const from = out.find((row) => row.board === 'main' && row.card.id === cardId);
    if (from) {
      from.quantity -= 1;
      extra.push({ ...from, board, quantity: 1, lineNumbers: [from.lineNumber] });
    }
  }
  out = out.filter((row) => row.quantity > 0);

  const merged = new Map<string, Slot>();
  for (const row of [...extra, ...out].sort(
    (a, b) =>
      BOARD_ORDER[a.board] - BOARD_ORDER[b.board] ||
      (a.lineNumbers[0] ?? 0) - (b.lineNumbers[0] ?? 0),
  )) {
    const key = `${row.board}\n${row.card.id}`;
    const slot = merged.get(key);
    if (!slot) {
      merged.set(key, {
        card: row.card,
        board: row.board,
        quantity: row.quantity,
        hint: row.hint,
        printing: row.printing,
        tags: [...row.tags],
        lineNumbers: [...row.lineNumbers],
      });
      continue;
    }
    slot.quantity += row.quantity;
    if (!slot.hint && row.hint) {
      slot.hint = row.hint;
      slot.printing = row.printing;
    }
    slot.tags.push(...row.tags);
    slot.lineNumbers.push(...row.lineNumbers);
  }
  return [...merged.values()].map((slot) => ({ ...slot, tags: uniqueTags(slot.tags) }));
}

/** One tag per tag key, keeping the first spelling, sorted by name ignoring case. */
function uniqueTags(tags: string[]) {
  const byKey = new Map<string, string>();
  for (const tag of tags) if (!byKey.has(tagKey(tag))) byKey.set(tagKey(tag), tag);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function countBoards(slots: { board: Board; quantity: number }[]): BoardCounts {
  const counts: BoardCounts = {
    legend: 0,
    champion: 0,
    main: 0,
    battlefield: 0,
    rune: 0,
    sideboard: 0,
    maybe: 0,
  };
  for (const slot of slots) counts[slot.board] += slot.quantity;
  return counts;
}

function deckOrThrow(db: Db, deckId: number) {
  const deck = findDeck(db, deckId);
  if (!deck) {
    throw new AppError(404, 'deck_not_found', 'This deck was deleted or doesn’t exist.');
  }
  return deck;
}

/** The slots as the API shows them. */
function listedSlots(db: Db, slots: Slot[]): ListedSlot[] {
  const images = cardImages(db, [...new Set(slots.map((slot) => slot.card.id))]);
  return slots.map((slot) => ({
    card: cardSummary(slot.card, images.get(slot.card.id)),
    board: slot.board,
    quantity: slot.quantity,
    hint: slot.hint,
    printing: slot.printing ? printingSummary(slot.printing) : null,
    tags: slot.tags,
    lineNumbers: slot.lineNumbers,
  }));
}

/** What the new slots add, remove and change, compared with the deck's slots now. */
function compareSlots(db: Db, deckId: number, next: ListedSlot[]): DeckChanges {
  const current: ListedSlot[] = (deckView(db, deckId)?.slots ?? []).map((slot) => ({
    card: slot.card,
    board: slot.board,
    quantity: slot.quantity,
    hint: slot.hint,
    printing: slot.printing,
    tags: slot.tags,
    lineNumbers: [],
  }));
  const key = (slot: ListedSlot) => `${slot.board}\n${slot.card.id}`;
  const before = new Map(current.map((slot) => [key(slot), slot]));
  const after = new Set(next.map(key));
  const changes: DeckChanges = { added: [], removed: [], changed: [] };
  for (const slot of next) {
    const old = before.get(key(slot));
    if (!old) changes.added.push(slot);
    else if (old.quantity !== slot.quantity) {
      changes.changed.push({
        card: slot.card,
        board: slot.board,
        from: old.quantity,
        to: slot.quantity,
      });
    }
  }
  for (const slot of current) if (!after.has(key(slot))) changes.removed.push(slot);
  return changes;
}

/** Every line of the text with its kind and board. */
function previewLines(list: ReadList, slots: Slot[], deckId: number | undefined, db: Db) {
  const rowOf = new Map(list.rows.map((row) => [row.lineNumber, row]));
  const unmatched = new Set(list.unmatched.map((line) => line.lineNumber));
  const slotBoards = new Map<number, Board[]>();
  for (const slot of slots) {
    for (const lineNumber of slot.lineNumbers) {
      slotBoards.set(lineNumber, [...(slotBoards.get(lineNumber) ?? []), slot.board]);
    }
  }
  const inDeck = new Set(
    deckId === undefined
      ? []
      : (deckView(db, deckId)?.slots ?? []).map((slot) => `${slot.board}\n${slot.card.id}`),
  );
  return list.parsed.map((line): DeckListLine => {
    const base = { lineNumber: line.lineNumber, text: line.text, isNew: false };
    if (line.kind === 'blank') return { ...base, kind: 'blank', board: null };
    if (line.kind === 'heading') return { ...base, kind: 'heading', board: line.board };
    if (list.skips.has(line.lineNumber)) return { ...base, kind: 'skipped', board: line.board };
    if (unmatched.has(line.lineNumber)) return { ...base, kind: 'unmatched', board: line.board };
    const row = rowOf.get(line.lineNumber);
    const boards = slotBoards.get(line.lineNumber) ?? [];
    // A line wholly taken as the Legend or Chosen Champion shows on that board.
    const board = row && boards.includes(row.board) ? row.board : (boards[0] ?? line.board);
    const isNew =
      deckId !== undefined && row !== undefined && !inDeck.has(`${board}\n${row.card.id}`);
    return { ...base, kind: 'card', board, isNew };
  });
}

/** POST /api/deck-lists/preview: reads the list and keeps it under a preview id. */
export async function previewDeckList(
  db: Db,
  request: DeckListRequest & { deckId?: number },
  options: LookupOptions = {},
): Promise<DeckListPreview> {
  if (request.deckId !== undefined) deckOrThrow(db, request.deckId);
  const list = await readList(db, request, options);
  const legend = proposedLegend(list.rows);
  const champion = proposedChampion(list.rows, legend);
  const slots = slotsFor(list.rows, legend?.id ?? null, champion?.id ?? null);
  const listed = listedSlots(db, slots);
  const summaryOf = (card: CardRow | null) =>
    card ? (listed.find((slot) => slot.card.id === card.id)?.card ?? cardSummary(card)) : null;
  return {
    previewId: previews.put(list),
    lines: previewLines(list, slots, request.deckId, db),
    slots: listed,
    boards: countBoards(slots),
    legend: summaryOf(legend),
    champion: summaryOf(champion),
    unmatched: list.unmatched,
    checks: checkList(
      db,
      slots.map((slot) => ({ cardId: slot.card.id, board: slot.board, quantity: slot.quantity })),
    ),
    changes: request.deckId === undefined ? null : compareSlots(db, request.deckId, listed),
    lookupFailed: list.lookupFailed,
  };
}

function slotInputs(slots: Slot[], withTags: boolean): DeckSlotInput[] {
  return slots.map((slot) => ({
    cardId: slot.card.id,
    board: slot.board,
    quantity: slot.quantity,
    hint: slot.hint,
    tags: withTags ? slot.tags : undefined,
  }));
}

/**
 * POST /api/deck-lists/:previewId/create: makes the deck from the kept preview, with the Legend
 * and Chosen Champion Jeff confirmed, and its own deck box. Unmatched lines are left out.
 */
export function createFromPreview(db: Db, previewId: string, request: DeckListCreate): DeckSummary {
  const list = previews.get(previewId);
  const slots = slotsFor(list.rows, request.legendId, request.championId);
  const inputs = slotInputs(slots, true);
  // A Legend or Chosen Champion Jeff picked from outside the list is added with no line.
  for (const [board, cardId] of [
    ['legend', request.legendId],
    ['champion', request.championId],
  ] as const) {
    if (cardId !== null && !slots.some((slot) => slot.board === board)) {
      inputs.push({ cardId, board, quantity: 1 });
    }
  }
  const deckId = createDeck(db, { name: request.name, slots: inputs });
  previews.delete(previewId);
  const deck = deckSummary(db, deckId);
  if (!deck) throw new Error(`The new deck ${deckId} wasn't found`);
  return deck;
}

/** Such as "Updated Jinx Burn: 3 cards added, 1 removed, 1 changed". */
function updateMessage(name: string, changes: DeckChanges) {
  const cardCount = (slots: ListedSlot[]) => slots.reduce((n, slot) => n + slot.quantity, 0);
  const added = cardCount(changes.added);
  const removed = cardCount(changes.removed);
  const parts = [
    ...(added > 0 ? [`${added} ${added === 1 ? 'card' : 'cards'} added`] : []),
    ...(removed > 0 ? [`${removed} removed`] : []),
    ...(changes.changed.length > 0 ? [`${changes.changed.length} changed`] : []),
  ];
  return parts.length === 0
    ? `Updated ${name}: no cards changed`
    : `Updated ${name}: ${parts.join(', ')}`;
}

/**
 * POST /api/decks/:id/deck-list: replaces the deck's slots with the list's (CHG-1), with the
 * Legend and Chosen Champion the list proposes. Cards that stay keep their picked printing; a
 * list with no tags at all keeps the deck's tags. Answers whether the swap list is needed:
 * the deck box holds copies, so the deck is assembled or partly assembled (CHG-2).
 */
export async function updateFromDeckList(
  db: Db,
  deckId: number,
  request: DeckListRequest,
  options: LookupOptions = {},
): Promise<DeckListUpdated> {
  deckOrThrow(db, deckId);
  const list = await readList(db, request, options);
  const legend = proposedLegend(list.rows);
  const slots = slotsFor(
    list.rows,
    legend?.id ?? null,
    proposedChampion(list.rows, legend)?.id ?? null,
  );
  return db.transaction((tx) => {
    const deck = deckOrThrow(tx, deckId);
    const changes = compareSlots(tx, deckId, listedSlots(tx, slots));
    replaceSlots(tx, deckId, slotInputs(slots, list.hasTags));
    const summary = deckSummary(tx, deckId);
    if (!summary) throw new Error(`The deck ${deckId} wasn't found`);
    return {
      deck: summary,
      message: updateMessage(deck.name, changes),
      needsSwap: boxCopyCount(tx, deck.deckBoxId) > 0,
    };
  });
}
