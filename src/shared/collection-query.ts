import type { Finish } from './api/common';

// The Collection screen's search text, read the same way by the screen (for its filter chips)
// and by the server (for GET /api/stacks?q=). Terms are separated by spaces; a value with
// spaces goes in double quotes, such as loc:"Rares binder". Every term must match.

/** One search term, with where it sits in the text so a chip can remove it. */
export type CollectionTerm = CollectionFilter & {
  /** The term as written, such as `loc:"Rares binder"`. */
  text: string;
  /** Where `text` starts and ends (exclusive) in the search text. */
  start: number;
  end: number;
};

export type CollectionFilter =
  /** A plain word or "quoted words": the card's name contains it (any case). */
  | { kind: 'name'; value: string }
  /** `set:sos`: the printing's set code, in lower case. */
  | { kind: 'set'; value: string }
  /**
   * `c:wu`: the card's color identity includes all of these colors, in WUBRG order, such as
   * "WU". `c:c` is colorless, written as "".
   */
  | { kind: 'color'; value: string }
  /** `t:creature`: the card's type line contains it (any case). */
  | { kind: 'type'; value: string }
  /** `f:foil`, `f:nonfoil`, `f:etched`. */
  | { kind: 'finish'; value: Finish }
  /** `is:proxy` (true) or `is:real` (false). */
  | { kind: 'proxy'; value: boolean }
  /** `loc:"Rares binder"`: in a location with that name (any case) or one of its children. */
  | { kind: 'location'; value: string }
  /** `trade:yes` (true) or `trade:no` (false): in a location for trade, or not. */
  | { kind: 'trade'; value: boolean }
  /** A term the search can't use, such as `f:shiny`. The server answers 400 `invalid_query`. */
  | { kind: 'invalid'; message: string };

const finishes: readonly Finish[] = ['nonfoil', 'foil', 'etched'];
const colorOrder = 'WUBRG';
const keys = ['set', 'c', 't', 'f', 'is', 'loc', 'trade'] as const;
type Key = (typeof keys)[number];
const isKey = (key: string): key is Key => (keys as readonly string[]).includes(key);

/** Reads the search text into its terms, in the order they are written. */
export function parseCollectionQuery(q: string): CollectionTerm[] {
  const terms: CollectionTerm[] = [];
  let i = 0;
  while (i < q.length) {
    if (/\s/.test(q.charAt(i))) {
      i++;
      continue;
    }
    const start = i;
    // A key is letters followed by a colon, such as "set:".
    const keyMatch = /^([a-z]+):/i.exec(q.slice(i));
    if (keyMatch) i += keyMatch[0].length;
    const { value, next } = readValue(q, i);
    i = next;
    const text = q.slice(start, i);
    const key = keyMatch?.[1]?.toLowerCase();
    if (key && isKey(key)) {
      terms.push({ ...readFilter(key, value), text, start, end: i });
    } else if (keyMatch && value !== '') {
      terms.push({
        kind: 'invalid',
        message: `${keyMatch[0]} isn't a search term. Use set:, c:, t:, f:, is:, loc: or trade:.`,
        text,
        start,
        end: i,
      });
    } else {
      // A plain word. One that ends in a colon, such as the "Protection:" of
      // "Circle of Protection: Red", is part of a card name too.
      const name = (keyMatch ? text : value).toLowerCase();
      terms.push({ kind: 'name', value: name, text, start, end: i });
    }
  }
  return terms.filter((term) => term.kind !== 'name' || term.value !== '');
}

/** Reads a word, or "quoted words" (an unclosed quote runs to the end of the text). */
function readValue(q: string, from: number): { value: string; next: number } {
  if (q.charAt(from) === '"') {
    const close = q.indexOf('"', from + 1);
    const end = close === -1 ? q.length : close;
    return { value: q.slice(from + 1, end).trim(), next: close === -1 ? q.length : close + 1 };
  }
  let end = from;
  while (end < q.length && !/\s/.test(q.charAt(end))) end++;
  return { value: q.slice(from, end), next: end };
}

function readFilter(key: Key, value: string): CollectionFilter {
  if (value === '') {
    return { kind: 'invalid', message: `${key}: needs a value, such as ${examples[key]}.` };
  }
  const lower = value.toLowerCase();
  switch (key) {
    case 'set':
      return { kind: 'set', value: lower };
    case 't':
      return { kind: 'type', value: lower };
    case 'loc':
      return { kind: 'location', value };
    case 'f': {
      const finish = finishes.find((f) => f === lower);
      return finish
        ? { kind: 'finish', value: finish }
        : { kind: 'invalid', message: 'f: takes foil, nonfoil or etched.' };
    }
    case 'is':
      if (lower === 'proxy') return { kind: 'proxy', value: true };
      if (lower === 'real') return { kind: 'proxy', value: false };
      return { kind: 'invalid', message: 'is: takes proxy or real.' };
    case 'trade':
      if (lower === 'yes') return { kind: 'trade', value: true };
      if (lower === 'no') return { kind: 'trade', value: false };
      return { kind: 'invalid', message: 'trade: takes yes or no.' };
    case 'c': {
      const upper = lower.toUpperCase();
      if (upper === 'C') return { kind: 'color', value: '' };
      if (![...upper].every((letter) => colorOrder.includes(letter))) {
        return {
          kind: 'invalid',
          message: 'c: takes the colors w, u, b, r and g, such as c:wu, or c:c for colorless.',
        };
      }
      return { kind: 'color', value: [...colorOrder].filter((x) => upper.includes(x)).join('') };
    }
  }
}

const examples: Record<Key, string> = {
  set: 'set:sos',
  c: 'c:wu',
  t: 't:creature',
  f: 'f:foil',
  is: 'is:proxy',
  loc: 'loc:"Rares binder"',
  trade: 'trade:yes',
};

/**
 * Writes a filter as search text, quoting values with spaces, so a dropdown filter adds the
 * same term a person would type: `{ kind: 'location', value: 'Rares binder' }` gives
 * `loc:"Rares binder"`. Invalid terms have no text of their own and give "".
 */
export function formatCollectionFilter(filter: CollectionFilter): string {
  const quote = (value: string) => (/\s/.test(value) ? `"${value}"` : value);
  switch (filter.kind) {
    case 'name':
      return quote(filter.value);
    case 'set':
      return `set:${quote(filter.value)}`;
    case 'color':
      return `c:${filter.value === '' ? 'c' : filter.value.toLowerCase()}`;
    case 'type':
      return `t:${quote(filter.value)}`;
    case 'finish':
      return `f:${filter.value}`;
    case 'proxy':
      return filter.value ? 'is:proxy' : 'is:real';
    case 'location':
      return `loc:${quote(filter.value)}`;
    case 'trade':
      return filter.value ? 'trade:yes' : 'trade:no';
    case 'invalid':
      return '';
  }
}
