import type { Finish } from '../../../shared/api/common';
import { tagKey } from '../decks';

// Writes Moxfield's import text in its set format, such as "1 Beast Whisperer (FDC) 189 #draw",
// for both the deck and the location exports.

export interface MoxfieldCardLine {
  quantity: number;
  name: string;
  /** The printing, written as "(SET) 123"; left out when null. */
  printing: { setCode: string; collectorNumber: string } | null;
  finish: Finish;
  /** Written after the card as "#tag" by tag key ("Card draw" as "#card-draw"), in the order given. */
  tags?: readonly string[];
}

const FINISH_MARK: Record<Finish, string> = { nonfoil: '', foil: ' *F*', etched: ' *E*' };

export function moxfieldLine(card: MoxfieldCardLine): string {
  const printing = card.printing
    ? ` (${card.printing.setCode.toUpperCase()}) ${card.printing.collectorNumber}`
    : '';
  const tags = (card.tags ?? []).map((tag) => ` #${tagKey(tag)}`).join('');
  return `${card.quantity} ${card.name}${printing}${FINISH_MARK[card.finish]}${tags}`;
}

const FINISH_ORDER: Record<Finish, number> = { nonfoil: 0, foil: 1, etched: 2 };

/** Cards by name ignoring case, then by set code, collector number and finish. */
export function byName(a: MoxfieldCardLine, b: MoxfieldCardLine): number {
  return (
    compareText(a.name, b.name) ||
    compareText(a.printing?.setCode ?? '', b.printing?.setCode ?? '') ||
    (a.printing?.collectorNumber ?? '').localeCompare(b.printing?.collectorNumber ?? '', 'en', {
      numeric: true,
    }) ||
    FINISH_ORDER[a.finish] - FINISH_ORDER[b.finish]
  );
}

const compareText = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/** The lines, each ending with a line break, as Moxfield's own export does. */
export function moxfieldText(lines: string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

/** A name safe to save as a file on macOS and Windows, such as "Hearthhull.txt". */
export function textFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${safe || 'Export'}.txt`;
}
