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
