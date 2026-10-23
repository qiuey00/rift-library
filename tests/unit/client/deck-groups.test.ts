import { describe, expect, it } from 'vitest';
import { manaSymbols } from '../../../src/client/components/ManaCost';
import { deckTags, groupSlots, missingQuantity } from '../../../src/client/lib/deck-groups';
import type { SlotRow } from '../../../src/shared/api/decks';
import { hearthhullSlots } from '../../../src/shared/api/samples/decks';

const withType = (typeLine: string, name = typeLine): SlotRow => {
  const base = hearthhullSlots[1] as SlotRow;
  return { ...base, card: { ...base.card, name, typeLine } };
};

describe('groupSlots by type', () => {
  it('puts each card in the first group its front face matches', () => {
    const groups = groupSlots(
      [
        withType('Artifact Creature — Golem'),
        withType('Legendary Enchantment Artifact'),
        withType('Kindred Sorcery — Shapeshifter'),
        withType('Land Creature — Forest Dryad'),
        withType('Instant // Land', 'Modal'),
        withType('Battle — Siege'),
        withType('Legendary Planeswalker — Ajani'),
      ],
      'type',
      'name',
    ).decklist;
    expect(groups.map((g) => [g.title, g.slots.map((s) => s.card.name)])).toEqual([
      ['Creatures', ['Artifact Creature — Golem', 'Land Creature — Forest Dryad']],
      ['Planeswalkers', ['Legendary Planeswalker — Ajani']],
      ['Battles', ['Battle — Siege']],
      ['Instants', ['Modal']],
      ['Sorceries', ['Kindred Sorcery — Shapeshifter']],
      ['Artifacts', ['Legendary Enchantment Artifact']],
    ]);
  });

  it('counts by quantity and keeps basics in Lands', () => {
    const lands = groupSlots(hearthhullSlots, 'type', 'name').decklist.find(
      (g) => g.key === 'Land',
    );
    expect(lands?.slots.map((s) => s.card.name)).toContain('Forest');
    expect(lands?.count).toBe(lands?.slots.reduce((n, s) => n + s.quantity, 0));
  });
});

describe('groupSlots by where it is', () => {
  it('follows the status order', () => {
    const { decklist } = groupSlots(hearthhullSlots, 'where', 'name');
    expect(decklist.map((g) => [g.title, g.count])).toEqual([
      ['In deck box', 58],
      ['Free in storage', 13],
      ['Only in other decks', 4],
      ['Missing', 3],
      ['Basic lands', 17],
    ]);
  });
});

describe('groupSlots by tag', () => {
  const tagged = (name: string, typeLine: string, tags: string[], quantity = 1): SlotRow => ({
    ...withType(typeLine, name),
    tags,
    quantity,
  });
  const commander: SlotRow = {
    ...tagged('Hearthhull', 'Legendary Artifact — Spacecraft', ['Ramp']),
    board: 'commander',
  };
  const slots = [
    commander,
    tagged('Sol Ring', 'Artifact', ['Ramp']),
    tagged('Augur of Autumn', 'Creature — Human Druid', ['Card draw', 'ramp']),
    tagged('Field of Ruin', 'Land', ['removal']),
    tagged('Forest', 'Basic Land — Forest', [], 9),
    tagged('Llanowar Elves', 'Creature — Elf', []),
  ];

  it('makes Commander, a group per tag by name, Lands, then Untagged', () => {
    const { decklist } = groupSlots(slots, 'tag', 'name');
    expect(decklist.map((g) => [g.title, g.count, g.slots.map((s) => s.card.name)])).toEqual([
      ['Commander', 1, ['Hearthhull']],
      ['Card draw', 1, ['Augur of Autumn']],
      ['Ramp', 2, ['Augur of Autumn', 'Sol Ring']],
      ['removal', 1, ['Field of Ruin']],
      ['Lands', 9, ['Forest']],
      ['Untagged', 1, ['Llanowar Elves']],
    ]);
  });

  it('filters both boards by a tag or Untagged under any grouping', () => {
    const withMaybe = [
      ...slots,
      { ...tagged('Farseek', 'Sorcery', ['Ramp']), board: 'maybe' as const },
    ];
    const ramp = groupSlots(withMaybe, 'type', 'name', { kind: 'tag', key: 'ramp' });
    expect(ramp.decklist.flatMap((g) => g.slots.map((s) => s.card.name))).toEqual([
      'Hearthhull',
      'Augur of Autumn',
      'Sol Ring',
    ]);
    expect(ramp.maybe.flatMap((g) => g.slots.map((s) => s.card.name))).toEqual(['Farseek']);
    const untagged = groupSlots(withMaybe, 'tag', 'name', { kind: 'untagged' });
    expect(untagged.decklist.map((g) => g.title)).toEqual(['Lands', 'Untagged']);
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
  const maybe = (typeLine: string, name: string): SlotRow => ({
    ...withType(typeLine, name),
    board: 'maybe',
    status: null,
  });
  const slots = [
    ...hearthhullSlots.filter((s) => s.board !== 'maybe'),
    maybe('Instant', 'Beast Within'),
    maybe('Creature — Elf', 'Llanowar Elves'),
    maybe('Land', 'Bojuka Bog'),
    maybe('Creature — Centaur', 'Centaur Vinecrasher'),
  ];

  it('keeps maybe cards out of the decklist, in type groups of their own', () => {
    for (const groupBy of ['type', 'where'] as const) {
      const { decklist, maybe: groups } = groupSlots(slots, groupBy, 'name');
      expect(decklist.flatMap((g) => g.slots).some((s) => s.board === 'maybe')).toBe(false);
      expect(groups.map((g) => [g.title, g.slots.map((s) => s.card.name)])).toEqual([
        ['Creatures', ['Centaur Vinecrasher', 'Llanowar Elves']],
        ['Instants', ['Beast Within']],
        ['Lands', ['Bojuka Bog']],
      ]);
    }
  });

  it('is empty when the deck has no maybe cards', () => {
    expect(groupSlots(hearthhullSlots.slice(0, 3), 'type', 'name').maybe).toEqual([]);
  });
});

describe('missingQuantity', () => {
  it('is what the box and free storage do not cover', () => {
    const base = hearthhullSlots.find((s) => s.status === 'missing') as SlotRow;
    expect(missingQuantity(base)).toBe(1);
    expect(missingQuantity({ ...base, status: 'free', quantity: 3, inBoxQuantity: 1 })).toBe(2);
    expect(missingQuantity({ ...base, status: 'other_decks' })).toBe(0);
    expect(missingQuantity({ ...base, status: null })).toBe(0);
  });
});

describe('manaSymbols', () => {
  it('turns a Scryfall cost into Mana font names', () => {
    expect(manaSymbols('{X}{2}{W/U}{G/P}{2/B}')).toEqual(['x', '2', 'wu', 'gp', '2b']);
    expect(manaSymbols('')).toEqual([]);
  });
});
