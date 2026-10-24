import type { Board } from '../common';
import type {
  DeckChanges,
  DeckListLine,
  DeckListPreview,
  DeckListUpdated,
  ListedSlot,
} from '../deck-lists';
import type { BoardCounts, DeckSummary, PrintingHint } from '../decks';
import type { DeckListExport } from '../exports';
import { cards, printings } from './deck-cards';
import { deckViewSample, jinxBurn } from './decks';

// Deck lists in the format of docs/technical-design.md, "Deck lists": Jinx Rebels, a full
// Riftbound deck that keeps every deck rule (made-up cards), its preview with one misspelled
// line, the deck it makes, an update of Jinx Burn, and the deck and location exports.
// The server answers these samples until #19 (import and update) and #20 (exports).

type Key = keyof typeof cards & keyof typeof printings;

/** One line of a deck list: quantity, card, and optionally foil and tags. */
type Entry = { key: Key; quantity: number; foil?: boolean; tags?: string[] };

const HEADINGS: Record<Board, string> = {
  legend: 'Legend:',
  champion: 'Champion:',
  main: 'Main:',
  battlefield: 'Battlefields:',
  rune: 'Runes:',
  sideboard: 'Sideboard:',
  maybe: 'Maybe:',
};

/** The public code a deck list writes for a printing, such as "OGN-135" for OGN-135/298. */
function codeOf(key: Key): string {
  return printings[key].publicCode.split('/')[0];
}

/** One deck list line: "3 Fierce Blast OGN-135 *F* #Removal". */
function lineFor(name: string, quantity: number, hint: PrintingHint | null, tags: string[] = []) {
  return [
    String(quantity),
    name,
    ...(hint ? [hint.publicCode] : []),
    ...(hint?.foil ? ['*F*'] : []),
    ...tags.map((tag) => `#${tag}`),
  ].join(' ');
}

/**
 * Jinx Rebels: 1 Legend, 1 Chosen Champion and 39 main deck cards (40 with the champion), all
 * Fury, Chaos or colorless, at most 3 of each; 3 battlefields, 12 runes, an 8-card sideboard and
 * one card on the maybe board.
 */
const jinxRebels: Record<Board, Entry[]> = {
  legend: [{ key: 'jinxLooseCannon', quantity: 1, foil: true }],
  champion: [{ key: 'jinxRebel', quantity: 1 }],
  main: [
    { key: 'fierceBlast', quantity: 3, tags: ['Removal'] },
    { key: 'vigilantSurge', quantity: 3, tags: ['Removal'] },
    { key: 'stormSage', quantity: 3 },
    { key: 'ferventCharger', quantity: 3 },
    { key: 'moltenHourglass', quantity: 3, tags: ['Ramp'] },
    { key: 'rogueCaptain', quantity: 3 },
    { key: 'sunkenEdict', quantity: 3, tags: ['Removal'] },
    { key: 'dawnUproar', quantity: 3 },
    { key: 'twilightGust', quantity: 3 },
    { key: 'swiftOx', quantity: 3 },
    { key: 'crimsonShaman', quantity: 3, tags: ['Card draw'] },
    { key: 'crimsonWayfarer', quantity: 3 },
    { key: 'sunDisc', quantity: 3, tags: ['energy rock', 'Ramp'] },
  ],
  battlefield: [
    { key: 'eagerSteppe', quantity: 1 },
    { key: 'ninefoldTemple', quantity: 1 },
    { key: 'grimSteppe', quantity: 1 },
  ],
  rune: [
    { key: 'furyRune', quantity: 6 },
    { key: 'chaosRune', quantity: 6 },
  ],
  sideboard: [
    { key: 'fioraGuardian', quantity: 2 },
    { key: 'volibearPathfinder', quantity: 2 },
    { key: 'emberSignet', quantity: 2 },
    { key: 'hextechVault', quantity: 2 },
  ],
  maybe: [{ key: 'sennaOutlaw', quantity: 1 }],
};

const boardOrder = Object.keys(HEADINGS) as Board[];

/** The text of a deck list, each line with its number, kind and board, and the slots it makes. */
function deckListOf(boards: Record<Board, Entry[]>, misspelled: Partial<Record<Key, string>>) {
  const lines: DeckListLine[] = [];
  const slots: ListedSlot[] = [];
  const unmatched: DeckListPreview['unmatched'] = [];
  const add = (text: string, kind: DeckListLine['kind'], board: Board | null) =>
    lines.push({ lineNumber: lines.length + 1, text, kind, board, isNew: false });

  for (const board of boardOrder) {
    if (boards[board].length === 0) continue;
    if (lines.length > 0) add('', 'blank', null);
    add(HEADINGS[board], 'heading', board);
    for (const { key, quantity, foil = false, tags = [] } of boards[board]) {
      const hint = { publicCode: codeOf(key), foil };
      const typo = misspelled[key];
      add(
        lineFor(typo ?? cards[key].name, quantity, hint, tags),
        typo ? 'unmatched' : 'card',
        board,
      );
      const lineNumber = lines.length;
      if (typo) {
        unmatched.push({ lineNumber, name: typo, quantity, board });
        continue;
      }
      const sortedTags = [...tags].sort((a, b) =>
        a.localeCompare(b, 'en', { sensitivity: 'base' }),
      );
      slots.push({
        card: cards[key],
        board,
        quantity,
        hint,
        printing: printings[key],
        tags: sortedTags,
        lineNumbers: [lineNumber],
      });
    }
  }
  const text = `${lines.map((line) => line.text).join('\n')}\n`;
  return { text, lines, slots, unmatched };
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

/** The Jinx Rebels deck list, as Jeff would paste it. */
export const jinxRebelsText = deckListOf(jinxRebels, {}).text;

const preview = deckListOf(jinxRebels, { hextechVault: 'Hextek Vault' });

/** The same list with "Hextek Vault" misspelled, as pasted for the preview sample. */
export const jinxRebelsTypoText = preview.text;

/**
 * POST /api/deck-lists/preview with `jinxRebelsTypoText`: every line matched but the
 * misspelled sideboard line, so the sideboard has 6 cards until Jeff fixes or skips it.
 */
export const deckListPreviewSample: DeckListPreview = {
  previewId: 'dlp_7f3a9c',
  lines: preview.lines,
  slots: preview.slots,
  boards: countBoards(preview.slots),
  legend: cards.jinxLooseCannon,
  champion: cards.jinxRebel,
  unmatched: preview.unmatched,
  checks: [
    { code: 'legend', result: 'pass', message: 'The Legend is Jinx, Loose Cannon.', cards: [] },
    {
      code: 'champion',
      result: 'pass',
      message: 'The Chosen Champion is Jinx, Rebel.',
      cards: [],
    },
    { code: 'main_count', result: 'pass', message: 'The main deck has 40 cards.', cards: [] },
    {
      code: 'copies',
      result: 'pass',
      message: 'No card is in the deck more than 3 times.',
      cards: [],
    },
    {
      code: 'signature',
      result: 'pass',
      message: 'The deck has no signature cards.',
      cards: [],
    },
    {
      code: 'domains',
      result: 'pass',
      message: 'Every card is within Jinx, Loose Cannon’s domains (Fury and Chaos).',
      cards: [],
    },
    { code: 'runes', result: 'pass', message: 'The deck has 12 runes.', cards: [] },
    {
      code: 'battlefields',
      result: 'pass',
      message: 'The deck has 3 battlefields with different names.',
      cards: [],
    },
    {
      code: 'sideboard',
      result: 'warn',
      message: 'The sideboard has 6 cards; it needs 8.',
      cards: [],
    },
  ],
  changes: null,
  lookupFailed: false,
};

/** POST /api/deck-lists/dlp_7f3a9c/create: the new deck without the skipped line, none of it pulled yet. */
export const deckListCreatedSample: DeckSummary = {
  id: 8,
  name: 'Jinx Rebels',
  deckBoxId: 16,
  legend: cards.jinxLooseCannon,
  champion: cards.jinxRebel,
  domains: cards.jinxLooseCannon.domains,
  state: 'not_assembled',
  counts: { inBox: 0, free: 40, otherDecks: 6, missing: 4, runes: 12 },
  boxCopyCount: 0,
  openedAt: null,
};

const jinxBurnSlot = (key: Key, board: Board, quantity: number): ListedSlot => ({
  card: cards[key],
  board,
  quantity,
  hint: { publicCode: codeOf(key), foil: false },
  printing: printings[key],
  tags: [],
  lineNumbers: [1],
});

/** The preview's `changes` for an update of Jinx Burn (POST /api/deck-lists/preview with `deckId: 1`). */
export const deckChangesSample: DeckChanges = {
  added: [jinxBurnSlot('jinxRebel', 'champion', 1), jinxBurnSlot('stormSage', 'main', 2)],
  removed: [jinxBurnSlot('dawnSnare', 'main', 1)],
  changed: [{ card: cards.calmRune, board: 'rune', from: 8, to: 6 }],
};

/** POST /api/decks/1/deck-list: Jinx Burn's box holds copies the new list doesn't want. */
export const deckListUpdatedSample: DeckListUpdated = {
  deck: { ...jinxBurn, champion: cards.jinxRebel },
  message: 'Updated Jinx Burn: 3 cards added, 1 removed, 1 changed',
  needsSwap: true,
};

/** GET /api/exports/decks/1/deck-list: Jinx Burn, board by board, as the import reads it. */
export const deckExportSample: DeckListExport = (() => {
  const out: string[] = [];
  let cardCount = 0;
  let lineCount = 0;
  for (const board of boardOrder) {
    const slots = deckViewSample.slots.filter((slot) => slot.board === board);
    if (slots.length === 0) continue;
    if (out.length > 0) out.push('');
    out.push(HEADINGS[board]);
    for (const slot of slots) {
      const code = slot.pickedPrinting?.publicCode.split('/')[0];
      const hint = code ? { publicCode: code, foil: slot.hint?.foil ?? false } : slot.hint;
      out.push(lineFor(slot.card.name, slot.quantity, hint, slot.tags));
      cardCount += slot.quantity;
      lineCount += 1;
    }
  }
  return { fileName: 'Jinx Burn.txt', text: `${out.join('\n')}\n`, cardCount, lineCount };
})();

/**
 * GET /api/exports/locations/12/deck-list: the trade binder, one line per printing and finish.
 * Its proxy of Darius, Hand of Noxus is left out.
 */
export const locationExportSample: DeckListExport = {
  fileName: 'Trade binder.txt',
  text: [
    `2 Unbound Volley ${codeOf('unboundVolley')}`,
    `1 Unbound Volley ${codeOf('unboundVolley')} *F*`,
    `1 Fiora, Guardian ${codeOf('fioraGuardian')} *F*`,
    `3 Ember Signet ${codeOf('emberSignet')}`,
    '',
  ].join('\n'),
  cardCount: 7,
  lineCount: 4,
};
