import { z } from 'zod';
import { IdParam } from './common';

// The undo area. Undo writes reverse movements; it never deletes history.
// Routes in src/server/routes/undo.ts, both answering with an `ActionResult`:
//
// - POST /api/movements/:id/undo undoes one movement.
// - POST /api/batches/:id/undo undoes a batch's movements, newest first.
//
// The result's batchId is null, because an undo can't itself be undone. Error: 409
// `cannot_undo` when copies have moved since, with a message saying what moved, such as
// "Arcane Signet has moved since. It is now in Rares binder." Nothing changes then.

/** `:id` in /api/movements/:id/undo and /api/batches/:id/undo. */
export const UndoParams = z.object({ id: IdParam });
