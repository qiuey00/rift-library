import { describe, expect, it } from 'vitest';
import { deckTags, groupSlots, missingQuantity } from '../../../src/client/lib/deck-groups';
import type { Board, CardType, Domain } from '../../../src/shared/api/common';
import type { SlotRow } from '../../../src/shared/api/decks';
import { jinxBurnSlots } from '../../../src/shared/api/samples/decks';

const withType = (type: CardType, name: string, board: Board = 'main'): SlotRow => {
  const base = jinxBurnSlots[1] as SlotRow;
  return { ...base, board, card: { ...base.card, name, type } };
};

describe('groupSlots by type', () => {
  it('groups the main deck by card type, leaving the boards with panels of their own out', () => {
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
    );
    expect(groups.main.map((g) => [g.title, g.slots.map((s) => s.card.name)])).toEqual([
      ['Units', ['Wild Shaman']],
      ['Spells', ['Ember Rebuke']],
      ['Gear', ['Sun Disc']],
      ['Other', ['Sprite']],
    ]);
    expect(groups.sideboard.map((g) => [g.title, g.slots.map((s) => s.card.name)])).toEqual([
      ['Spells', ['Dusk Lash']],
    ]);
  });

  it('counts by quantity', () => {
    const units = groupSlots(
      [{ ...withType('unit', 'Wild Shaman'), quantity: 3 }, withType('unit', 'Swift Ox')],
      'type',
      'name',
    ).main;
    expect(units.map((g) => [g.title, g.count])).toEqual([['Units', 4]]);
  });
});

describe('groupSlots by where it is', () => {
  it('follows the status order, with no runes in the main deck', () => {
    const { main } = groupSlots(jinxBurnSlots, 'where', 'name');
    expect(main.map((g) => [g.title, g.count])).toEqual([
      ['In deck box', 54],
      ['Free in storage', 13],
      ['Only in other decks', 4],
      ['Missing', 3],
    ]);
  });
});

describe('groupSlots by domain', () => {
  const inDomains = (name: string, domains: Domain[]): SlotRow => {
    const slot = withType('unit', name);
    return { ...slot, card: { ...slot.card, domains } };
  };

  it('puts one domain before two, in domain order, and colorless cards last', () => {
    const { main } = groupSlots(
      [
        inDomains('Gold Coin', []),
        inDomains('Vex Gloom', ['chaos', 'fury']),
        inDomains('Swift Ox', ['chaos']),
        inDomains('Fierce Blast', ['fury']),
        inDomains('Ember Rebuke', ['fury']),
      ],
      'domain',
      'name',
    );
    expect(main.map((g) => [g.title, g.slots.map((s) => s.card.name)])).toEqual([
      ['Fury', ['Ember Rebuke', 'Fierce Blast']],
      ['Chaos', ['Swift Ox']],
      ['Fury and Chaos', ['Vex Gloom']],
      ['Colorless', ['Gold Coin']],
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
    tagged('Sun Disc', 'gear', ['Ramp']),
    tagged('Copper Mender', 'unit', ['Card draw', 'ramp']),
    tagged('Ember Rebuke', 'spell', ['removal']),
    tagged('Calm Rune', 'rune', [], 9, 'rune'),
    tagged('Wild Shaman', 'unit', []),
  ];

  it('makes a group per tag by name, then Untagged', () => {
    const { main } = groupSlots(slots, 'tag', 'name');
    expect(main.map((g) => [g.title, g.count, g.slots.map((s) => s.card.name)])).toEqual([
      ['Card draw', 1, ['Copper Mender']],
      ['Ramp', 2, ['Copper Mender', 'Sun Disc']],
      ['removal', 1, ['Ember Rebuke']],
      ['Untagged', 1, ['Wild Shaman']],
    ]);
  });

  it('filters every grouped board by a tag or Untagged under any grouping', () => {
    const withMore = [
      ...slots,
      tagged('Iron Insight', 'spell', ['Ramp'], 1, 'maybe'),
      tagged('Dusk Lash', 'spell', [], 1, 'sideboard'),
    ];
    const ramp = groupSlots(withMore, 'type', 'name', { kind: 'tag', key: 'ramp' });
    expect(ramp.main.flatMap((g) => g.slots.map((s) => s.card.name))).toEqual([
      'Copper Mender',
      'Sun Disc',
    ]);
    expect(ramp.maybe.flatMap((g) => g.slots.map((s) => s.card.name))).toEqual(['Iron Insight']);
    expect(ramp.sideboard).toEqual([]);
    const untagged = groupSlots(withMore, 'tag', 'name', { kind: 'untagged' });
    expect(untagged.main.map((g) => g.title)).toEqual(['Untagged']);
    expect(untagged.sideboard.map((g) => g.title)).toEqual(['Untagged']);
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

  it('keeps maybe cards out of the main deck, in type groups of their own', () => {
    for (const groupBy of ['type', 'where'] as const) {
      const { main, maybe: groups } = groupSlots(slots, groupBy, 'name');
      expect(main.flatMap((g) => g.slots).some((s) => s.board === 'maybe')).toBe(false);
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
