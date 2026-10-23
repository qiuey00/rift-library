import { eq } from 'drizzle-orm';
import type { Board } from '../../../shared/api/common';
import type { ParsedSlot } from '../../../shared/api/moxfield';
import type {
  DeckChanges,
  MoxfieldUpdateApplyRequest,
  MoxfieldUpdateApplyResult,
  MoxfieldUpdatePreview,
} from '../../../shared/api/moxfield-update';
import type { Db } from '../../db/database';
import { cards, deckSlots, imports } from '../../db/schema';
import { AppError } from '../../errors';
import { boxCopyCount, cardImages, cardSummary, findDeck } from '../../queries/decks';
import { replaceSlots } from '../decks';
import { type MoxfieldChoices, previewMoxfieldDeck, refuseUnmatched, slotKey } from './moxfield';

// Updating a deck from a fresh Moxfield export (CHG-1). The preview reads the text as the
// new-deck preview does and compares it with the deck's current slots; apply replaces the slots,
// and cards that stay keep their picked printing. No copies move: when the deck box holds copies,
// the swap list takes it from there.

const boardOrder: Record<Board, number> = { commander: 0, main: 1, maybe: 2 };

function deckOrThrow(db: Db, deckId: number) {
  const deck = findDeck(db, deckId);
  if (!deck) {
    throw new AppError(404, 'deck_not_found', 'This deck was deleted or doesn’t exist.');
  }
  return deck;
}

/** The deck's slots as they are now, commander first, then by board and name. */
function currentSlots(db: Db, deckId: number): ParsedSlot[] {
  const rows = db
    .select({ slot: deckSlots, card: cards })
    .from(deckSlots)
    .innerJoin(cards, eq(cards.oracleId, deckSlots.oracleId))
    .where(eq(deckSlots.deckId, deckId))
    .all();
  const images = cardImages(db, [...new Set(rows.map((row) => row.card.oracleId))]);
  return rows
    .map(({ slot, card }) => ({
      card: cardSummary(card, images.get(card.oracleId)),
      board: slot.board,
      quantity: slot.quantity,
      hint:
        slot.hintSetCode && slot.hintCollectorNumber
          ? {
              setCode: slot.hintSetCode,
              collectorNumber: slot.hintCollectorNumber,
              foil: slot.hintFoil,
            }
          : null,
    }))
    .sort(
      (a, b) => boardOrder[a.board] - boardOrder[b.board] || a.card.name.localeCompare(b.card.name),
    );
}

/** What the new slots add, remove and change, compared with the current ones. */
export function compareSlots(current: ParsedSlot[], next: ParsedSlot[]): DeckChanges {
  const before = new Map(current.map((slot) => [slotKey(slot.board, slot.card.oracleId), slot]));
  const after = new Map(next.map((slot) => [slotKey(slot.board, slot.card.oracleId), slot]));
  const changes: DeckChanges = { added: [], removed: [], changed: [] };
  for (const [key, slot] of after) {
    const old = before.get(key);
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
  for (const [key, slot] of before) {
    if (!after.has(key)) changes.removed.push(slot);
  }
  return changes;
}

/** Reads the text with Jeff's choices and says what it would change in the deck. Writes no deck. */
export async function previewMoxfieldUpdate(
  db: Db,
  deckId: number,
  text: string,
  choices: MoxfieldChoices = {},
): Promise<MoxfieldUpdatePreview> {
  deckOrThrow(db, deckId);
  const { cardLineCount, skippedCount, lineCards, slotTags, ...preview } =
    await previewMoxfieldDeck(db, text, choices);
  const current = currentSlots(db, deckId);
  const inDeck = new Set(current.map((slot) => slot.card.oracleId));
  return {
    ...preview,
    lines: preview.lines.map((line) => {
      const oracleId = lineCards.get(line.lineNo);
      return oracleId && !inDeck.has(oracleId) ? { ...line, isNew: true } : line;
    }),
    changes: compareSlots(current, preview.slots),
  };
}

/** Replaces the deck's slots with the text's and writes the imports row, in one transaction. */
export async function applyMoxfieldUpdate(
  db: Db,
  request: MoxfieldUpdateApplyRequest,
): Promise<MoxfieldUpdateApplyResult> {
  const deck = deckOrThrow(db, request.deckId);
  const preview = await previewMoxfieldDeck(db, request.text, request);
  refuseUnmatched(preview);
  return db.transaction((tx) => {
    const changes = compareSlots(currentSlots(tx, deck.id), preview.slots);
    replaceSlots(
      tx,
      deck.id,
      preview.slots.map((slot) => ({
        oracleId: slot.card.oracleId,
        board: slot.board,
        quantity: slot.quantity,
        hint: slot.hint,
        tags: preview.slotTags?.get(slotKey(slot.board, slot.card.oracleId)),
      })),
    );
    tx.insert(imports)
      .values({
        kind: 'moxfield_update',
        deckId: deck.id,
        rowCount: preview.cardLineCount,
        cardCount: preview.slots.reduce((total, slot) => total + slot.quantity, 0),
        skippedCount: preview.skippedCount,
      })
      .run();
    return {
      deckId: deck.id,
      message: updateMessage(deck.name, changes),
      needsSwap: boxCopyCount(tx, deck.deckBoxId) > 0,
    };
  });
}

/** Such as "Updated Hearthhull: 2 cards in, 2 out". */
function updateMessage(name: string, changes: DeckChanges) {
  const sum = (slots: ParsedSlot[]) => slots.reduce((total, slot) => total + slot.quantity, 0);
  const cardsIn =
    sum(changes.added) +
    changes.changed.reduce((total, row) => total + Math.max(row.to - row.from, 0), 0);
  const cardsOut =
    sum(changes.removed) +
    changes.changed.reduce((total, row) => total + Math.max(row.from - row.to, 0), 0);
  if (cardsIn === 0 && cardsOut === 0) return `Updated ${name}: no cards changed`;
  return `Updated ${name}: ${cardsIn} ${cardsIn === 1 ? 'card' : 'cards'} in, ${cardsOut} out`;
}
