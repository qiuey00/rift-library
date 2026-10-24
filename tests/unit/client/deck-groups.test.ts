import { describe, expect, it } from 'vitest';
import { deckTags, groupSlots, missingQuantity } from '../../../src/client/lib/deck-groups';
import type { Board, CardType } from '../../../src/shared/api/common';
import type { SlotRow } from '../../../src/shared/api/decks';
import { jinxBurnSlots } from '../../../src/shared/api/samples/decks';

const withType = (type: CardType, name: string, board: Board = 'main'): SlotRow => {
  const base = jinxBurnSlots[1] as SlotRow;
  return { ...base, board, card: { ...base.card, name, type } };
};

describe('groupSlots by type', () => {
  it('groups the main deck by card type and the other boards by board', () => {
    const groups = groupSlots(
      [
        withType('unit', 'Wild Shaman'),
        withType('gear', 'Sun Disc'),
        withType('spell', 'Ember Rebuke'),
        withType('battlefield', 'Grim Steppe', 'battlefield'),
        withType('legend', 'Jinx, Loose Cannon', 'legend'),
        withType('unit', 'Jinx, Rebel', 'champion'),
        withType('rune', 'Fury Rune', 'rune'),
        withType('token', 'Sprite'),
        withType('spell', 'Dusk Lash', 'sideboard'),
      ],
      'type',
      'name',
    ).decklist;
    expect(groups.map((g) => [g.title, g.slots.map((s) => s.card.name)])).toEqual([
      ['Legend', ['Jinx, Loose Cannon']],
      ['Chosen Champion', ['Jinx, Rebel']],
      ['Units', ['Wild Shaman']],
      ['Spells', ['Ember Rebuke']],
      ['Gear', ['Sun Disc']],
      ['Other', ['Sprite']],
      ['Battlefields', ['Grim Steppe']],
      ['Runes', ['Fury Rune']],
      ['Sideboard', ['Dusk Lash']],
    ]);
  });

  it('counts by quantity and keeps runes in Runes', () => {
    const runes = groupSlots(jinxBurnSlots, 'type', 'name').decklist.find((g) => g.key === 'rune');
    expect(runes?.slots.map((s) => s.card.name)).toContain('Calm Rune');
    expect(runes?.count).toBe(17);
  });
});

describe('groupSlots by where it is', () => {
  it('follows the status order', () => {
    const { decklist } = groupSlots(jinxBurnSlots, 'where', 'name');
    expect(decklist.map((g) => [g.title, g.count])).toEqual([
      ['In deck box', 58],
      ['Free in storage', 13],
      ['Only in other decks', 4],
      ['Missing', 3],
      ['Runes', 17],
    ]);
  });
});

describe('groupSlots by tag', () => {
  const tagged = (
    name: string,
    type: CardType,
    tags: string[],
    quantity = 1,
    board: Board = 'main',
  ): SlotRow => ({ ...withType(type, name, board), tags, quantity });
  const slots = [
    tagged('Jinx, Loose Cannon', 'legend', ['Ramp'], 1, 'legend'),
    tagged('Jinx, Rebel', 'unit', [], 1, 'champion'),
    tagged('Sun Disc', 'gear', ['Ramp']),
    tagged('Copper Mender', 'unit', ['Card draw', 'ramp']),
    tagged('Ember Rebuke', 'spell', ['removal']),
    tagged('Calm Rune', 'rune', [], 9, 'rune'),
    tagged('Wild Shaman', 'unit', []),
  ];

  it('makes Legend, Chosen Champion, a group per tag by name, Runes, then Untagged', () => {
    const { decklist } = groupSlots(slots, 'tag', 'name');
    expect(decklist.map((g) => [g.title, g.count, g.slots.map((s) => s.card.name)])).toEqual([
      ['Legend', 1, ['Jinx, Loose Cannon']],
      ['Chosen Champion', 1, ['Jinx, Rebel']],
      ['Card draw', 1, ['Copper Mender']],
      ['Ramp', 2, ['Copper Mender', 'Sun Disc']],
      ['removal', 1, ['Ember Rebuke']],
      ['Runes', 9, ['Calm Rune']],
      ['Untagged', 1, ['Wild Shaman']],
    ]);
  });

  it('filters both boards by a tag or Untagged under any grouping', () => {
    const withMaybe = [...slots, tagged('Iron Insight', 'spell', ['Ramp'], 1, 'maybe')];
    const ramp = groupSlots(withMaybe, 'type', 'name', { kind: 'tag', key: 'ramp' });
    expect(ramp.decklist.flatMap((g) => g.slots.map((s) => s.card.name))).toEqual([
      'Jinx, Loose Cannon',
      'Copper Mender',
      'Sun Disc',
    ]);
    expect(ramp.maybe.flatMap((g) => g.slots.map((s) => s.card.name))).toEqual(['Iron Insight']);
    const untagged = groupSlots(withMaybe, 'tag', 'name', { kind: 'untagged' });
    expect(untagged.decklist.map((g) => g.title)).toEqual(['Chosen Champion', 'Runes', 'Untagged']);
    expect(untagged.maybe).toEqual([]);
  });

  it('lists the deck tags once each, by name ignoring case', () => {
    expect(deckTags(slots)).toEqual([
      { key: 'card-draw', name: 'Card draw' },
      { key: 'ramp', name: 'Ramp' },
      { key: 'removal', name: 'removal' },
    ]);
  });
});

describe('groupSlots on the maybe board', () => {
  const maybe = (type: CardType, name: string): SlotRow => ({
    ...withType(type, name, 'maybe'),
    status: null,
  });
  const slots = [
    ...jinxBurnSlots.filter((s) => s.board !== 'maybe'),
    maybe('spell', 'Unbound Volley'),
    maybe('unit', 'Wild Shaman'),
    maybe('gear', 'Sun Disc'),
    maybe('unit', 'Primal Priest'),
  ];

  it('keeps maybe cards out of the decklist, in type groups of their own', () => {
    for (const groupBy of ['type', 'where'] as const) {
      const { decklist, maybe: groups } = groupSlots(slots, groupBy, 'name');
      expect(decklist.flatMap((g) => g.slots).some((s) => s.board === 'maybe')).toBe(false);
      expect(groups.map((g) => [g.title, g.slots.map((s) => s.card.name)])).toEqual([
        ['Units', ['Primal Priest', 'Wild Shaman']],
        ['Spells', ['Unbound Volley']],
        ['Gear', ['Sun Disc']],
      ]);
    }
  });

  it('is empty when the deck has no maybe cards', () => {
    expect(groupSlots(jinxBurnSlots.slice(0, 3), 'type', 'name').maybe).toEqual([]);
  });
});

describe('missingQuantity', () => {
  it('is what the box and free storage do not cover', () => {
    const base = jinxBurnSlots.find((s) => s.status === 'missing') as SlotRow;
    expect(missingQuantity(base)).toBe(1);
    expect(missingQuantity({ ...base, status: 'free', quantity: 3, inBoxQuantity: 1 })).toBe(2);
    expect(missingQuantity({ ...base, status: 'other_decks' })).toBe(0);
    expect(missingQuantity({ ...base, status: null })).toBe(0);
  });
});
