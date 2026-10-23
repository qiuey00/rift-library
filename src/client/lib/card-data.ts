import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CardDataStatus } from '../../shared/api/card-data';
import { ErrorBody } from '../../shared/api/common';
import { api } from '../api';

/** How often the frame asks for the status while card data is on its way. */
export const CARD_DATA_BUSY_POLL_MS = 1000;
/** How often the frame asks for the status once nothing is running. */
export const CARD_DATA_IDLE_POLL_MS = 5 * 60 * 1000;

/** True while a download or load runs (or is about to start, on the first start). */
export const isCardDataBusy = (status: CardDataStatus) =>
  status.state === 'idle' || status.state === 'downloading' || status.state === 'loading';

/** Turns an answer that isn't 2xx into an Error carrying the server's message for Jeff. */
async function readStatus(res: Response): Promise<CardDataStatus> {
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) {
    return CardDataStatus.parse(body);
  }
  const error = ErrorBody.safeParse(body);
  throw new Error(
    error.success
      ? error.data.error.message
      : "Couldn't reach the card data. Is the app still running?",
  );
}

/** The card data status, shared by the progress bar, the search box and Settings. */
export const cardDataStatusQuery = queryOptions({
  queryKey: ['card-data', 'status'],
  queryFn: async () => readStatus(await api['card-data'].status.$get()),
});

/**
 * The card data status. Only the app frame polls it (see `CardDataProgress`), so every
 * other screen reads the same answer without asking again.
 */
export function useCardDataStatus() {
  return useQuery({ ...cardDataStatusQuery, staleTime: CARD_DATA_BUSY_POLL_MS });
}

/**
 * Whether there is card data to search: false on the first start, while there are no cards
 * yet. A refresh keeps the old cards until the new ones are in, so it stays true then.
 */
export function useCardDataReady(): boolean {
  const { data } = useCardDataStatus();
  return (data?.cardCount ?? 0) > 0;
}

/** Starts a card data refresh; the status it answers with replaces the one on screen. */
export function useRefreshCardData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => readStatus(await api['card-data'].refresh.$post()),
    onSuccess: (status) => {
      queryClient.setQueryData(cardDataStatusQuery.queryKey, status);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: cardDataStatusQuery.queryKey }),
  });
}
