import type { z } from 'zod';
import { ActionResult, ErrorBody, type Id } from '../../../shared/api/common';
import { type PullRequest, PullResult } from '../../../shared/api/pulls';
import { type ReturnRequest, ReturnResult } from '../../../shared/api/put-away';
import { SwapResponse } from '../../../shared/api/swap';
import { api } from '../../api';

/** A failed call: the HTTP status (0 when the server can't be reached), its code and the message for Jeff. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Waits for a call and checks its answer, or throws an `ApiError` carrying the message for Jeff. */
async function answer<S extends z.ZodType>(
  call: Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
  schema: S,
): Promise<z.infer<S>> {
  let res: Awaited<typeof call>;
  try {
    res = await call;
  } catch {
    throw new ApiError(0, 'unreachable', "Couldn't reach the server. Is the app still running?");
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const parsed = schema.safeParse(body);
    if (parsed.success) return parsed.data;
  }
  const error = ErrorBody.safeParse(body);
  if (error.success) {
    throw new ApiError(res.status, error.data.error.code, error.data.error.message);
  }
  throw new ApiError(res.status, 'unexpected', 'Something went wrong. Try again.');
}

/** The swap list's query key. Under the deck's key, so refreshing the deck refreshes the banner. */
export const swapQueryKey = (deckId: Id) => ['decks', deckId, 'swap'] as const;

export function fetchSwap(deckId: Id) {
  return answer(api.decks[':id'].swap.$get({ param: { id: String(deckId) } }), SwapResponse);
}

export function returnCopies(deckId: Id, json: ReturnRequest) {
  return answer(
    api.decks[':id'].returns.$post({ param: { id: String(deckId) }, json }),
    ReturnResult,
  );
}

export function pull(deckId: Id, json: PullRequest) {
  return answer(api.decks[':id'].pulls.$post({ param: { id: String(deckId) }, json }), PullResult);
}

export function undoMovement(movementId: Id) {
  return answer(
    api.movements[':id'].undo.$post({ param: { id: String(movementId) } }),
    ActionResult,
  );
}
