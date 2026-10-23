import { CircleAlert, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Panel } from '../components/Panel';
import { Button } from '../components/ui/button';
import { isCardDataBusy, useCardDataStatus, useRefreshCardData } from '../lib/card-data';

const fileDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const checkedAt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const count = new Intl.NumberFormat();

/** App settings (`/settings`): for now, the card data panel. */
export function Settings() {
  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-8 pt-8 pb-12">
      <h1 className="font-serif text-[44px] leading-[1.05]">Settings</h1>
      <CardDataPanel />
    </div>
  );
}

/** Where the card data came from, how much there is, and the Refresh card data button. */
function CardDataPanel() {
  const { data: status, error: statusError } = useCardDataStatus();
  const refresh = useRefreshCardData();

  const running = refresh.isPending || (status !== undefined && isCardDataBusy(status));
  const error = refresh.error?.message ?? status?.error ?? statusError?.message ?? null;

  return (
    <Panel role="region" aria-labelledby="card-data-title" className="flex max-w-[720px] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <h2 id="card-data-title" className="font-bold text-lg">
            Card data
          </h2>
          <p className="text-muted-foreground text-sm">
            Card names, sets and pictures come from Scryfall. The app checks for new data once a
            day.
          </p>
        </div>
        <Button variant="outline" disabled={running} onClick={() => refresh.mutate()}>
          <RefreshCw aria-hidden="true" className={running ? 'animate-spin' : undefined} />
          Refresh card data
        </Button>
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2.5 px-5 py-4 text-[15px]">
        <Row label="Scryfall file date">
          {status?.bulkUpdatedAt
            ? fileDate.format(new Date(status.bulkUpdatedAt))
            : 'Not loaded yet'}
        </Row>
        <Row label="Last checked">
          {status?.lastCheckedAt ? checkedAt.format(new Date(status.lastCheckedAt)) : 'Never'}
        </Row>
        <Row label="Cards">{status ? count.format(status.cardCount) : '…'}</Row>
        <Row label="Printings">{status ? count.format(status.printingCount) : '…'}</Row>
      </dl>

      {error && (
        <div
          role="alert"
          className="mx-5 mb-5 flex gap-2.5 rounded-lg bg-status-missing-soft px-3.5 py-3 text-sm text-status-missing"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </>
  );
}
