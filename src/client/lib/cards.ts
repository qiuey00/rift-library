import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { CardDetailsResponse, CardSearchResponse } from '../../shared/api/cards';
import { ErrorBody } from '../../shared/api/common';
import { api } from '../api';

/** The most results the top bar search box lists. */
export const SEARCH_LIMIT = 8;

/** An answer that isn't 2xx, carrying the server's code and its message for Jeff. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function read<T>(res: Response, schema: { parse: (body: unknown) => T }): Promise<T> {
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) {
    return schema.parse(body);
  }
  const error = ErrorBody.safeParse(body);
  throw error.success
    ? new ApiError(res.status, error.data.error.code, error.data.error.message)
    : new ApiError(res.status, 'internal_error', "Couldn't reach the app. Is it still running?");
}

/** Cards whose names match the words typed; nothing is asked while the box is empty. */
export function useCardSearch(text: string) {
  const q = text.trim();
  return useQuery({
    queryKey: ['cards', 'search', q],
    queryFn: async () =>
      read(
        await api.cards.search.$get({ query: { q, limit: String(SEARCH_LIMIT) } }),
        CardSearchResponse,
      ),
    enabled: q !== '',
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** One card, its printings and Jeff's counts, for the card page. */
export const cardDetailsQuery = (oracleId: string) =>
  queryOptions({
    queryKey: ['cards', oracleId],
    queryFn: async () =>
      read(await api.cards[':oracleId'].$get({ param: { oracleId } }), CardDetailsResponse),
    retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 2,
  });
