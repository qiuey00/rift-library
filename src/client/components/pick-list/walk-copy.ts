import type { StackRow } from '../../../shared/api/common';
import type { WalkCopy } from '../walk-list';

/** The copy details a walk line shows for a copy stack. */
export function walkCopy(stack: StackRow): WalkCopy {
  return {
    setCode: stack.printing.setCode,
    rarity: stack.printing.rarity,
    collectorNumber: stack.printing.collectorNumber,
    finish: stack.finish,
    condition: stack.condition,
    isProxy: stack.isProxy,
  };
}
