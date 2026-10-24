import type { Finish } from '../../shared/api/common';

// The choices for a copy's details, shared by the add dialogs.

export const FINISH_WORDS: Record<Finish, string> = { normal: 'Normal', foil: 'Foil' };

/** The conditions, best first. */
export const CONDITIONS: [value: string, label: string][] = [
  ['mint', 'Mint'],
  ['near_mint', 'Near mint'],
  ['excellent', 'Excellent'],
  ['good', 'Good'],
  ['light_played', 'Light played'],
  ['played', 'Played'],
  ['poor', 'Poor'],
];

/** Language codes for paper printings. */
export const LANGUAGES: [code: string, label: string][] = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['ru', 'Russian'],
  ['zhs', 'Simplified Chinese'],
  ['zht', 'Traditional Chinese'],
  ['he', 'Hebrew'],
  ['la', 'Latin'],
  ['grc', 'Ancient Greek'],
  ['ar', 'Arabic'],
  ['sa', 'Sanskrit'],
  ['ph', 'Phyrexian'],
];

/** A condition or language code as screens write it, falling back to the code itself. */
export function choiceLabel(choices: [string, string][], value: string): string {
  return choices.find(([code]) => code === value)?.[1] ?? value;
}
