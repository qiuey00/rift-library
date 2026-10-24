import type { ActionResult, ErrorBody } from '../common';

// Sample answers for the undo area, matching src/shared/api/undo.ts. Screen tests mock the
// API with them; the undo routes return the same shape.

/** POST /api/movements/:id/undo. An undo can't be undone, so batchId is null. */
export const undoMovementResultSample: ActionResult = {
  message: 'Undid: moved Ember Signet to Rares binder',
  batchId: null,
};

/** POST /api/batches/:id/undo for a pick list. */
export const undoBatchResultSample: ActionResult = {
  message: 'Undid: pick list · Jinx Burn · 3 cards',
  batchId: null,
};

/** Either undo route when the copies have moved since. */
export const cannotUndoErrorSample: ErrorBody = {
  error: {
    code: 'cannot_undo',
    message: 'Ember Signet has moved since. It is now in Rares binder.',
  },
};
