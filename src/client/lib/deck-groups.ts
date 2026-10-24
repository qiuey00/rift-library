import type { SlotRow } from '../../shared/api/decks';

// How the deck view groups and sorts its decklist. Only the layout is worked out here: every
// status, location and count comes from the server.

export type GroupBy = 'type' | 'where' | 'tag';
export type SortBy = 'name' | 'energy';
/** Which cards the deck view shows: every card, cards with no tag, or cards with one tag (by tag key). */
export type TagFilter = { kind: 'any' } | { kind: 'untagged' } | { kind: 'tag'; key: string };

export type SlotGroup = {
  key: string;
  title: string;
  /** Cards in the group, counted by slot quantity. */
  count: number;
  slots: SlotRow[];
};

/** The boards that are a group of their own under Type, rather than grouped by card type. */
const ownGroupBoards = ['legend', 'champion', 'battlefield', 'rune', 'sideboard'] as const;

function typeGroupKey(slot: SlotRow): string {
  const board = ownGroupBoards.find((b) => b === slot.board);
  if (board) return board;
  const { type } = slot.card;
  return type === 'unit' || type === 'spell' || type === 'gear' ? type : 'other';
}

/** The Type groups in deck list order: the Legend and Chosen Champion first, the main deck by card type, then the other boards. */
const typeGroups: [string, string][] = [
  ['legend', 'Legend'],
  ['champion', 'Chosen Champion'],
  ['unit', 'Units'],
  ['spell', 'Spells'],
  ['gear', 'Gear'],
  ['other', 'Other'],
  ['battlefield', 'Battlefields'],
  ['rune', 'Runes'],
  ['sideboard', 'Sideboard'],
];

function whereGroupKey(slot: SlotRow): string {
  return slot.status ?? '';
}

const whereGroups: [string, string][] = [
  ['in_box', 'In deck box'],
  ['free', 'Free in storage'],
  ['other_decks', 'Only in other decks'],
  ['missing', 'Missing'],
  ['rune', 'Runes'],
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

// Cards with no energy cost (battlefields, runes, the Legend) sort as 0.
const sorts: Record<SortBy, (a: SlotRow, b: SlotRow) => number> = {
  name: byName,
  energy: (a, b) => (a.card.energy ?? 0) - (b.card.energy ?? 0) || byName(a, b),
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
 * The Legend and Chosen Champion, then one group per tag by name, then Runes (runes with no
 * tag), then Untagged. A card with several tags shows under each of them.
 */
function tagGroups(slots: SlotRow[], sortBy: SortBy): SlotGroup[] {
  const sort = sorts[sortBy];
  const isTop = (slot: SlotRow) => slot.board === 'legend' || slot.board === 'champion';
  const cards = slots.filter((slot) => !isTop(slot));
  const untagged = cards.filter((slot) => slot.tags.length === 0);
  const isRune = (slot: SlotRow) => slot.card.type === 'rune';
  const groups = [
    group(
      'legend',
      'Legend',
      slots.filter((slot) => slot.board === 'legend'),
      sort,
    ),
    group(
      'champion',
      'Chosen Champion',
      slots.filter((slot) => slot.board === 'champion'),
      sort,
    ),
    ...deckTags(cards).map(({ key, name }) =>
      group(
        `tag:${key}`,
        name,
        cards.filter((slot) => slot.tags.some((tag) => tagKey(tag) === key)),
        sort,
      ),
    ),
    group('untagged-runes', 'Runes', untagged.filter(isRune), sort),
    group(
      'untagged',
      'Untagged',
      untagged.filter((slot) => !isRune(slot)),
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
 * other decks' boxes cover a slot whose status says so. Zero on the maybe board and for runes.
 */
export function missingQuantity(slot: SlotRow): number {
  if (slot.status === null || slot.status === 'rune' || slot.status === 'other_decks') return 0;
  return Math.max(0, slot.quantity - slot.inBoxQuantity - slot.where.freeCount);
}
