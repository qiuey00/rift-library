import {
  type CollectionFilter,
  type CollectionTerm,
  formatCollectionFilter,
  parseCollectionQuery,
} from '../../shared/collection-query';

// The Collection screen's search text and its filter chips stay in step: chips are read from
// the text, and removing a chip or picking a dropdown filter writes the text again.

/** The filters a dropdown (or the For trade chip) sets. Each holds at most one term of its kind. */
export type DropdownKind = 'set' | 'color' | 'type' | 'finish' | 'proxy' | 'location' | 'trade';

type FilterOf<K extends CollectionFilter['kind']> = Extract<CollectionFilter, { kind: K }>;

/** The search text without one term, such as when its chip is removed. */
export function removeTerm(q: string, term: CollectionTerm): string {
  return join(parseCollectionQuery(q).filter((t) => t.start !== term.start));
}

/**
 * The search text with every term of the filter's kind replaced by the filter, written as a
 * person would type it and added at the end. `null` removes those terms.
 */
export function replaceFilter(
  q: string,
  kind: DropdownKind,
  filter: FilterOf<DropdownKind> | null,
): string {
  const kept = parseCollectionQuery(q).filter((term) => term.kind !== kind);
  return [join(kept), filter ? formatCollectionFilter(filter) : '']
    .filter((part) => part !== '')
    .join(' ');
}

/** The first term of a kind in the search text, which a dropdown shows as its value. */
export function findFilter<K extends DropdownKind>(
  terms: CollectionTerm[],
  kind: K,
): FilterOf<K> | undefined {
  return terms.find((term): term is CollectionTerm & FilterOf<K> => term.kind === kind);
}

/** The color filter after toggling one of W U B R G, or C for colorless. */
export function toggleColor(current: string | undefined, letter: string): string | null {
  if (letter === 'C') return current === '' ? null : '';
  const letters = new Set(current ?? '');
  if (letters.has(letter)) letters.delete(letter);
  else letters.add(letter);
  const value = [...'WUBRG'].filter((x) => letters.has(x)).join('');
  return value === '' ? null : value;
}

const finishWords = { nonfoil: 'nonfoil', foil: 'foil', etched: 'etched' } as const;

/** What a term's chip says, such as "Type: creature". */
export function chipLabel(term: CollectionTerm): string {
  switch (term.kind) {
    case 'name':
      return `Name: ${term.value}`;
    case 'set':
      return `Set: ${term.value.toUpperCase()}`;
    case 'color':
      return term.value === '' ? 'Colorless' : `Colors: ${[...term.value].join(' ')}`;
    case 'type':
      return `Type: ${term.value}`;
    case 'finish':
      return `Finish: ${finishWords[term.value]}`;
    case 'proxy':
      return term.value ? 'Proxies only' : 'Real only';
    case 'location':
      return `Location: ${term.value}`;
    case 'trade':
      return term.value ? 'For trade' : 'Not for trade';
    case 'invalid':
      return term.text;
  }
}

function join(terms: CollectionTerm[]): string {
  return terms.map((term) => term.text).join(' ');
}
