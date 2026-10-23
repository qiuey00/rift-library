import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Board } from '../../../shared/api/common';
import type {
  LineFixes,
  MoxfieldCreateRequest,
  MoxfieldCreateResult,
  MoxfieldLineTag,
  MoxfieldPreview,
  ParsedSlot,
} from '../../../shared/api/moxfield';
import type { Db } from '../../db/database';
import { cards, imports, printings } from '../../db/schema';
import { AppError } from '../../errors';
import { cardImages, cardSummary } from '../../queries/decks';
import { lookupCards, ScryfallUnavailableError } from '../../scryfall/lookup';
import { createDeck } from '../decks';
import { type MoxfieldLine, mergeSlots, normalizeName, parseMoxfieldText } from './moxfield-parse';

// Making a deck from a Moxfield export. The preview reads the text and writes no deck (cards
// Scryfall finds are saved to the card data); create runs the same steps and saves the deck.
// A deck starts as a decklist only: no copies move.

type CardRow = typeof cards.$inferSelect;

export type MoxfieldChoices = {
  /** Leave out to let the server propose the commander. */
  commanders?: string[];
  fixes?: LineFixes;
  skips?: number[];
};

/** What the text makes, with the card rows behind it, for saving the deck. */
export type MoxfieldDeckImport = MoxfieldPreview & {
  /** Lines with a card, skipped lines left out. */
  cardLineCount: number;
  skippedCount: number;
  /** Each matched card line's card, as line number to oracle id. */
  lineCards: Map<number, string>;
  /**
   * Each slot's tags by `slotKey`, or undefined when no card line has a tag (a plain export),
   * so Update from Moxfield keeps the deck's tags.
   */
  slotTags: Map<string, string[]> | undefined;
};

/** The key of a slot in `slotTags`. */
export const slotKey = (board: Board, oracleId: string) => `${board}\n${oracleId}`;

/** Reads the text with Jeff's choices into the deck it would make. */
export async function previewMoxfieldDeck(
  db: Db,
  text: string,
  choices: MoxfieldChoices = {},
): Promise<MoxfieldDeckImport> {
  const parsed = parseMoxfieldText(text);
  const skips = new Set(choices.skips ?? []);
  const fixes = choices.fixes ?? {};
  const cardLines = parsed.lines.filter((line) => line.kind === 'card' && !skips.has(line.lineNo));

  // Each card line's card: Jeff's fix, else its name in the card data (the card's name or a
  // printing's flavor name), else the printing at its set code and collector number, else
  // Scryfall's answer for either.
  const fixed = fixedCards(db, cardLines, fixes);
  const byLine = new Map<number, CardRow>(fixed);
  const { byName, flavorPrintings } = matchNames(
    db,
    cardLines.filter((line) => !fixed.has(line.lineNo)).map((line) => line.name ?? ''),
  );
  const unnamed = cardLines.filter(
    (line) => !fixed.has(line.lineNo) && !byName.has(normalizeName(line.name ?? '')),
  );
  const bySet = new Map<number, CardRow>();
  for (const line of unnamed) {
    const card = line.setCode && line.collectorNumber ? printingCard(db, line) : undefined;
    if (card) bySet.set(line.lineNo, card);
  }
  const unknown = [...new Set(unnamed.map((line) => lookupName(line.name ?? '')))];
  const unknownPrintings = unnamed.flatMap((line) =>
    line.setCode && line.collectorNumber && !bySet.has(line.lineNo)
      ? [{ set: line.setCode, collector_number: line.collectorNumber }]
      : [],
  );
  let lookupFailed = false;
  if (unknown.length > 0) {
    try {
      const { resolved } = await lookupCards(db, [
        ...unknown.map((name) => ({ name })),
        ...unknownPrintings,
      ]);
      const found = cardsById(
        db,
        resolved.map((card) => card.oracleId),
      );
      const byPrinting = new Map<string, CardRow>();
      for (const { identifier, oracleId } of resolved) {
        const card = found.get(oracleId);
        if (!card) continue;
        if ('name' in identifier) byName.set(normalizeName(identifier.name), card);
        if ('set' in identifier) {
          byPrinting.set(printingKey(identifier.set, identifier.collector_number), card);
        }
      }
      for (const line of unnamed) {
        const card = byPrinting.get(printingKey(line.setCode ?? '', line.collectorNumber ?? ''));
        if (card && !bySet.has(line.lineNo)) bySet.set(line.lineNo, card);
      }
    } catch (err) {
      if (!(err instanceof ScryfallUnavailableError)) throw err;
      lookupFailed = true;
    }
  }
  for (const line of cardLines) {
    const card = byName.get(normalizeName(line.name ?? '')) ?? bySet.get(line.lineNo);
    if (!byLine.has(line.lineNo) && card) byLine.set(line.lineNo, card);
  }

  // A line named by a printing's flavor name, with no set code, hints at that printing.
  const withPrinting = (line: MoxfieldLine): MoxfieldLine => {
    const printing = flavorPrintings.get(normalizeName(line.name ?? ''));
    return line.setCode || !printing || fixed.has(line.lineNo) ? line : { ...line, ...printing };
  };

  // The commanders: Jeff's choice, else the parser's proposal when that card can lead the deck.
  let commanders: CardRow[];
  if (choices.commanders) {
    const chosen = cardsById(db, choices.commanders);
    commanders = choices.commanders.map((oracleId) => {
      const card = chosen.get(oracleId);
      if (!card) throw cardNotFound();
      return card;
    });
  } else {
    const proposed = cardLines.flatMap((line) => {
      const card = byLine.get(line.lineNo);
      return line.isCommanderProposal && card ? [card] : [];
    });
    commanders = proposed.filter((card) => canLead(card, proposed));
  }

  // Each commander takes one card from the first main board line naming it, if there is one.
  const taken = new Map<number, number>();
  const commanderHints = new Map<string, ParsedSlot['hint']>();
  const tags = new Map<string, string[]>();
  for (const commander of commanders) {
    const line = cardLines.find(
      (candidate) =>
        candidate.board === 'main' &&
        byLine.get(candidate.lineNo)?.oracleId === commander.oracleId &&
        !taken.has(candidate.lineNo),
    );
    commanderHints.set(commander.oracleId, line ? hintOf(withPrinting(line)) : null);
    tags.set(slotKey('commander', commander.oracleId), line?.tags ?? []);
    if (line) taken.set(line.lineNo, 1);
  }

  // The other lines, under their card's name, so repeated cards merge into one slot.
  const rest = cardLines.flatMap((line) => {
    const card = byLine.get(line.lineNo);
    const quantity = (line.quantity ?? 0) - (taken.get(line.lineNo) ?? 0);
    return card && quantity > 0 ? [{ ...withPrinting(line), name: card.name, quantity }] : [];
  });
  const named = new Map([...byLine.values()].map((card) => [normalizeName(card.name), card]));
  const cardFor = (name: string) => named.get(normalizeName(name));
  const merged = mergeSlots(rest, (name) => cardFor(name)?.isBasicLand === true);

  const allCards = [...commanders, ...merged.flatMap((slot) => cardFor(slot.name) ?? [])];
  const images = cardImages(db, [...new Set(allCards.map((card) => card.oracleId))]);
  const summary = (card: CardRow) => cardSummary(card, images.get(card.oracleId));
  const boardOrder: Record<Board, number> = { commander: 0, main: 1, maybe: 2 };
  const slots: ParsedSlot[] = [
    ...commanders.map((card) => ({
      card: summary(card),
      board: 'commander' as const,
      quantity: 1,
      hint: commanderHints.get(card.oracleId) ?? null,
    })),
    ...merged
      .flatMap((slot) => {
        const card = cardFor(slot.name);
        if (!card) return [];
        tags.set(slotKey(slot.board, card.oracleId), slot.tags);
        const hint =
          slot.setCode && slot.collectorNumber
            ? { setCode: slot.setCode, collectorNumber: slot.collectorNumber, foil: slot.foil }
            : null;
        return [{ card: summary(card), board: slot.board, quantity: slot.quantity, hint }];
      })
      .sort((a, b) => boardOrder[a.board] - boardOrder[b.board]),
  ];

  const unmatched = cardLines
    .filter((line) => !byLine.has(line.lineNo))
    .map((line) => ({ lineNo: line.lineNo, name: line.name ?? '', quantity: line.quantity ?? 0 }));

  const sum = (rows: { quantity: number }[]) =>
    rows.reduce((total, row) => total + row.quantity, 0);
  const unmatchedOn = (board: Board) =>
    sum(
      unmatched.filter(
        (row) => cardLines.find((line) => line.lineNo === row.lineNo)?.board === board,
      ),
    );
  const counts = {
    main: sum(slots.filter((slot) => slot.board === 'main')) + unmatchedOn('main'),
    maybe: sum(slots.filter((slot) => slot.board === 'maybe')) + unmatchedOn('maybe'),
    basics: sum(slots.filter((slot) => slot.board === 'main' && slot.card.isBasicLand)),
  };

  const tagOf = (line: MoxfieldLine): MoxfieldLineTag => {
    // A line that isn't a card or a section name is shown like a section name.
    if (line.kind !== 'card') return line.kind === 'blank' ? 'blank' : 'header';
    if (skips.has(line.lineNo)) return 'skipped';
    const card = byLine.get(line.lineNo);
    if (!card) return 'unmatched';
    if (taken.has(line.lineNo) && line.quantity === 1) return 'commander';
    if (line.board === 'maybe') return 'maybe';
    return card.isBasicLand ? 'basic' : 'main';
  };

  return {
    format: parsed.format,
    lines: parsed.lines.map((line) => ({ lineNo: line.lineNo, text: line.text, tag: tagOf(line) })),
    commanders: commanders.map(summary),
    slots,
    unmatched,
    counts,
    lookupFailed,
    cardLineCount: cardLines.length,
    skippedCount: parsed.lines.filter((line) => line.kind === 'card' && skips.has(line.lineNo))
      .length,
    lineCards: new Map([...byLine].map(([lineNo, card]) => [lineNo, card.oracleId])),
    slotTags: cardLines.some((line) => line.tags?.length) ? tags : undefined,
  };
}

/** Makes the deck (its box and slots) and writes the imports row. Returns the deck id. */
export async function createMoxfieldDeck(
  db: Db,
  request: MoxfieldCreateRequest,
): Promise<MoxfieldCreateResult> {
  const preview = await previewMoxfieldDeck(db, request.text, request);
  refuseUnmatched(preview);
  const deckId = db.transaction((tx) => {
    const id = createDeck(tx, {
      name: request.name,
      slots: preview.slots.map((slot) => ({
        oracleId: slot.card.oracleId,
        board: slot.board,
        quantity: slot.quantity,
        hint: slot.hint,
        tags: preview.slotTags?.get(slotKey(slot.board, slot.card.oracleId)),
      })),
    });
    tx.insert(imports)
      .values({
        kind: 'moxfield_new',
        deckId: id,
        rowCount: preview.cardLineCount,
        cardCount: preview.slots.reduce((total, slot) => total + slot.quantity, 0),
        skippedCount: preview.skippedCount,
      })
      .run();
    return id;
  });
  return { deckId, message: `Created the deck ${request.name}` };
}

/** Refuses to save while a name is still unmatched. */
export function refuseUnmatched(preview: MoxfieldPreview) {
  const count = preview.unmatched.length;
  if (count === 0) return;
  throw new AppError(
    400,
    'unmatched_lines',
    `Fix or skip ${count === 1 ? 'the unmatched name' : `the ${count} unmatched names`} first.`,
  );
}

/**
 * Whether the card can be the deck's commander: one that can be a commander, or a Background
 * next to a commander that chooses a Background.
 */
function canLead(card: CardRow, commanders: CardRow[]) {
  if (card.canBeCommander) return true;
  return (
    /\bBackground\b/.test(card.typeLine) &&
    commanders.some(
      (other) =>
        other !== card &&
        other.keywords.some((keyword) => keyword.toLowerCase() === 'choose a background'),
    )
  );
}

function hintOf(line: MoxfieldLine): ParsedSlot['hint'] {
  return line.setCode && line.collectorNumber
    ? { setCode: line.setCode, collectorNumber: line.collectorNumber, foil: line.foil === true }
    : null;
}

function cardNotFound() {
  return new AppError(
    400,
    'card_not_found',
    'One of these cards isn’t in the card data. Update the card data and try again.',
  );
}

/** The card Jeff picked for each fixed line. */
function fixedCards(db: Db, lines: MoxfieldLine[], fixes: LineFixes) {
  const wanted = lines.flatMap((line) => {
    const oracleId = fixes[line.lineNo];
    return oracleId ? [{ lineNo: line.lineNo, oracleId }] : [];
  });
  const found = cardsById(
    db,
    wanted.map((fix) => fix.oracleId),
  );
  const fixed = new Map<number, CardRow>();
  for (const { lineNo, oracleId } of wanted) {
    const card = found.get(oracleId);
    if (!card) throw cardNotFound();
    fixed.set(lineNo, card);
  }
  return fixed;
}

function cardsById(db: Db, oracleIds: string[]) {
  const unique = [...new Set(oracleIds)];
  if (unique.length === 0) return new Map<string, CardRow>();
  const rows = db.select().from(cards).where(inArray(cards.oracleId, unique)).all();
  return new Map(rows.map((row) => [row.oracleId, row]));
}

/** A name as Scryfall and the card data write it: " / " becomes " // ". */
function lookupName(name: string) {
  return name.trim().replace(/\s+/g, ' ').replaceAll(' / ', ' // ');
}

/**
 * The card each name means, keyed by its normalized name: the full name first, then the front
 * face's name, then a printing's flavor name (such as "T'Challa's Protection" for Teferi's
 * Protection), ignoring case. A name matched by flavor name also gives that printing.
 */
function matchNames(db: Db, names: string[]) {
  const wanted = [...new Set(names.map(lookupName))];
  const byName = new Map<string, CardRow>();
  const flavorPrintings = new Map<string, { setCode: string; collectorNumber: string }>();
  if (wanted.length === 0) return { byName, flavorPrintings };
  const rows: CardRow[] = [];
  const flavored: {
    card: CardRow;
    flavorName: string;
    setCode: string;
    collectorNumber: string;
  }[] = [];
  for (let start = 0; start < wanted.length; start += 500) {
    const chunk = wanted.slice(start, start + 500);
    rows.push(
      ...db
        .select()
        .from(cards)
        .where(
          sql`${cards.name} COLLATE NOCASE IN ${chunk} OR ${cards.frontFaceName} COLLATE NOCASE IN ${chunk}`,
        )
        .orderBy(cards.oracleId)
        .all(),
    );
    flavored.push(
      ...db
        .select({
          card: cards,
          flavorName: sql<string>`${printings.flavorName}`,
          setCode: printings.setCode,
          collectorNumber: printings.collectorNumber,
        })
        .from(printings)
        .innerJoin(cards, eq(cards.oracleId, printings.oracleId))
        .where(sql`${printings.flavorName} COLLATE NOCASE IN ${chunk}`)
        .orderBy(sql`${printings.lang} <> 'en'`, printings.releasedAt, printings.scryfallId)
        .all(),
    );
  }
  const full = new Map<string, CardRow>();
  const front = new Map<string, CardRow>();
  for (const row of rows) {
    const name = normalizeName(row.name);
    const face = normalizeName(row.frontFaceName);
    if (!full.has(name)) full.set(name, row);
    if (!front.has(face)) front.set(face, row);
  }
  const flavor = new Map<string, (typeof flavored)[number]>();
  for (const row of flavored) {
    const name = normalizeName(row.flavorName);
    if (!flavor.has(name)) flavor.set(name, row);
  }
  for (const name of wanted) {
    const key = normalizeName(name);
    const card = full.get(key) ?? front.get(key);
    const printing = flavor.get(key);
    if (card) byName.set(key, card);
    else if (printing) {
      byName.set(key, printing.card);
      flavorPrintings.set(key, {
        setCode: printing.setCode.toUpperCase(),
        collectorNumber: printing.collectorNumber,
      });
    }
  }
  return { byName, flavorPrintings };
}

/**
 * The card of the printing at the line's set code and collector number. Printings in several
 * languages share them, so English wins.
 */
function printingCard(db: Db, line: MoxfieldLine): CardRow | undefined {
  return db
    .select({ card: cards })
    .from(printings)
    .innerJoin(cards, eq(cards.oracleId, printings.oracleId))
    .where(
      and(
        eq(sql`lower(${printings.setCode})`, (line.setCode ?? '').toLowerCase()),
        eq(sql`lower(${printings.collectorNumber})`, (line.collectorNumber ?? '').toLowerCase()),
      ),
    )
    .orderBy(sql`${printings.lang} <> 'en'`, printings.scryfallId)
    .limit(1)
    .get()?.card;
}

function printingKey(setCode: string, collectorNumber: string) {
  return `${setCode.toLowerCase()}:${collectorNumber.toLowerCase()}`;
}
