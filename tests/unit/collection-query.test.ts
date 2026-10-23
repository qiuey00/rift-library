import { describe, expect, it } from 'vitest';
import {
  type CollectionFilter,
  formatCollectionFilter,
  parseCollectionQuery,
} from '../../src/shared/collection-query';

/** The filters only, without where they sit in the text. */
const filters = (q: string): CollectionFilter[] =>
  parseCollectionQuery(q).map(({ text: _text, start: _start, end: _end, ...filter }) => filter);

describe('parseCollectionQuery', () => {
  it('reads nothing from empty or blank text', () => {
    expect(parseCollectionQuery('')).toEqual([]);
    expect(parseCollectionQuery('   ')).toEqual([]);
  });

  it('reads plain words as card names, in lower case', () => {
    expect(filters('Arcane SIGNET')).toEqual([
      { kind: 'name', value: 'arcane' },
      { kind: 'name', value: 'signet' },
    ]);
  });

  it('reads quoted words as one name', () => {
    expect(filters('"Sylvan Library"')).toEqual([{ kind: 'name', value: 'sylvan library' }]);
  });

  it('keeps a word that ends in a colon as part of a name', () => {
    expect(filters('Protection: red')).toEqual([
      { kind: 'name', value: 'protection:' },
      { kind: 'name', value: 'red' },
    ]);
  });

  it('reads set:', () => {
    expect(filters('set:SOS')).toEqual([{ kind: 'set', value: 'sos' }]);
  });

  it('reads c: as colors in WUBRG order, and c:c as colorless', () => {
    expect(filters('c:gb')).toEqual([{ kind: 'color', value: 'BG' }]);
    expect(filters('c:urw')).toEqual([{ kind: 'color', value: 'WUR' }]);
    expect(filters('c:c')).toEqual([{ kind: 'color', value: '' }]);
    expect(filters('c:C')).toEqual([{ kind: 'color', value: '' }]);
  });

  it('reads t:', () => {
    expect(filters('t:Creature')).toEqual([{ kind: 'type', value: 'creature' }]);
    expect(filters('t:"legendary creature"')).toEqual([
      { kind: 'type', value: 'legendary creature' },
    ]);
  });

  it('reads f: for each finish', () => {
    expect(filters('f:foil f:nonfoil f:Etched')).toEqual([
      { kind: 'finish', value: 'foil' },
      { kind: 'finish', value: 'nonfoil' },
      { kind: 'finish', value: 'etched' },
    ]);
  });

  it('reads is:proxy and is:real', () => {
    expect(filters('is:proxy is:REAL')).toEqual([
      { kind: 'proxy', value: true },
      { kind: 'proxy', value: false },
    ]);
  });

  it('reads trade:yes and trade:no', () => {
    expect(filters('trade:yes trade:NO')).toEqual([
      { kind: 'trade', value: true },
      { kind: 'trade', value: false },
    ]);
    expect(filters('trade:maybe')).toEqual([
      { kind: 'invalid', message: 'trade: takes yes or no.' },
    ]);
  });

  it('reads loc: with a quoted name, keeping its case', () => {
    expect(filters('loc:"Rares binder"')).toEqual([{ kind: 'location', value: 'Rares binder' }]);
    expect(filters('loc:Lands')).toEqual([{ kind: 'location', value: 'Lands' }]);
  });

  it('reads keys in any case', () => {
    expect(filters('SET:sos T:land LOC:Lands')).toEqual([
      { kind: 'set', value: 'sos' },
      { kind: 'type', value: 'land' },
      { kind: 'location', value: 'Lands' },
    ]);
  });

  it('reads a combination in the order written, with where each term sits', () => {
    const q = 'signet  t:artifact loc:"Staples binder" is:real c:c f:foil set:eoc';
    const terms = parseCollectionQuery(q);
    expect(terms.map((term) => term.kind)).toEqual([
      'name',
      'type',
      'location',
      'proxy',
      'color',
      'finish',
      'set',
    ]);
    for (const term of terms) expect(q.slice(term.start, term.end)).toBe(term.text);
    expect(terms[2]).toEqual({
      kind: 'location',
      value: 'Staples binder',
      text: 'loc:"Staples binder"',
      start: 19,
      end: 39,
    });
  });

  it('lets a chip be removed by cutting its text out', () => {
    const q = 't:creature f:foil';
    const foil = parseCollectionQuery(q)[1];
    if (!foil) throw new Error('expected two terms');
    expect(filters(`${q.slice(0, foil.start)}${q.slice(foil.end)}`)).toEqual([
      { kind: 'type', value: 'creature' },
    ]);
  });

  it('reads an unclosed quote to the end of the text', () => {
    expect(filters('loc:"Rares bin')).toEqual([{ kind: 'location', value: 'Rares bin' }]);
    expect(filters('"sylvan lib')).toEqual([{ kind: 'name', value: 'sylvan lib' }]);
  });

  it('marks terms it cannot use as invalid, with a message for Jeff', () => {
    expect(filters('f:shiny')).toEqual([
      { kind: 'invalid', message: 'f: takes foil, nonfoil or etched.' },
    ]);
    expect(filters('is:foil')).toEqual([{ kind: 'invalid', message: 'is: takes proxy or real.' }]);
    expect(filters('c:wx')[0]?.kind).toBe('invalid');
    expect(filters('c:wc')[0]?.kind).toBe('invalid');
    expect(filters('set:')).toEqual([
      { kind: 'invalid', message: 'set: needs a value, such as set:sos.' },
    ]);
    expect(filters('loc:""')[0]?.kind).toBe('invalid');
    expect(filters('rarity:mythic')).toEqual([
      {
        kind: 'invalid',
        message: "rarity: isn't a search term. Use set:, c:, t:, f:, is:, loc: or trade:.",
      },
    ]);
  });

  it('skips empty quotes', () => {
    expect(filters('"" signet')).toEqual([{ kind: 'name', value: 'signet' }]);
  });
});

describe('formatCollectionFilter', () => {
  it('writes each filter as the term a person would type', () => {
    expect(formatCollectionFilter({ kind: 'name', value: 'sylvan library' })).toBe(
      '"sylvan library"',
    );
    expect(formatCollectionFilter({ kind: 'set', value: 'sos' })).toBe('set:sos');
    expect(formatCollectionFilter({ kind: 'color', value: 'WU' })).toBe('c:wu');
    expect(formatCollectionFilter({ kind: 'color', value: '' })).toBe('c:c');
    expect(formatCollectionFilter({ kind: 'type', value: 'creature' })).toBe('t:creature');
    expect(formatCollectionFilter({ kind: 'finish', value: 'etched' })).toBe('f:etched');
    expect(formatCollectionFilter({ kind: 'proxy', value: true })).toBe('is:proxy');
    expect(formatCollectionFilter({ kind: 'proxy', value: false })).toBe('is:real');
    expect(formatCollectionFilter({ kind: 'trade', value: true })).toBe('trade:yes');
    expect(formatCollectionFilter({ kind: 'trade', value: false })).toBe('trade:no');
    expect(formatCollectionFilter({ kind: 'location', value: 'Rares binder' })).toBe(
      'loc:"Rares binder"',
    );
    expect(formatCollectionFilter({ kind: 'invalid', message: 'x' })).toBe('');
  });

  it('writes text that parses back to the same filter', () => {
    const all: CollectionFilter[] = [
      { kind: 'name', value: 'arcane' },
      { kind: 'set', value: 'eoc' },
      { kind: 'color', value: 'BRG' },
      { kind: 'type', value: 'legendary creature' },
      { kind: 'finish', value: 'foil' },
      { kind: 'proxy', value: false },
      { kind: 'location', value: 'Long box' },
      { kind: 'trade', value: true },
    ];
    expect(filters(all.map(formatCollectionFilter).join(' '))).toEqual(all);
  });
});
