import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, ChevronRight, Plus, ShoppingCart, Upload } from 'lucide-react';
import { useId, useState } from 'react';
import type { StackRow } from '../../../shared/api/common';
import type { LocationNode } from '../../../shared/api/locations';
import type { LocationStacks } from '../../../shared/api/stacks';
import { api } from '../../api';
import { formatCents } from '../../lib/money';
import { AddCardsDialog } from '../AddCardsDialog';
import { AddToBuyListDialog } from '../AddToBuyListDialog';
import { type CopyStackAction, CopyStackTable } from '../CopyStackTable';
import { LocationTile } from '../LocationTile';
import { MoveToDialog } from '../MoveToDialog';
import { Panel } from '../Panel';
import { TradeTag } from '../TradeTag';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { useSetProxy } from '../useSetProxy';
import { failure, plural, sectionTitles, type TreeSection } from './tree';

/**
 * The right pane of the Locations screen: the selected location's header and its copy
 * stacks, optionally with its child locations' stacks.
 */
export function LocationContents({
  location,
  section,
  onExport,
}: {
  location: LocationNode;
  /** Where the tree lists it, named in the breadcrumb. */
  section: TreeSection | 'inbox';
  /** Opens Export list; offered for binders, boxes and trays only. */
  onExport: () => void;
}) {
  const switchId = useId();
  const tradeable = section === 'storage' || section === 'trade';
  const [includeChildren, setIncludeChildren] = useState(false);
  const hasChildren = location.totalCount !== location.cardCount;

  const stacks = useQuery({
    queryKey: ['locations', location.id, 'stacks', includeChildren],
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<LocationStacks> => {
      const res = await api.locations[':id'].stacks.$get({
        param: { id: String(location.id) },
        query: includeChildren ? { includeChildren: '1' } : {},
      });
      if (!res.ok) throw await failure(res, "Couldn't load this location's cards.");
      return res.json();
    },
  });

  const [moving, setMoving] = useState<StackRow[] | null>(null);
  const [buying, setBuying] = useState<StackRow | null>(null);
  const [adding, setAdding] = useState(false);
  const proxy = useSetProxy();

  const actions: CopyStackAction[] = [
    { label: 'Move to', icon: ArrowRightLeft, onClick: (selected) => setMoving(selected) },
    {
      label: 'Mark as proxy',
      onClick: (selected) =>
        proxy.mutate({ stackIds: selected.map((row) => row.stackId), isProxy: true }),
    },
    {
      label: 'Mark as real',
      onClick: (selected) =>
        proxy.mutate({ stackIds: selected.map((row) => row.stackId), isProxy: false }),
    },
    {
      label: 'Add to buy list',
      icon: ShoppingCart,
      // The buy list takes one card at a time: the first selected one, in its printing.
      onClick: (selected) => setBuying(selected[0] ?? null),
    },
  ];

  return (
    <section aria-labelledby={`${switchId}-title`} className="flex min-w-0 flex-col gap-4">
      <Panel className="flex flex-wrap items-center gap-4 p-5">
        <LocationTile type={location.type} color={location.effectiveColor} size="lg" />
        <div className="flex min-w-0 flex-col">
          <nav aria-label="Breadcrumb" className="text-muted-foreground text-xs">
            <ol className="flex items-center gap-1">
              <li>Locations</li>
              {section !== 'inbox' && (
                <li className="flex items-center gap-1">
                  <ChevronRight aria-hidden="true" className="size-3" />
                  {sectionTitles[section]}
                </li>
              )}
            </ol>
          </nav>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id={`${switchId}-title`} className="truncate font-serif text-[28px] leading-tight">
              {location.path}
            </h2>
            {location.forTrade && <TradeTag className="self-center" />}
            <span data-testid="location-value" className="font-semibold text-lg tabular-nums">
              {formatCents(location.value)}
            </span>
          </div>
          <p className="text-muted-foreground text-sm" data-testid="location-total">
            {valueNote(location, hasChildren)}
          </p>
          {location.forTrade && (
            <p className="mt-1 max-w-prose text-sm">
              Marked for trade. These cards are still yours and stay here; decks use them only when
              no other copy is free. Use Export list to share it.
            </p>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id={switchId}
              checked={includeChildren}
              onCheckedChange={setIncludeChildren}
              disabled={!hasChildren}
            />
            <label htmlFor={switchId} className="text-sm">
              Include child locations
            </label>
          </div>
          {tradeable && (
            <Button variant="outline" onClick={onExport}>
              <Upload aria-hidden="true" />
              Export list
            </Button>
          )}
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add card
          </Button>
        </div>
      </Panel>

      {proxy.error && (
        <p role="alert" className="text-sm text-status-missing">
          {proxy.error.message}
        </p>
      )}

      {stacks.isPending ? (
        <Panel className="p-5 text-muted-foreground">Loading the cards…</Panel>
      ) : stacks.isError ? (
        <Panel role="alert" className="p-5 text-status-missing">
          {stacks.error.message}
        </Panel>
      ) : (
        <CopyStackTable
          rows={stacks.data.rows}
          actions={actions}
          viewKey="locations-view"
          showLocation={includeChildren}
          showValue
          emptyMessage={
            includeChildren || !hasChildren
              ? 'No cards here.'
              : 'No cards directly here. Turn on Include child locations to see the rest.'
          }
        />
      )}

      <MoveToDialog
        open={moving !== null}
        onOpenChange={(open) => !open && setMoving(null)}
        stacks={moving ?? []}
      />
      {buying && (
        <AddToBuyListDialog
          open
          onOpenChange={(open) => !open && setBuying(null)}
          cardId={buying.card.id}
          printingId={buying.printing.printingId}
        />
      )}
      <AddCardsDialog open={adding} onOpenChange={setAdding} defaultLocationId={location.id} />
    </section>
  );
}

/**
 * The line under the location's name: its cards, how many have no price, and that proxies
 * aren't in its value, such as "86 cards · 3 cards have no price · proxies not counted".
 */
function valueNote(location: LocationNode, hasChildren: boolean) {
  const parts = [
    `${plural(location.totalCount, 'card')}${hasChildren ? ' including child locations' : ''}`,
  ];
  if (location.noPriceCount > 0) {
    const has = location.noPriceCount === 1 ? 'has' : 'have';
    parts.push(`${plural(location.noPriceCount, 'card')} ${has} no price`);
  }
  parts.push('proxies not counted');
  return parts.join(' · ');
}
