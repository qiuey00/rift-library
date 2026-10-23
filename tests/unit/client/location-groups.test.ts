import { describe, expect, it } from 'vitest';
import { groupTree, sectionOf } from '../../../src/client/components/locations/tree';
import { formatCents } from '../../../src/client/lib/money';
import { locationTreeSample } from '../../../src/shared/api/samples/locations';

const nodes = locationTreeSample.nodes;
const byId = (id: number) => {
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`no location ${id}`);
  return node;
};

describe('groupTree', () => {
  it('puts a top-level trade location in Trade binders and the rest in Storage', () => {
    const groups = groupTree(nodes);
    expect(groups.inbox?.id).toBe(1);
    expect(groups.storage.map((n) => n.id)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(groups.trade.map((n) => n.id)).toEqual([12]);
    expect(groups.deckBoxes.map((n) => n.id)).toEqual([9, 10]);
  });

  it('keeps everything inside a trade binder with it, and trade inside storage where it is', () => {
    // Only the Long box's own flag decides; its sections go with it.
    const marked = nodes.map((n) =>
      n.id === 2 ? { ...n, markedForTrade: true, forTrade: true } : n,
    );
    const inStorage = nodes.map((n) => (n.id === 4 ? { ...n, forTrade: true } : n));
    expect(groupTree(marked).trade.map((n) => n.id)).toEqual([2, 3, 4, 5, 12]);
    expect(groupTree(inStorage).storage.map((n) => n.id)).toContain(4);
    expect(groupTree(inStorage).trade.map((n) => n.id)).toEqual([12]);
  });

  it('names the section each location is listed in', () => {
    const groups = groupTree(nodes);
    expect(sectionOf(groups, byId(1))).toBe('inbox');
    expect(sectionOf(groups, byId(5))).toBe('storage');
    expect(sectionOf(groups, byId(12))).toBe('trade');
    expect(sectionOf(groups, byId(9))).toBe('deckBoxes');
  });
});

describe('formatCents', () => {
  it('writes US dollars with thousands separators', () => {
    expect(formatCents(104620)).toBe('$1,046.20');
    expect(formatCents(0)).toBe('$0.00');
  });
});
