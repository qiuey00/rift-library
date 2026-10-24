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
    expect(filters('Ember SIGNET')).toEqual([
      { kind: 'name', value: 'ember' },
      { kind: 'name', value: 'signet' },
    ]);
  });

  it('reads quoted words as one name', () => {
    expect(filters('"Daring Banner"')).toEqual([{ kind: 'name', value: 'daring banner' }]);
  });

  it('keeps a word that ends in a colon as part of a name', () => {
    expect(filters('Protection: red')).toEqual([
      { kind: 'name', value: 'protection:' },
      { kind: 'name', value: 'red' },
    ]);
  });

  it('reads set:', () => {
    expect(filters('set:ogn')).toEqual([{ kind: 'set', value: 'OGN' }]);
  });

  it('reads domain: in any case', () => {
    expect(filters('domain:fury domain:CALM')).toEqual([
      { kind: 'domain', value: 'fury' },
      { kind: 'domain', value: 'calm' },
    ]);
  });

  it('reads t:', () => {
    expect(filters('t:Unit')).toEqual([{ kind: 'type', value: 'unit' }]);
    expect(filters('t:"champion unit"')).toEqual([{ kind: 'type', value: 'champion unit' }]);
  });

  it('reads f: for each finish', () => {
    expect(filters('f:foil f:Normal')).toEqual([
      { kind: 'finish', value: 'foil' },
      { kind: 'finish', value: 'normal' },
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
    expect(filters('SET:sfd T:rune LOC:Lands')).toEqual([
      { kind: 'set', value: 'SFD' },
      { kind: 'type', value: 'rune' },
      { kind: 'location', value: 'Lands' },
    ]);
  });

  it('reads a combination in the order written, with where each term sits', () => {
    const q = 'signet  t:gear loc:"Staples binder" is:real domain:mind f:foil set:ogn';
    const terms = parseCollectionQuery(q);
    expect(terms.map((term) => term.kind)).toEqual([
      'name',
      'type',
      'location',
      'proxy',
      'domain',
      'finish',
      'set',
    ]);
    for (const term of terms) expect(q.slice(term.start, term.end)).toBe(term.text);
    expect(terms[2]).toEqual({
      kind: 'location',
      value: 'Staples binder',
      text: 'loc:"Staples binder"',
      start: 15,
      end: 35,
    });
  });

  it('lets a chip be removed by cutting its text out', () => {
    const q = 't:unit f:foil';
    const foil = parseCollectionQuery(q)[1];
    if (!foil) throw new Error('expected two terms');
    expect(filters(`${q.slice(0, foil.start)}${q.slice(foil.end)}`)).toEqual([
      { kind: 'type', value: 'unit' },
    ]);
  });

  it('reads an unclosed quote to the end of the text', () => {
    expect(filters('loc:"Rares bin')).toEqual([{ kind: 'location', value: 'Rares bin' }]);
    expect(filters('"daring ban')).toEqual([{ kind: 'name', value: 'daring ban' }]);
  });

  it('marks terms it cannot use as invalid, with a message for Jeff', () => {
    expect(filters('f:shiny')).toEqual([{ kind: 'invalid', message: 'f: takes normal or foil.' }]);
    expect(filters('is:foil')).toEqual([{ kind: 'invalid', message: 'is: takes proxy or real.' }]);
    expect(filters('domain:green')).toEqual([
      { kind: 'invalid', message: 'domain: takes fury, calm, mind, body, chaos or order.' },
    ]);
    expect(filters('set:')).toEqual([
      { kind: 'invalid', message: 'set: needs a value, such as set:ogn.' },
    ]);
    expect(filters('loc:""')[0]?.kind).toBe('invalid');
    expect(filters('rarity:mythic')).toEqual([
      {
        kind: 'invalid',
        message: "rarity: isn't a search term. Use set:, domain:, t:, f:, is:, loc: or trade:.",
      },
    ]);
  });

  it('skips empty quotes', () => {
    expect(filters('"" signet')).toEqual([{ kind: 'name', value: 'signet' }]);
  });
});

describe('formatCollectionFilter', () => {
  it('writes each filter as the term a person would type', () => {
    expect(formatCollectionFilter({ kind: 'name', value: 'daring banner' })).toBe(
      '"daring banner"',
    );
    expect(formatCollectionFilter({ kind: 'set', value: 'OGN' })).toBe('set:ogn');
    expect(formatCollectionFilter({ kind: 'domain', value: 'fury' })).toBe('domain:fury');
    expect(formatCollectionFilter({ kind: 'type', value: 'unit' })).toBe('t:unit');
    expect(formatCollectionFilter({ kind: 'finish', value: 'normal' })).toBe('f:normal');
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
      { kind: 'name', value: 'ember' },
      { kind: 'set', value: 'OGN' },
      { kind: 'domain', value: 'chaos' },
      { kind: 'type', value: 'champion unit' },
      { kind: 'finish', value: 'foil' },
      { kind: 'proxy', value: false },
      { kind: 'location', value: 'Long box' },
      { kind: 'trade', value: true },
    ];
    expect(filters(all.map(formatCollectionFilter).join(' '))).toEqual(all);
  });
});
