import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Id } from '../../shared/api/common';
import type { DeckList } from '../../shared/api/decks';
import type { LocationNode } from '../../shared/api/locations';
import type { CollectionValue } from '../../shared/api/stacks';
import { api } from '../api';
import { useLocationTree } from '../components/LocationPicker';
import { LocationContents } from '../components/locations/LocationContents';
import {
  DeleteLocationDialog,
  MoveContentsDialog,
  NewLocationDialog,
  RenameLocationDialog,
  useUpdateLocation,
} from '../components/locations/LocationDialogs';
import {
  type LocationMenuAction,
  LocationTreePanel,
} from '../components/locations/LocationTreePanel';
import { descendantIds, failure, groupTree, sectionOf } from '../components/locations/tree';
import { MoxfieldExportDialog } from '../components/MoxfieldExportDialog';
import { Panel } from '../components/Panel';
import { Button } from '../components/ui/button';
import { formatCents } from '../lib/money';

type OpenDialog = {
  kind: 'rename' | 'move-contents' | 'delete' | 'export';
  location: LocationNode;
} | null;

/** The location tree: boxes, binders, trays, deck boxes and the "to sort" inbox (`/locations`). */
export function Locations() {
  const [params, setParams] = useSearchParams();
  const tree = useLocationTree();
  const decks = useQuery({
    queryKey: ['decks'],
    queryFn: async (): Promise<DeckList> => {
      const res = await api.decks.$get();
      if (!res.ok) throw await failure(res, "Couldn't load the decks.");
      return res.json();
    },
  });
  const worth = useQuery({
    queryKey: ['collection', 'value'],
    queryFn: async (): Promise<CollectionValue> => {
      const res = await api.collection.value.$get();
      if (!res.ok) throw await failure(res, "Couldn't load the collection's value.");
      return res.json();
    },
  });

  const nodes = useMemo(() => tree.data?.nodes ?? [], [tree.data]);
  const groups = useMemo(() => groupTree(nodes), [nodes]);
  const asked = Number(params.get('selected'));
  // With nothing picked (or a location that's gone), the inbox shows.
  const selected = nodes.find((node) => node.id === asked) ?? groups.inbox ?? nodes[0];
  const select = (id: Id) => setParams({ selected: String(id) }, { preventScrollReset: true });

  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const update = useUpdateLocation();
  const close = (open: boolean) => !open && setDialog(null);

  const onAction = (action: LocationMenuAction) => {
    switch (action.kind) {
      case 'color':
        update.mutate({ id: action.location.id, body: { color: action.color } });
        break;
      case 'move':
        update.mutate({ id: action.location.id, body: { position: action.position } });
        break;
      case 'for-trade':
        update.mutate({ id: action.location.id, body: { forTrade: action.forTrade } });
        break;
      default:
        setDialog({ kind: action.kind, location: action.location });
    }
  };

  const moving = dialog?.kind === 'move-contents' ? dialog.location : null;

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-8 pt-8 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <h1 className="font-serif text-[44px] leading-[1.05]">Locations</h1>
        <div className="flex flex-wrap items-end gap-5">
          {worth.data && (
            <div className="flex flex-col items-end">
              <span className="text-muted-foreground text-xs">Collection value</span>
              <span data-testid="collection-value" className="font-semibold text-lg tabular-nums">
                {formatCents(worth.data.value)}
              </span>
            </div>
          )}
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            New location
          </Button>
        </div>
      </div>

      {update.error && (
        <p role="alert" className="text-sm text-status-missing">
          {update.error.message}
        </p>
      )}

      {tree.isPending ? (
        <Panel className="p-5 text-muted-foreground">Loading the locations…</Panel>
      ) : tree.isError ? (
        <Panel role="alert" className="p-5 text-status-missing">
          {tree.error.message}
        </Panel>
      ) : (
        <div className="grid grid-cols-[minmax(280px,340px)_minmax(0,1fr)] items-start gap-5">
          <LocationTreePanel
            groups={groups}
            decks={decks.data?.decks ?? []}
            selectedId={selected?.id}
            onSelect={select}
            onAction={onAction}
          />
          {selected ? (
            <LocationContents
              key={selected.id}
              location={selected}
              section={sectionOf(groups, selected)}
              onExport={() => setDialog({ kind: 'export', location: selected })}
            />
          ) : (
            <Panel className="p-5 text-muted-foreground">No locations yet.</Panel>
          )}
        </div>
      )}

      <NewLocationDialog
        open={creating}
        onOpenChange={setCreating}
        inboxId={groups.inbox?.id}
        onCreated={(location) => select(location.id)}
      />
      <RenameLocationDialog
        location={dialog?.kind === 'rename' ? dialog.location : null}
        onOpenChange={close}
      />
      <MoveContentsDialog
        location={moving}
        excludeIds={moving ? [moving.id, ...descendantIds(nodes, moving.id)] : []}
        onOpenChange={close}
      />
      {dialog?.kind === 'export' && (
        <MoxfieldExportDialog
          open
          onOpenChange={close}
          source={{
            kind: 'location',
            locationId: dialog.location.id,
            locationName: dialog.location.name,
            forTrade: dialog.location.forTrade,
          }}
        />
      )}
      <DeleteLocationDialog
        location={dialog?.kind === 'delete' ? dialog.location : null}
        inbox={groups.inbox}
        onOpenChange={close}
        onDeleted={(location) => {
          if (location.id === selected?.id) setParams({}, { preventScrollReset: true });
        }}
      />
    </div>
  );
}
