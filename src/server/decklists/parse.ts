import type { Board } from '../../shared/api/common';
import { parsePublicCode } from '../queries/cards';

// Reads deck list text in the format of docs/technical-design.md, "Deck lists". This is the one
// place to change when the format changes (D-23): everything after it works on `ParsedLine`s.
//
//   Legend:
//   1 Jinx, Loose Cannon OGN-001 *F*
//   Main:
//   3 Sun Disc OGN-057 #energy rock #Ramp
//
// A card line is a quantity, a card name, an optional public code, an optional *F* for foil and
// any number of tags, each starting with #. Lines before any heading are on the main deck.

export type ParsedLine =
  | { lineNumber: number; text: string; kind: 'blank' }
  | { lineNumber: number; text: string; kind: 'heading'; board: Board }
  | ({ lineNumber: number; text: string; kind: 'card' } & CardLine);

export type CardLine = {
  board: Board;
  quantity: number;
  name: string;
  /** The public code as written, without the set size, such as "OGN-042"; null without one. */
  publicCode: string | null;
  foil: boolean;
  tags: string[];
};

/** Heading words, lower case, without the colon or a card count. */
const HEADINGS: Record<string, Board> = {
  legend: 'legend',
  legends: 'legend',
  'champion legend': 'legend',
  champion: 'champion',
  champions: 'champion',
  'chosen champion': 'champion',
  main: 'main',
  'main deck': 'main',
  maindeck: 'main',
  mainboard: 'main',
  deck: 'main',
  battlefield: 'battlefield',
  battlefields: 'battlefield',
  rune: 'rune',
  runes: 'rune',
  'rune deck': 'rune',
  sideboard: 'sideboard',
  side: 'sideboard',
  maybe: 'maybe',
  maybeboard: 'maybe',
  'maybe board': 'maybe',
  considering: 'maybe',
};

/** Tags are at most 40 characters (`Tag` in src/shared/api/decks.ts). */
const TAG_LENGTH = 40;

/** The board a heading line starts, such as "Main:", "Battlefields (3)" or "Runes"; null otherwise. */
function headingBoard(text: string): Board | null {
  const words = text
    .toLowerCase()
    .replace(/:\s*$/, '')
    .replace(/\s*[([]?\d+[)\]]?\s*$/, '')
    .replace(/:\s*$/, '')
    .trim()
    .replace(/\s+/g, ' ');
  return HEADINGS[words] ?? null;
}

/** A card line's parts after the quantity, or null when nothing is left to be a name. */
function cardParts(rest: string) {
  let text = rest;
  let tags: string[] = [];
  const hash = text.search(/(^|\s)#/);
  if (hash >= 0) {
    tags = text
      .slice(hash)
      .split('#')
      .map((tag) => tag.trim().slice(0, TAG_LENGTH).trim())
      .filter((tag) => tag !== '');
    text = text.slice(0, hash);
  }
  let foil = false;
  text = text.replace(/(^|\s)\*f\*(?=\s|$)/gi, () => {
    foil = true;
    return ' ';
  });
  let publicCode: string | null = null;
  const code = /\s[([]?([a-z0-9]{2,5}-[a-z0-9]+(?:\/\d*)?)[)\]]?\s*$/i.exec(text);
  if (code && parsePublicCode(code[1])) {
    const [set, number] = code[1].split('/')[0].split('-');
    publicCode = `${set.toUpperCase()}-${number}`;
    text = text.slice(0, code.index);
  }
  const name = text.trim().replace(/\s+/g, ' ');
  return name === '' ? null : { name, publicCode, foil, tags };
}

/** Every line of the text, numbered from 1, with its board. */
export function parseDeckList(text: string): ParsedLine[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  let board: Board = 'main';
  return lines.map((raw, i): ParsedLine => {
    const lineNumber = i + 1;
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) return { lineNumber, text: raw, kind: 'blank' };
    const heading = headingBoard(line);
    if (heading) {
      board = heading;
      return { lineNumber, text: raw, kind: 'heading', board };
    }
    // "3 Sun Disc" or "3x Sun Disc"; a line without a quantity is one card.
    const counted = /^(\d+)\s*x?\s+(.+)$/i.exec(line);
    const quantity = counted ? Number.parseInt(counted[1], 10) : 1;
    const parts = cardParts(counted ? counted[2] : line);
    if (!parts || quantity < 1) return { lineNumber, text: raw, kind: 'blank' };
    return { lineNumber, text: raw, kind: 'card', board, quantity, ...parts };
  });
}
