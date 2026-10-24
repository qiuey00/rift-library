import { Domain } from '../../shared/api/common';
import type { SlotRow } from '../../shared/api/decks';

// How the deck view groups and sorts the main deck, sideboard and maybe board. The Legend,
// Chosen Champion, battlefields and runes have panels of their own. Only the layout is worked
// out here: every status, location and count comes from the server.

export type GroupBy = 'type' | 'where' | 'domain' | 'tag';
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

/** The boards the deck view groups, each in a panel of its own. */
export type GroupedBoards = { main: SlotGroup[]; sideboard: SlotGroup[]; maybe: SlotGroup[] };

function typeGroupKey(slot: SlotRow): string {
  const { type } = slot.card;
  return type === 'unit' || type === 'spell' || type === 'gear' ? type : 'other';
}

const typeGroups: [string, string][] = [
  ['unit', 'Units'],
  ['spell', 'Spells'],
  ['gear', 'Gear'],
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
];

const domainWords = (domain: Domain) => domain[0].toUpperCase() + domain.slice(1);

/** A card's domains in the order the app always lists them, such as "fury-chaos"; "" for none. */
function domainGroupKey(slot: SlotRow): string {
  return Domain.options.filter((domain) => slot.card.domains.includes(domain)).join('-');
}

/** One domain before two, each in domain order, and cards with no domain last. */
function compareDomainKeys(a: string, b: string): number {
  const split = (key: string) => (key === '' ? [] : (key.split('-') as Domain[]));
  const [da, db] = [split(a), split(b)];
  if (da.length === 0 || db.length === 0) return db.length - da.length;
  if (da.length !== db.length) return da.length - db.length;
  for (let i = 0; i < da.length; i++) {
    const diff = Domain.options.indexOf(da[i]) - Domain.options.indexOf(db[i]);
    if (diff !== 0) return diff;
  }
  return 0;
}

function domainTitle(key: string): string {
  if (key === '') return 'Colorless';
  return (key.split('-') as Domain[]).map(domainWords).join(' and ');
}

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
 * The main deck's, sideboard's and maybe board's groups, in order, leaving out empty ones.
 * The tag filter applies to all three.
 */
export function groupSlots(
  allSlots: SlotRow[],
  groupBy: GroupBy,
  sortBy: SortBy,
  tagFilter: TagFilter = { kind: 'any' },
): GroupedBoards {
  const slots = allSlots.filter((slot) => passes(slot, tagFilter));
  const on = (board: SlotRow['board']) => slots.filter((slot) => slot.board === board);
  return {
    main: groupsOf(on('main'), groupBy, sortBy),
    sideboard: groupsOf(on('sideboard'), groupBy, sortBy),
    // Maybe cards have no status, so under Where it is the maybe board groups by type.
    maybe: groupsOf(on('maybe'), groupBy === 'where' ? 'type' : groupBy, sortBy),
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

/** One group per tag by name, then Untagged. A card with several tags shows under each of them. */
function tagGroups(slots: SlotRow[], sortBy: SortBy): SlotGroup[] {
  const sort = sorts[sortBy];
  const groups = [
    ...deckTags(slots).map(({ key, name }) =>
      group(
        `tag:${key}`,
        name,
        slots.filter((slot) => slot.tags.some((tag) => tagKey(tag) === key)),
        sort,
      ),
    ),
    group(
      'untagged',
      'Untagged',
      slots.filter((slot) => slot.tags.length === 0),
      sort,
    ),
  ];
  return groups.filter((g) => g.slots.length > 0);
}

function domainGroups(slots: SlotRow[], sortBy: SortBy): SlotGroup[] {
  const keys = [...new Set(slots.map(domainGroupKey))].sort(compareDomainKeys);
  return keys.map((key) =>
    group(
      `domain:${key}`,
      domainTitle(key),
      slots.filter((slot) => domainGroupKey(slot) === key),
      sorts[sortBy],
    ),
  );
}

function groupsOf(slots: SlotRow[], groupBy: GroupBy, sortBy: SortBy): SlotGroup[] {
  if (groupBy === 'tag') return tagGroups(slots, sortBy);
  if (groupBy === 'domain') return domainGroups(slots, sortBy);
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
