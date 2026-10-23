import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { useState } from 'react';
import type { StackRow } from '../../shared/api/common';
import type { CardCopies, CopyCounts } from '../../shared/api/stacks';
import { api } from '../api';
import { AddCardDialog } from './AddCardDialog';
import { type CopyStackAction, CopyStackTable } from './CopyStackTable';
import { MoveToDialog } from './MoveToDialog';
import { Panel } from './Panel';
import { Button } from './ui/button';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function fetchCardCopies(oracleId: string): Promise<CardCopies> {
  const res = await api.cards[':oracleId'].copies.$get({ param: { oracleId } });
  if (!res.ok) {
    throw new Error("Couldn't load your copies of this card.");
  }
  return res.json();
}

/** The card page's list of Jeff's copies of a card and where each is. */
export function CardCopiesSection({ oracleId }: { oracleId: string }) {
  const query = useQuery({
    queryKey: ['cards', oracleId, 'copies'],
    queryFn: () => fetchCardCopies(oracleId),
  });
  const [moving, setMoving] = useState<StackRow[] | null>(null);
  const [adding, setAdding] = useState(false);

  const actions: CopyStackAction[] = [
    { label: 'Move to', icon: ArrowRightLeft, onClick: (selected) => setMoving(selected) },
  ];

  return (
    <section aria-labelledby="card-copies-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="card-copies-title" className="font-bold text-[17px]">
          Copies
        </h2>
        {query.data && query.data.rows.length > 0 && <Counts counts={query.data.counts} />}
      </div>

      {query.isPending ? (
        <Panel className="p-5 text-muted-foreground">Loading your copies…</Panel>
      ) : query.isError ? (
        <Panel role="alert" className="p-5 text-status-missing">
          {query.error.message}
        </Panel>
      ) : query.data.rows.length === 0 ? (
        <Panel className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-muted-foreground">No copies yet</p>
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add copies
          </Button>
        </Panel>
      ) : (
        <CopyStackTable rows={query.data.rows} actions={actions} viewKey="card-copies-view" />
      )}

      <MoveToDialog
        open={moving !== null}
        onOpenChange={(open) => !open && setMoving(null)}
        stacks={moving ?? []}
      />
      <AddCardDialog open={adding} onOpenChange={setAdding} defaultOracleId={oracleId} />
    </section>
  );
}

function Counts({ counts }: { counts: CopyCounts }) {
  const owned =
    counts.proxies > 0
      ? `${counts.owned} owned (${plural(counts.proxies, 'proxy', 'proxies')})`
      : `${counts.owned} owned`;
  return (
    <p data-testid="card-copies-counts" className="text-muted-foreground">
      {owned} · {counts.inDecks} in decks · {counts.free} free
    </p>
  );
}
