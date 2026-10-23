import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { BuyItem, BuyList } from '../../src/shared/api/buy-list';
import { CardDecks, DeckChecks, ListChecks } from '../../src/shared/api/deck-checks';
import { DeckList, DeckSummary, DeckView, SlotRow } from '../../src/shared/api/decks';
import { buyItemSample, buyListSample } from '../../src/shared/api/samples/buy-list';
import {
  cardDecksSample,
  deckChecksSample,
  listChecksSample,
} from '../../src/shared/api/samples/deck-checks';
import {
  deckListSample,
  deckViewSample,
  newDeckSample,
  slotSample,
} from '../../src/shared/api/samples/decks';

describe('decks, deck checks and buy list samples', () => {
  it.each([
    ['deck list', DeckList, deckListSample],
    ['deck view', DeckView, deckViewSample],
    ['new deck', DeckSummary, newDeckSample],
    ['slot', SlotRow, slotSample],
    ['deck checks', DeckChecks, deckChecksSample],
    ['list checks', ListChecks, listChecksSample],
    ['card decks', CardDecks, cardDecksSample],
    ['buy list', BuyList, buyListSample],
    ['buy item', BuyItem, buyItemSample],
  ] as const)('the %s sample parses', (_name, schema, sample) => {
    expect(() => (schema as z.ZodType).parse(sample)).not.toThrow();
  });

  it('lists the decks most recently opened first, never-opened last', () => {
    const opened = deckListSample.decks.map((d) => d.openedAt ?? '');
    expect(opened).toEqual([...opened].sort().reverse());
    expect(deckListSample.decks).toHaveLength(6);
  });

  it('matches the Hearthhull counts to its slots', () => {
    const { deck, slots } = deckViewSample;
    const sum = (status: string) =>
      slots.filter((s) => s.status === status).reduce((n, s) => n + s.quantity, 0);
    expect({
      inBox: sum('in_box'),
      free: sum('free'),
      otherDecks: sum('other_decks'),
      missing: sum('missing'),
      basics: sum('basic'),
    }).toEqual(deck.counts);
    expect(slots.reduce((n, s) => n + s.inBoxQuantity, 0)).toBe(deck.boxCopyCount);
    expect(slots.filter((s) => s.board === 'maybe').every((s) => s.status === null)).toBe(true);
    expect(new Set(slots.map((s) => s.id)).size).toBe(slots.length);
  });

  it('has one deck warning of each kind', () => {
    expect(deckChecksSample.warnings.map((w) => w.kind).sort()).toEqual([
      'banned',
      'color_identity',
      'commander',
      'count',
      'singleton',
    ]);
  });
});
