import { describe, expect, it } from 'vitest';
import {
  chipLabel,
  findFilter,
  removeTerm,
  replaceFilter,
  toggleDomain,
} from '../../../src/client/lib/collection-search';
import { parseCollectionQuery } from '../../../src/shared/collection-query';

describe('removeTerm', () => {
  it('takes one term out of the text and keeps the rest', () => {
    const q = 't:unit  f:foil loc:"Rares binder"';
    const [, foil] = parseCollectionQuery(q);
    expect(removeTerm(q, foil)).toBe('t:unit loc:"Rares binder"');
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
      replaceFilter('f:foil signet finish:normal', 'finish', { kind: 'finish', value: 'normal' }),
    ).toBe('signet finish:normal');
    expect(replaceFilter('rarity:rare', 'rarity', { kind: 'rarity', value: 'epic' })).toBe(
      'rarity:epic',
    );
  });

  it('removes the kind with null', () => {
    expect(replaceFilter('is:real t:rune', 'proxy', null)).toBe('t:rune');
  });
});

describe('toggleDomain', () => {
  it('adds a domain at the end, keeping the domains already picked', () => {
    expect(toggleDomain('', 'fury')).toBe('domain:fury');
    expect(toggleDomain('signet domain:fury', 'calm')).toBe('signet domain:fury domain:calm');
  });

  it('removes a domain already picked, however it was typed', () => {
    expect(toggleDomain('domain:FURY signet domain:calm', 'fury')).toBe('signet domain:calm');
  });
});

describe('findFilter', () => {
  it('finds the first term of a kind', () => {
    const terms = parseCollectionQuery('domain:mind t:unit');
    expect(findFilter(terms, 'domain')?.value).toBe('mind');
    expect(findFilter(terms, 'set')).toBeUndefined();
  });
});

describe('chipLabel', () => {
  it('says what each term means', () => {
    const labels = parseCollectionQuery(
      'bolt set:ogn domain:fury t:unit supertype:champion rarity:epic f:foil is:proxy is:real loc:"Rares binder" f:shiny',
    ).map(chipLabel);
    expect(labels).toEqual([
      'Name: bolt',
      'Set: OGN',
      'Domain: Fury',
      'Type: unit',
      'Supertype: champion',
      'Rarity: epic',
      'Finish: foil',
      'Proxies only',
      'Real only',
      'Location: Rares binder',
      'f:shiny',
    ]);
  });
});
