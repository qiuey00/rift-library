import type { Board } from '../../../shared/api/common';

// Reads a Moxfield text export into lines and proposed slots. It returns names, not cards:
// matching names to cards and saving the deck happen in the Moxfield import.

/** `sets` when most card lines carry a set code and collector number, else `plain`. */
export type MoxfieldFormat = 'sets' | 'plain';

/** The boards a line can go on. The commander board comes later, from the commander proposal. */
export type MoxfieldBoard = Exclude<Board, 'commander'>;

export type MoxfieldLine = {
  /** Counted from 1, as an editor counts lines. */
  lineNo: number;
  /** The line as written, without its line ending. */
  text: string;
  kind: 'card' | 'header' | 'blank' | 'invalid';
  quantity?: number;
  name?: string;
  /** The printing hint, from the set format: such as "EOC" and "1". */
  setCode?: string;
  collectorNumber?: string;
  foil?: boolean;
  board?: MoxfieldBoard;
  isCommanderProposal?: boolean;
  /** The `#` words at the end of a card line, without the `#` (and the `!` of a global tag). */
  tags?: string[];
};

export type MoxfieldText = {
  format: MoxfieldFormat;
  lines: MoxfieldLine[];
};

/** Repeated names on one board, merged. The hint is the first line's. */
export type MoxfieldSlot = {
  name: string;
  board: MoxfieldBoard;
  quantity: number;
  setCode?: string;
  collectorNumber?: string;
  foil: boolean;
  isBasicLand: boolean;
  isCommanderProposal: boolean;
  /** Every merged line's tags, in order, repeats left in. */
  tags: string[];
  /** The lines merged into this slot, in order. */
  lineNos: number[];
};

// "1 Hearthhull, the Worldseed (EOC) 1 *F*": a quantity and a name, then optionally a set code
// in brackets and a collector number (which can hold letters or symbols, such as "123a"), then
// any *X* markers. Only *F* (foil) means anything here.
const CARD_LINE = /^(\d+)x?\s+(.+?)(?:\s+\(([A-Za-z0-9]+)\)\s+([^\s*]\S*))?((?:\s+\*[^\s*]+\*)*)$/i;
const SIDEBOARD = /^sideboard:$/i;
// Moxfield's tags end the line, after the set and foil marks: "... (J25) 57 #token-maker #!combo".
// A tag starting #! is a Moxfield global tag.
const TAGS = /(?:\s+#!?[^\s#]+)+$/;

export function parseMoxfieldText(text: string): MoxfieldText {
  const rows = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  // A file that ends with a line break has no blank line after it.
  if (rows.at(-1) === '') rows.pop();

  const lines: MoxfieldLine[] = [];
  let board: MoxfieldBoard = 'main';
  let maybeCards = 0;
  for (const [index, row] of rows.entries()) {
    const lineNo = index + 1;
    const trimmed = row.trim();
    if (trimmed === '') {
      // The maybe board is the block that SIDEBOARD: starts. In the plain format the
      // commander comes in its own block after it.
      if (board === 'maybe' && maybeCards > 0) board = 'main';
      lines.push({ lineNo, text: row, kind: 'blank' });
      continue;
    }
    if (SIDEBOARD.test(trimmed)) {
      board = 'maybe';
      maybeCards = 0;
      lines.push({ lineNo, text: row, kind: 'header' });
      continue;
    }
    const tagText = TAGS.exec(trimmed)?.[0] ?? '';
    const match = CARD_LINE.exec(trimmed.slice(0, trimmed.length - tagText.length));
    const quantity = match ? Number(match[1]) : 0;
    if (!match || quantity < 1) {
      lines.push({ lineNo, text: row, kind: 'invalid' });
      continue;
    }
    const [, , name, setCode, collectorNumber, markers] = match;
    if (board === 'maybe') maybeCards++;
    lines.push({
      lineNo,
      text: row,
      kind: 'card',
      quantity,
      name,
      ...(setCode ? { setCode, collectorNumber } : {}),
      foil: markers.split(/\s+/).some((marker) => marker.toUpperCase() === '*F*'),
      board,
      ...(tagText
        ? {
            tags: tagText
              .trim()
              .split(/\s+/)
              .map((tag) => tag.replace(/^#!?/, '')),
          }
        : {}),
    });
  }

  const cards = lines.filter((line) => line.kind === 'card');
  const withSets = cards.filter((line) => line.setCode !== undefined).length;
  const format: MoxfieldFormat = cards.length > 0 && withSets * 2 > cards.length ? 'sets' : 'plain';

  const proposal = format === 'sets' ? cards[0] : lastSingleCardBlock(lines);
  if (proposal?.board === 'main') proposal.isCommanderProposal = true;

  return { format, lines };
}

/** The plain format's commander: the last block, when it is one card after earlier blocks. */
function lastSingleCardBlock(lines: MoxfieldLine[]): MoxfieldLine | undefined {
  const blocks: MoxfieldLine[][] = [];
  let block: MoxfieldLine[] = [];
  for (const line of lines) {
    if (line.kind === 'blank') {
      if (block.length > 0) blocks.push(block);
      block = [];
    } else {
      block.push(line);
    }
  }
  if (block.length > 0) blocks.push(block);

  const last = blocks.at(-1);
  if (blocks.length < 2 || last?.length !== 1 || last[0].kind !== 'card') return undefined;
  return last[0];
}

/**
 * Merges repeated names on the same board into one slot with the total quantity, keeping the
 * first line's printing hint, so two Forest lines with different printings make one Forest slot.
 */
export function mergeSlots(
  lines: MoxfieldLine[],
  isBasicLand: (name: string) => boolean,
): MoxfieldSlot[] {
  const slots = new Map<string, MoxfieldSlot>();
  for (const line of lines) {
    if (line.kind !== 'card' || !line.name || !line.quantity || !line.board) continue;
    const key = `${line.board}:${normalizeName(line.name)}`;
    const slot = slots.get(key);
    if (slot) {
      slot.quantity += line.quantity;
      slot.isCommanderProposal ||= line.isCommanderProposal === true;
      slot.tags.push(...(line.tags ?? []));
      slot.lineNos.push(line.lineNo);
      continue;
    }
    slots.set(key, {
      name: line.name,
      board: line.board,
      quantity: line.quantity,
      ...(line.setCode ? { setCode: line.setCode, collectorNumber: line.collectorNumber } : {}),
      foil: line.foil === true,
      isBasicLand: isBasicLand(line.name),
      isCommanderProposal: line.isCommanderProposal === true,
      tags: [...(line.tags ?? [])],
      lineNos: [line.lineNo],
    });
  }
  return [...slots.values()];
}

/** For comparing names: lower case, with " / " read as " // " for double-faced cards. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase().replaceAll(' / ', ' // ');
}
