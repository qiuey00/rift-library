import type { Board, CardSummary, CardType } from '../../shared/api/common';

/** Each card type as screens write it. */
export const TYPE_WORDS: Record<CardType, string> = {
  legend: 'Legend',
  unit: 'Unit',
  spell: 'Spell',
  gear: 'Gear',
  battlefield: 'Battlefield',
  rune: 'Rune',
  token: 'Token',
  other: 'Other',
};

/** Each deck board as screens write it. */
export const BOARD_WORDS: Record<Board, string> = {
  legend: 'Legend',
  champion: 'Chosen Champion',
  main: 'Main deck',
  battlefield: 'Battlefields',
  rune: 'Rune deck',
  sideboard: 'Sideboard',
  maybe: 'Maybe board',
};

/** A card's type line, such as "Champion Unit · Jinx" or "Spell". */
export function typeLine(card: Pick<CardSummary, 'type' | 'supertype' | 'championTag'>): string {
  const type = [card.supertype, TYPE_WORDS[card.type]].filter(Boolean).join(' ');
  return card.championTag && card.type !== 'legend' ? `${type} · ${card.championTag}` : type;
}

/** A public code split into its set code and collector number, without the set's count. */
function parsePublicCode(text: string): { set: string; number: string } | null {
  const match = /^([a-z0-9]{2,5})-0*(\d+[a-z]?)(?:\/\d+)?$/i.exec(text.trim());
  return match ? { set: match[1].toUpperCase(), number: match[2].toLowerCase() } : null;
}

/**
 * The public code Jeff typed into a card search, with the set code in capitals (such as
 * "OGN-042/298" for "ogn-042/298"); null when the text is a name instead.
 */
export function typedPublicCode(text: string): string | null {
  if (!parsePublicCode(text)) return null;
  const [set, ...rest] = text.trim().split('-');
  return [set.toUpperCase(), ...rest].join('-');
}

/** True when a printing's public code (such as "OGN-042/298") is the one typed ("ogn-42"). */
export function isPublicCode(publicCode: string, typed: string): boolean {
  const a = parsePublicCode(publicCode);
  const b = parsePublicCode(typed);
  return a !== null && b !== null && a.set === b.set && a.number === b.number;
}
