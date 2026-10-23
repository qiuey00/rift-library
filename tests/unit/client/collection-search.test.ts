import { describe, expect, it } from 'vitest';
import {
  chipLabel,
  findFilter,
  removeTerm,
  replaceFilter,
  toggleColor,
} from '../../../src/client/lib/collection-search';
import { parseCollectionQuery } from '../../../src/shared/collection-query';

describe('removeTerm', () => {
  it('takes one term out of the text and keeps the rest', () => {
    const q = 't:creature  f:foil loc:"Rares binder"';
    const [, foil] = parseCollectionQuery(q);
    expect(removeTerm(q, foil)).toBe('t:creature loc:"Rares binder"');
  });

  it('leaves nothing when the last term goes', () => {
    const q = 'is:proxy';
    expect(removeTerm(q, parseCollectionQuery(q)[0])).toBe('');
  });
});

describe('replaceFilter', () => {
  it('adds a term at the end, written as a person would type it', () => {
    expect(replaceFilter('signet', 'location', { kind: 'location', value: 'Rares binder' })).toBe(
      'signet loc:"Rares binder"',
    );
  });

  it('replaces every term of the same kind', () => {
    expect(
      replaceFilter('f:foil signet f:etched', 'finish', { kind: 'finish', value: 'nonfoil' }),
    ).toBe('signet f:nonfoil');
  });

  it('removes the kind with null', () => {
    expect(replaceFilter('is:real t:land', 'proxy', null)).toBe('t:land');
  });
});

describe('findFilter', () => {
  it('finds the first term of a kind', () => {
    const terms = parseCollectionQuery('c:wu t:creature');
    expect(findFilter(terms, 'color')?.value).toBe('WU');
    expect(findFilter(terms, 'set')).toBeUndefined();
  });
});

describe('toggleColor', () => {
  it('adds and removes colors in WUBRG order', () => {
    expect(toggleColor(undefined, 'G')).toBe('G');
    expect(toggleColor('G', 'W')).toBe('WG');
    expect(toggleColor('WG', 'G')).toBe('W');
    expect(toggleColor('W', 'W')).toBeNull();
  });

  it('treats colorless on its own', () => {
    expect(toggleColor('WU', 'C')).toBe('');
    expect(toggleColor('', 'C')).toBeNull();
    expect(toggleColor('', 'R')).toBe('R');
  });
});

describe('chipLabel', () => {
  it('says what each term means', () => {
    const labels = parseCollectionQuery(
      'bolt set:sos c:bg c:c t:creature f:foil is:proxy is:real loc:"Rares binder" f:shiny',
    ).map(chipLabel);
    expect(labels).toEqual([
      'Name: bolt',
      'Set: SOS',
      'Colors: B G',
      'Colorless',
      'Type: creature',
      'Finish: foil',
      'Proxies only',
      'Real only',
      'Location: Rares binder',
      'f:shiny',
    ]);
  });
});
