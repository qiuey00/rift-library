import { useQuery } from '@tanstack/react-query';
import {
  CARD_DATA_BUSY_POLL_MS,
  CARD_DATA_IDLE_POLL_MS,
  cardDataStatusQuery,
  isCardDataBusy,
} from '../lib/card-data';

/**
 * The slim bar under the top bar while card data downloads or loads: "Loading card data…
 * 42%". It also keeps the status fresh for the whole app, every second while card data is
 * on its way and every few minutes otherwise.
 */
export function CardDataProgress() {
  const { data } = useQuery({
    ...cardDataStatusQuery,
    refetchInterval: (query) => {
      const status = query.state.data;
      return !status || isCardDataBusy(status) ? CARD_DATA_BUSY_POLL_MS : CARD_DATA_IDLE_POLL_MS;
    },
  });

  if (data?.state !== 'downloading' && data?.state !== 'loading') {
    return null;
  }
  const percent = Math.round(data.progress * 100);

  return (
    <div
      data-slot="card-data-progress"
      className="flex items-center gap-3 border-border border-b bg-card px-6 py-1.5 text-[13px] text-muted-foreground"
    >
      <span className="whitespace-nowrap">Loading card data… {percent}%</span>
      <div
        role="progressbar"
        aria-label="Loading card data"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 max-w-[480px] flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
