import { inArray } from 'drizzle-orm';
import type { Db } from '../db/database';
import { cards, printings } from '../db/schema';
import { AppError } from '../errors';
import { parsePublicCode } from '../queries/cards';
import { lookupCardsByName, RiftcodexUnavailableError } from '../riftcodex/lookup';
import { nameKey } from '../riftcodex/records';
import type { CardLine } from './parse';

// Matches deck list card lines to cards: Jeff's fix, then the name key, then the public code,
// then Riftcodex's fuzzy name lookup (PLAT-3). A public code also names the line's printing.

type CardRow = typeof cards.$inferSelect;
type PrintingRow = typeof printings.$inferSelect;

export type NumberedLine = CardLine & { lineNumber: number };

export type Matches = {
  /** Each matched line's card, by line number. */
  cards: Map<number, CardRow>;
  /** The printing each line's public code names, by line number, when the app knows it. */
  printings: Map<number, PrintingRow>;
  /** Riftcodex couldn't be reached, so unknown names weren't looked up. */
  lookupFailed: boolean;
};

/** Options for the Riftcodex lookup, such as no wait between requests in tests. */
export type LookupOptions = { gapMs?: number };

function cardsById(db: Db, ids: number[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map<number, CardRow>();
  const rows = db.select().from(cards).where(inArray(cards.id, unique)).all();
  return new Map(rows.map((row) => [row.id, row]));
}

function cardsByNameKey(db: Db, keys: string[]) {
  const unique = [...new Set(keys)];
  const found = new Map<string, CardRow>();
  for (let start = 0; start < unique.length; start += 500) {
    const chunk = unique.slice(start, start + 500);
    for (const row of db.select().from(cards).where(inArray(cards.nameKey, chunk)).all()) {
      found.set(row.nameKey, row);
    }
  }
  return found;
}

const codeKey = (code: { set: string; number: string }) => `${code.set}-${code.number}`;

/** The printings these public codes name, by `codeKey`. */
function printingsByCode(db: Db, codes: string[]) {
  const parsed = codes.flatMap((code) => parsePublicCode(code) ?? []);
  const sets = [...new Set(parsed.map((code) => code.set))];
  const found = new Map<string, PrintingRow>();
  if (sets.length === 0) return found;
  const wanted = new Set(parsed.map(codeKey));
  const rows = db
    .select()
    .from(printings)
    .where(inArray(printings.setCode, sets))
    .orderBy(printings.riftcodexId)
    .all();
  for (const row of rows) {
    const code = parsePublicCode(row.publicCode);
    if (!code) continue;
    const key = codeKey(code);
    if (wanted.has(key) && !found.has(key)) found.set(key, row);
  }
  return found;
}

export async function matchLines(
  db: Db,
  lines: NumberedLine[],
  fixes: Map<number, number>,
  options: LookupOptions = {},
): Promise<Matches> {
  const matched = new Map<number, CardRow>();

  const fixedCards = cardsById(db, [...fixes.values()]);
  for (const line of lines) {
    const cardId = fixes.get(line.lineNumber);
    if (cardId === undefined) continue;
    const card = fixedCards.get(cardId);
    if (!card) {
      throw new AppError(
        400,
        'card_not_found',
        'One of these cards isn’t in the card data. Update the card data and try again.',
      );
    }
    matched.set(line.lineNumber, card);
  }

  const byName = cardsByNameKey(
    db,
    lines.map((line) => nameKey(line.name)),
  );
  const byCode = printingsByCode(
    db,
    lines.flatMap((line) => line.publicCode ?? []),
  );
  const linePrintings = new Map<number, PrintingRow>();
  for (const line of lines) {
    const code = line.publicCode ? parsePublicCode(line.publicCode) : null;
    const printing = code ? byCode.get(codeKey(code)) : undefined;
    if (printing) linePrintings.set(line.lineNumber, printing);
  }
  const byPrinting = cardsById(
    db,
    [...linePrintings.values()].map((printing) => printing.cardId),
  );
  for (const line of lines) {
    if (matched.has(line.lineNumber)) continue;
    const printing = linePrintings.get(line.lineNumber);
    const card =
      byName.get(nameKey(line.name)) ?? (printing ? byPrinting.get(printing.cardId) : undefined);
    if (card) matched.set(line.lineNumber, card);
  }

  // Names still unknown go to Riftcodex once each; what it finds is written to the card data.
  let lookupFailed = false;
  const unknown = lines.filter((line) => !matched.has(line.lineNumber));
  const names = [...new Map(unknown.map((line) => [nameKey(line.name), line.name])).values()];
  if (names.length > 0) {
    try {
      const { resolved } = await lookupCardsByName(db, names, options);
      const found = cardsById(
        db,
        resolved.map((row) => row.cardId),
      );
      const byKey = new Map<string, CardRow>();
      for (const { name, cardId } of resolved) {
        const card = found.get(cardId);
        if (card) byKey.set(nameKey(name), card);
      }
      for (const line of unknown) {
        const card = byKey.get(nameKey(line.name));
        if (card) matched.set(line.lineNumber, card);
      }
    } catch (err) {
      if (!(err instanceof RiftcodexUnavailableError)) throw err;
      lookupFailed = true;
    }
  }

  // A code naming another card's printing is still the hint, but names no printing of this card.
  for (const [lineNumber, printing] of linePrintings) {
    if (matched.get(lineNumber)?.id !== printing.cardId) linePrintings.delete(lineNumber);
  }
  return { cards: matched, printings: linePrintings, lookupFailed };
}
