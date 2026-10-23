import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Finish } from '../../../shared/api/common';
import type { DeckExportQuery, MoxfieldExport } from '../../../shared/api/exports';
import type { Db } from '../../db/database';
import { cards, copyStacks, deckSlots, deckSlotTags, locations, printings } from '../../db/schema';
import { AppError } from '../../errors';
import { findDeck } from '../../queries/decks';
import { descendantIds, locationPath } from '../../queries/locations';
import {
  byName,
  type MoxfieldCardLine,
  moxfieldLine,
  moxfieldText,
  textFileName,
} from './moxfield-format';

// A deck or a location as Moxfield's import text (EXP-1, EXP-2). Nothing is written here.

/**
 * The commander(s), then the main deck, then "SIDEBOARD:" and the maybe board, each by name.
 * Each line names the picked printing, else the printing hint, else no printing.
 */
export function deckMoxfieldExport(db: Db, deckId: number, query: DeckExportQuery): MoxfieldExport {
  const deck = findDeck(db, deckId);
  if (!deck) throw new AppError(404, 'deck_not_found', 'This deck was deleted or doesn’t exist.');

  const slots = db
    .select({
      id: deckSlots.id,
      board: deckSlots.board,
      quantity: deckSlots.quantity,
      name: cards.name,
      pickedScryfallId: deckSlots.pickedScryfallId,
      pickedSetCode: printings.setCode,
      pickedCollectorNumber: printings.collectorNumber,
      hintSetCode: deckSlots.hintSetCode,
      hintCollectorNumber: deckSlots.hintCollectorNumber,
      hintFoil: deckSlots.hintFoil,
    })
    .from(deckSlots)
    .innerJoin(cards, eq(cards.oracleId, deckSlots.oracleId))
    .leftJoin(printings, eq(printings.scryfallId, deckSlots.pickedScryfallId))
    .where(eq(deckSlots.deckId, deck.id))
    .all();

  const tags = new Map<number, string[]>();
  if (query.tags === '1' && slots.length > 0) {
    const rows = db
      .select({ slotId: deckSlotTags.slotId, tagKey: deckSlotTags.tagKey })
      .from(deckSlotTags)
      .where(
        inArray(
          deckSlotTags.slotId,
          slots.map((slot) => slot.id),
        ),
      )
      .orderBy(asc(deckSlotTags.tagKey))
      .all();
    for (const { slotId, tagKey } of rows) tags.set(slotId, [...(tags.get(slotId) ?? []), tagKey]);
  }

  const boxFinishes = pickedFinishes(db, deck.deckBoxId);
  const parts = { commander: [], main: [], maybe: [] } as Record<
    (typeof slots)[number]['board'],
    MoxfieldCardLine[]
  >;
  for (const slot of slots) {
    const picked =
      slot.pickedScryfallId && slot.pickedSetCode && slot.pickedCollectorNumber
        ? { setCode: slot.pickedSetCode, collectorNumber: slot.pickedCollectorNumber }
        : null;
    const hint =
      slot.hintSetCode && slot.hintCollectorNumber
        ? { setCode: slot.hintSetCode, collectorNumber: slot.hintCollectorNumber }
        : null;
    const hintFinish: Finish = slot.hintFoil ? 'foil' : 'nonfoil';
    parts[slot.board].push({
      quantity: slot.quantity,
      name: slot.name,
      printing: picked ?? hint,
      // A picked printing's finish is the one its copies in the deck box have.
      finish: (picked && boxFinishes.get(slot.pickedScryfallId ?? '')) || hintFinish,
      tags: tags.get(slot.id) ?? [],
    });
  }

  const deckLines = [...parts.commander.sort(byName), ...parts.main.sort(byName)];
  const maybeLines = query.maybe === '1' ? parts.maybe.sort(byName) : [];
  const text = [
    ...deckLines.map(moxfieldLine),
    ...(maybeLines.length > 0 ? ['', 'SIDEBOARD:', ...maybeLines.map(moxfieldLine)] : []),
  ];
  return {
    fileName: textFileName(deck.name),
    text: moxfieldText(text),
    cardCount: total(deckLines),
    maybeCount: total(maybeLines),
    lineCount: deckLines.length + maybeLines.length,
  };
}

/** The finish most copies of each printing in the deck box have, by Scryfall id. */
function pickedFinishes(db: Db, deckBoxId: number): Map<string, Finish> {
  const rows = db
    .select({
      scryfallId: copyStacks.scryfallId,
      finish: copyStacks.finish,
      quantity: sql<number>`sum(${copyStacks.quantity})`,
    })
    .from(copyStacks)
    .where(eq(copyStacks.locationId, deckBoxId))
    .groupBy(copyStacks.scryfallId, copyStacks.finish)
    .orderBy(asc(sql`sum(${copyStacks.quantity})`))
    .all();
  // Fewest first, so the finish with the most copies is set last.
  return new Map(rows.map((row) => [row.scryfallId, row.finish]));
}

/**
 * Every real (not proxy) copy in the location and the locations inside it: one line per
 * printing and finish with the quantities added up, by name.
 */
export function locationMoxfieldExport(db: Db, locationId: number): MoxfieldExport {
  const location = db
    .select({ name: locations.name })
    .from(locations)
    .where(eq(locations.id, locationId))
    .get();
  if (!location || locationPath(db, locationId) === null) {
    throw new AppError(404, 'location_not_found', 'That location no longer exists.');
  }

  const lines: MoxfieldCardLine[] = db
    .select({
      name: cards.name,
      setCode: printings.setCode,
      collectorNumber: printings.collectorNumber,
      finish: copyStacks.finish,
      quantity: sql<number>`sum(${copyStacks.quantity})`,
    })
    .from(copyStacks)
    .innerJoin(printings, eq(printings.scryfallId, copyStacks.scryfallId))
    .innerJoin(cards, eq(cards.oracleId, printings.oracleId))
    .where(
      and(
        inArray(copyStacks.locationId, [locationId, ...descendantIds(db, locationId)]),
        eq(copyStacks.isProxy, false),
      ),
    )
    .groupBy(copyStacks.scryfallId, copyStacks.finish)
    .all()
    .map((row) => ({
      quantity: row.quantity,
      name: row.name,
      printing: { setCode: row.setCode, collectorNumber: row.collectorNumber },
      finish: row.finish,
    }))
    .sort(byName);

  return {
    fileName: textFileName(location.name),
    text: moxfieldText(lines.map(moxfieldLine)),
    cardCount: total(lines),
    maybeCount: 0,
    lineCount: lines.length,
  };
}

const total = (lines: MoxfieldCardLine[]) => lines.reduce((sum, line) => sum + line.quantity, 0);
