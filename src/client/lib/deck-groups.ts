import type { SlotRow } from '../../shared/api/decks';

// How the deck view groups and sorts its decklist. Only the layout is worked out here: every
// status, location and count comes from the server.

export type GroupBy = 'type' | 'where' | 'tag';
export type SortBy = 'name' | 'mana_value';
/** Which cards the deck view shows: every card, cards with no tag, or cards with one tag (by tag key). */
export type TagFilter = { kind: 'any' } | { kind: 'untagged' } | { kind: 'tag'; key: string };

export type SlotGroup = {
  key: string;
  title: string;
  /** Cards in the group, counted by slot quantity. */
  count: number;
  slots: SlotRow[];
};

/** The type groups after Commander, in deck list order. A card goes in the first its front face matches. */
const cardTypes = [
  ['Creature', 'Creatures'],
  ['Planeswalker', 'Planeswalkers'],
  ['Battle', 'Battles'],
  ['Instant', 'Instants'],
  ['Sorcery', 'Sorceries'],
  ['Artifact', 'Artifacts'],
  ['Enchantment', 'Enchantments'],
  ['Land', 'Lands'],
] as const;

/** The card types on a card's front face, such as ["Legendary", "Artifact"] for "Legendary Artifact — Spacecraft". */
function frontFaceTypes(typeLine: string): string[] {
  const front = typeLine.split(' // ')[0] ?? '';
  const types = front.split(' — ')[0] ?? '';
  return types.split(/\s+/);
}

function typeGroupKey(slot: SlotRow): string {
  if (slot.board === 'commander') return 'commander';
  const types = frontFaceTypes(slot.card.typeLine);
  const match = cardTypes.find(([type]) => types.includes(type));
  return match ? match[0] : 'other';
}

const typeGroups: [string, string][] = [
  ['commander', 'Commander'],
  ...cardTypes.map(([key, title]): [string, string] => [key, title]),
  ['other', 'Other'],
];

function whereGroupKey(slot: SlotRow): string {
  return slot.status ?? '';
}

const whereGroups: [string, string][] = [
  ['in_box', 'In deck box'],
  ['free', 'Free in storage'],
  ['other_decks', 'Only in other decks'],
  ['missing', 'Missing'],
  ['basic', 'Basic lands'],
];

/** Tags with the same key (lower case, spaces as -) are one tag. */
export function tagKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-');
}

/** Every tag in the deck, on any board, once each and sorted by name ignoring case. */
export function deckTags(slots: SlotRow[]): { key: string; name: string }[] {
  const byKey = new Map<string, string>();
  for (const slot of slots) {
    for (const tag of slot.tags) if (!byKey.has(tagKey(tag))) byKey.set(tagKey(tag), tag);
  }
  return [...byKey]
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function passes(slot: SlotRow, filter: TagFilter): boolean {
  if (filter.kind === 'any') return true;
  if (filter.kind === 'untagged') return slot.tags.length === 0;
  return slot.tags.some((tag) => tagKey(tag) === filter.key);
}

const byName = (a: SlotRow, b: SlotRow) => a.card.name.localeCompare(b.card.name);

// The mana value already counts X as 0.
const sorts: Record<SortBy, (a: SlotRow, b: SlotRow) => number> = {
  name: byName,
  mana_value: (a, b) => a.card.manaValue - b.card.manaValue || byName(a, b),
};

/** Free cards stay in location order: by the path of the best location the server named. */
function byLocation(a: SlotRow, b: SlotRow) {
  const pathA = a.where.locations[0]?.path ?? '';
  const pathB = b.where.locations[0]?.path ?? '';
  return pathA.localeCompare(pathB);
}

/**
 * The decklist's groups and the maybe board's, in order, leaving out empty ones. The tag
 * filter applies to both boards.
 */
export function groupSlots(
  allSlots: SlotRow[],
  groupBy: GroupBy,
  sortBy: SortBy,
  tagFilter: TagFilter = { kind: 'any' },
): { decklist: SlotGroup[]; maybe: SlotGroup[] } {
  const slots = allSlots.filter((slot) => passes(slot, tagFilter));
  return {
    decklist: groupsOf(
      slots.filter((slot) => slot.board !== 'maybe'),
      groupBy,
      sortBy,
    ),
    // Maybe cards have no status, so under Where it is the maybe board groups by type.
    maybe: groupsOf(
      slots.filter((slot) => slot.board === 'maybe'),
      groupBy === 'where' ? 'type' : groupBy,
      sortBy,
    ),
  };
}

/** Group sizes count each card once, by slot quantity. */
function group(key: string, title: string, slots: SlotRow[], compare: Compare): SlotGroup {
  return {
    key,
    title,
    count: slots.reduce((sum, slot) => sum + slot.quantity, 0),
    slots: slots.sort(compare),
  };
}

type Compare = (a: SlotRow, b: SlotRow) => number;

/**
 * Commander, then one group per tag by name, then Lands (lands with no tag), then Untagged.
 * A card with several tags shows under each of them.
 */
function tagGroups(slots: SlotRow[], sortBy: SortBy): SlotGroup[] {
  const sort = sorts[sortBy];
  const commanders = slots.filter((slot) => slot.board === 'commander');
  const cards = slots.filter((slot) => slot.board !== 'commander');
  const untagged = cards.filter((slot) => slot.tags.length === 0);
  const isLand = (slot: SlotRow) => frontFaceTypes(slot.card.typeLine).includes('Land');
  const groups = [
    group('commander', 'Commander', commanders, sort),
    ...deckTags(cards).map(({ key, name }) =>
      group(
        `tag:${key}`,
        name,
        cards.filter((slot) => slot.tags.some((tag) => tagKey(tag) === key)),
        sort,
      ),
    ),
    group('untagged-lands', 'Lands', untagged.filter(isLand), sort),
    group(
      'untagged',
      'Untagged',
      untagged.filter((slot) => !isLand(slot)),
      sort,
    ),
  ];
  return groups.filter((g) => g.slots.length > 0);
}

function groupsOf(slots: SlotRow[], groupBy: GroupBy, sortBy: SortBy): SlotGroup[] {
  if (groupBy === 'tag') return tagGroups(slots, sortBy);
  const [order, keyOf] =
    groupBy === 'type' ? [typeGroups, typeGroupKey] : [whereGroups, whereGroupKey];
  const sort = sorts[sortBy];
  return order.flatMap(([key, title]) => {
    const inGroup = slots.filter((slot) => keyOf(slot) === key);
    if (inGroup.length === 0) return [];
    const compare: Compare =
      groupBy === 'where' && key === 'free' ? (a, b) => byLocation(a, b) || sort(a, b) : sort;
    return [group(key, title, inGroup, compare)];
  });
}

/**
 * Copies the slot still lacks: what neither the deck box nor free storage covers. Copies in
 * other decks' boxes cover a slot whose status says so. Zero on the maybe board and for basics.
 */
export function missingQuantity(slot: SlotRow): number {
  if (slot.status === null || slot.status === 'basic' || slot.status === 'other_decks') return 0;
  return Math.max(0, slot.quantity - slot.inBoxQuantity - slot.where.freeCount);
}
