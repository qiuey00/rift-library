import type { ActionResult, ErrorBody } from '../common';

// Sample answers for the copies area, matching src/shared/api/copies.ts. Screen tests mock
// the API with them; the stub routes return them until #13.

/** POST /api/moves with one whole stack. */
export const moveResultSample: ActionResult = {
  message: 'Moved Arcane Signet to Hearthhull deck box',
  batchId: 103,
};

/** POST /api/moves with several stacks. */
export const moveManyResultSample: ActionResult = {
  message: 'Moved 12 cards to Rares binder',
  batchId: 107,
};

/** POST /api/locations/1/move-contents: emptying To sort into the Bulk tray. */
export const moveContentsResultSample: ActionResult = {
  message: 'Moved 37 cards from To sort to Bulk tray',
  batchId: 108,
};

/** POST /api/stacks/proxy: not a change of location, so nothing to undo. */
export const setProxyResultSample: ActionResult = {
  message: 'Marked 2 stacks as proxies',
  batchId: null,
};

/** POST /api/stacks/add. */
export const addCopiesResultSample: ActionResult = {
  message: 'Added 1 Arcane Signet to Rares binder',
  batchId: 109,
};

/** POST /api/moves when a stack no longer holds the copies. */
export const staleCopyErrorSample: ErrorBody = {
  error: { code: 'stale_copy', message: 'This copy has moved, pick another' },
};
