import type { z } from 'zod';
import { CardDetailsResponse } from '../../../shared/api/cards';
import { ActionResult, ErrorBody, type Id } from '../../../shared/api/common';
import { PickListResponse } from '../../../shared/api/pick-list';
import {
  type ProxyRequest,
  ProxyResult,
  type PullRequest,
  PullResult,
} from '../../../shared/api/pulls';
import { api } from '../../api';

/** A failed call: the HTTP status (0 when the server can't be reached) and the server's message. */
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

export const pickListQueryKey = (deckId: Id) => ['pick-list', deckId] as const;

export function fetchPickList(deckId: Id) {
  return answer(
    api.decks[':id']['pick-list'].$get({ param: { id: String(deckId) } }),
    PickListResponse,
  );
}

export function pull(deckId: Id, json: PullRequest) {
  return answer(api.decks[':id'].pulls.$post({ param: { id: String(deckId) }, json }), PullResult);
}

export function addProxy(deckId: Id, json: ProxyRequest) {
  return answer(
    api.decks[':id'].proxies.$post({ param: { id: String(deckId) }, json }),
    ProxyResult,
  );
}

export function undoMovement(movementId: Id) {
  return answer(
    api.movements[':id'].undo.$post({ param: { id: String(movementId) } }),
    ActionResult,
  );
}

export function fetchCard(oracleId: string) {
  return answer(api.cards[':oracleId'].$get({ param: { oracleId } }), CardDetailsResponse);
}
