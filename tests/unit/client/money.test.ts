import { describe, expect, it } from 'vitest';
import { formatCents, pricesUpdated } from '../../../src/client/lib/money';

describe('formatCents', () => {
  it('writes cents as dollars', () => {
    expect(formatCents(318450)).toBe('$3,184.50');
  });
});

describe('pricesUpdated', () => {
  const now = new Date(2026, 9, 20, 15, 0);

  it('says today, yesterday, or the date', () => {
    expect(pricesUpdated(new Date(2026, 9, 20, 1, 0).toISOString(), now)).toBe(
      'TCGplayer prices via TCGCSV, updated today',
    );
    expect(pricesUpdated(new Date(2026, 9, 19, 23, 0).toISOString(), now)).toBe(
      'TCGplayer prices via TCGCSV, updated yesterday',
    );
    expect(pricesUpdated(new Date(2026, 9, 12, 9, 0).toISOString(), now)).toBe(
      'TCGplayer prices via TCGCSV, updated Oct 12, 2026',
    );
  });

  it('says when no prices are loaded yet', () => {
    expect(pricesUpdated(null, now)).toBe('no prices loaded yet');
  });
});
