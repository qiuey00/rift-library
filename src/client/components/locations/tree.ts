import { ErrorBody, type Id } from '../../../shared/api/common';
import type { LocationNode } from '../../../shared/api/locations';

/** The tree's sections under the inbox, in screen order. */
export type TreeSection = 'storage' | 'trade' | 'deckBoxes';

/** Each section's heading, also used in the selected location's breadcrumb. */
export const sectionTitles: Record<TreeSection | 'inbox', string> = {
  inbox: 'To sort',
  storage: 'Storage',
  trade: 'Trade binders',
  deckBoxes: 'Deck boxes',
};

/** The tree as the Locations screen shows it: the inbox pinned on top, then three sections. */
export type TreeGroups = {
  inbox: LocationNode | undefined;
  /** Boxes, binders and trays, in tree order. */
  storage: LocationNode[];
  /** Top-level locations marked for trade and anything inside them, in tree order. */
  trade: LocationNode[];
  /** Top-level deck boxes and anything inside them, in tree order. */
  deckBoxes: LocationNode[];
};

/** Splits the server's tree (already in order) into the inbox and the screen's sections. */
export function groupTree(nodes: LocationNode[]): TreeGroups {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const topOf = (node: LocationNode) => {
    let at = node;
    for (let parent = byId.get(at.parentId ?? -1); parent; parent = byId.get(at.parentId ?? -1)) {
      at = parent;
    }
    return at;
  };
  const groups: TreeGroups = { inbox: undefined, storage: [], trade: [], deckBoxes: [] };
  for (const node of nodes) {
    const top = topOf(node);
    if (node.type === 'inbox') groups.inbox = node;
    else if (top.type === 'deck_box') groups.deckBoxes.push(node);
    else if (top.forTrade) groups.trade.push(node);
    else groups.storage.push(node);
  }
  return groups;
}

/** Which part of the tree a location is listed in. */
export function sectionOf(groups: TreeGroups, node: LocationNode): TreeSection | 'inbox' {
  if (node.id === groups.inbox?.id) return 'inbox';
  if (groups.deckBoxes.includes(node)) return 'deckBoxes';
  if (groups.trade.includes(node)) return 'trade';
  return 'storage';
}

/** The ids of every location inside this one, at any depth. */
export function descendantIds(nodes: LocationNode[], id: Id): Id[] {
  const found: Id[] = [];
  const queue = [id];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    for (const node of nodes) {
      if (node.parentId === at) {
        found.push(node.id);
        queue.push(node.id);
      }
    }
  }
  return found;
}

/** The locations a Move up or Move down swaps with: the same parent, in the same group. */
export function neighbours(group: LocationNode[], node: LocationNode) {
  const siblings = group.filter((other) => other.parentId === node.parentId);
  const index = siblings.findIndex((other) => other.id === node.id);
  return { before: siblings[index - 1], after: siblings[index + 1] };
}

/** The error message a failed answer carries, written for Jeff. */
export async function failure(res: Response, fallback: string): Promise<Error> {
  const body = ErrorBody.safeParse(await res.json().catch(() => null));
  return new Error(body.success ? body.data.error.message : fallback);
}

/** The colors a location can have, from the location colors board. */
export const locationColors = [
  { name: 'Blue', value: '#3b6fd8' },
  { name: 'Purple', value: '#7c5cd6' },
  { name: 'Teal', value: '#1b9aa0' },
  { name: 'Brown', value: '#8a6248' },
  { name: 'Green', value: '#2f9e5b' },
  { name: 'Red', value: '#d1453b' },
  { name: 'Orange', value: '#d9822b' },
  { name: 'Pink', value: '#c2477f' },
] as const;

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}
