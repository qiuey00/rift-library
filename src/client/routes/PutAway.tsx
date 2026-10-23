import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, PackageOpen, TriangleAlert } from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ErrorBody, type Id, type LocationRef } from '../../shared/api/common';
import type {
  PutAwayLine,
  PutAwayResponse,
  ReturnRequest,
  ReturnResult,
} from '../../shared/api/put-away';
import { api } from '../api';
import { LocationPicker, useLocationTree } from '../components/LocationPicker';
import { Panel } from '../components/Panel';
import { useUndoBar } from '../components/UndoBar';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  NowPickingPane,
  type WalkCurrent,
  type WalkGroupData,
  type WalkLineData,
  WalkList,
} from '../components/walk-list';

/** An error answer from the server, keeping its code so a stale copy can be told apart. */
class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

async function failure(res: Response, fallback: string): Promise<ApiError> {
  const body = ErrorBody.safeParse(await res.json().catch(() => null));
  return body.success
    ? new ApiError(body.data.error.message, body.data.error.code)
    : new ApiError(fallback, null);
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function usePutAwayList(deckId: Id) {
  return useQuery({
    queryKey: ['decks', deckId, 'put-away'],
    queryFn: async (): Promise<PutAwayResponse> => {
      const res = await api.decks[':id']['put-away'].$get({ param: { id: String(deckId) } });
      if (!res.ok) throw await failure(res, "Couldn't load the put-away list.");
      return res.json();
    },
  });
}

/** A change Jeff made to where a line goes, before it is returned. */
type Exception = { kind: 'elsewhere'; location: LocationRef } | { kind: 'keep' };

/** A line as the screen shows it: the server's line plus Jeff's change and whether it is back. */
type ScreenLine = PutAwayLine & { exception: Exception | null; returned: boolean };

const KEPT_GROUP = 'kept';

/** Takes a deck apart: the put-away list returns each copy to its came-from location (`/decks/:id/take-apart`). */
export function PutAway() {
  const deckId = Number(useParams().id);
  const deleting = useSearchParams()[0].get('mode') === 'delete';
  const list = usePutAwayList(deckId);

  if (!list.data) {
    return (
      <div className="mx-auto flex max-w-[1392px] flex-col gap-5 px-6 pt-8 pb-12">
        <h1 className="font-serif text-[44px] leading-[1.05]">Take apart</h1>
        <Panel className="p-5 text-muted-foreground" role={list.isError ? 'alert' : 'status'}>
          {list.isError ? list.error.message : 'Loading the put-away list…'}
        </Panel>
      </div>
    );
  }

  return <PutAwayScreen data={list.data} deleting={deleting} refetch={() => void list.refetch()} />;
}

function PutAwayScreen({
  data,
  deleting,
  refetch,
}: {
  data: PutAwayResponse;
  deleting: boolean;
  refetch: () => void;
}) {
  const { deck } = data;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const tree = useLocationTree();

  const [exceptions, setExceptions] = useState<Map<Id, Exception>>(new Map());
  // Returned lines stay on the screen, ticked, even after a refetch drops them from the list.
  const [returned, setReturned] = useState<Map<Id, ScreenLine>>(new Map());
  const [batchId, setBatchId] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendingElsewhere, setSendingElsewhere] = useState<ScreenLine | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [current, setCurrent] = useState<WalkCurrent | null>(null);

  const lines = useMemo(() => {
    const all: ScreenLine[] = data.groups.flatMap((group) =>
      group.lines.map(
        (line) =>
          returned.get(line.stackId) ?? {
            ...line,
            exception: exceptions.get(line.stackId) ?? null,
            returned: false,
          },
      ),
    );
    const listed = new Set(all.map((line) => line.stackId));
    return [...all, ...[...returned.values()].filter((line) => !listed.has(line.stackId))];
  }, [data, exceptions, returned]);

  const deleteDeck = useMutation({
    mutationFn: async () => {
      const res = await api.decks[':id'].$delete({ param: { id: String(deck.id) } });
      if (!res.ok) throw await failure(res, "Couldn't delete the deck.");
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['decks', deck.id] });
      void queryClient.invalidateQueries({ queryKey: ['decks'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      navigate('/');
    },
    onError: (err) => setError(err.message),
  });

  const returnLines = useMutation({
    mutationFn: async (toReturn: ScreenLine[]): Promise<ReturnResult> => {
      const json: ReturnRequest = {
        lines: toReturn.map((line) => ({
          stackId: line.stackId,
          quantity: line.quantity,
          ...(line.exception?.kind === 'elsewhere'
            ? { toLocationId: line.exception.location.id }
            : {}),
        })),
        ...(batchId !== null ? { batchId } : {}),
      };
      const res = await api.decks[':id'].returns.$post({ param: { id: String(deck.id) }, json });
      if (!res.ok) throw await failure(res, "Couldn't put the cards away. Try again.");
      return res.json();
    },
    onSuccess: (result, toReturn) => {
      setError(null);
      setBatchId(result.batchId);
      const next = new Map(returned);
      for (const line of toReturn) next.set(line.stackId, { ...line, returned: true });
      setReturned(next);
      // The whole teardown is one batch, so Undo here would reverse every earlier return too;
      // History undoes the teardown instead.
      undoBar.show({ message: result.message, batchId: null });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      if (deleting && lines.every((line) => next.has(line.stackId))) {
        deleteDeck.mutate();
      }
    },
    onError: (err) => {
      setError(err.message);
      if (err instanceof ApiError && err.code === 'stale_copy') refetch();
    },
  });

  const open = lines.filter((line) => !line.returned);
  const toReturnAll = open.filter((line) => line.exception?.kind !== 'keep');
  const counted = lines.filter((line) => line.returned || line.exception?.kind !== 'keep');
  const total = counted.reduce((sum, line) => sum + line.quantity, 0);
  const done = counted.filter((line) => line.returned).reduce((sum, l) => sum + l.quantity, 0);
  const allCards = toReturnAll.reduce((sum, line) => sum + line.quantity, 0);

  const groups = useMemo(
    () => buildGroups(lines, tree.data?.nodes.map((node) => node.id) ?? []),
    [lines, tree.data],
  );
  const byKey = useMemo(() => new Map(lines.map((line) => [String(line.stackId), line])), [lines]);

  const onToggle = useCallback(
    (walkLine: WalkLineData) => {
      const line = byKey.get(walkLine.key);
      // A returned copy is back in storage; ticking can't take it out again.
      if (!line || line.returned || returnLines.isPending) return;
      returnLines.mutate([line]);
    },
    [byKey, returnLines],
  );

  const setException = (stackId: Id, exception: Exception | null) => {
    const next = new Map(exceptions);
    if (exception) next.set(stackId, exception);
    else next.delete(stackId);
    setExceptions(next);
  };

  const finished = deleting
    ? deleteDeck.isPending || deleteDeck.isSuccess
    : open.length === 0 || toReturnAll.length === 0;

  return (
    <div className="mx-auto flex max-w-[1392px] flex-col gap-5 px-6 pt-8 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Link
            to={`/decks/${deck.id}`}
            className="text-[13px] text-muted-foreground hover:text-primary hover:underline"
          >
            {deck.name} ›
          </Link>
          <h1 className="font-serif text-[44px] leading-[1.05]">Take apart {deck.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button
            variant="outline"
            onClick={() => setConfirmingAll(true)}
            disabled={toReturnAll.length === 0 || returnLines.isPending}
          >
            <PackageOpen aria-hidden="true" />
            Return all
          </Button>
          {!deleting && (
            <Button
              variant={finished ? 'default' : 'outline'}
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ['decks'] });
                navigate(`/decks/${deck.id}`);
              }}
            >
              Done
            </Button>
          )}
        </div>
      </div>

      {deleting && (
        <div
          role="note"
          className="flex items-center gap-2.5 rounded-xl border border-[#f0dfc0] bg-status-other-decks-soft px-4 py-3 font-semibold text-status-other-decks"
        >
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          Put these cards away to delete the deck
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-status-missing/30 bg-status-missing-soft px-4 py-3 text-status-missing"
        >
          {error}
        </div>
      )}

      {lines.length === 0 ? (
        <Panel className="flex flex-wrap items-center justify-between gap-3 p-5 text-muted-foreground">
          The deck box is empty.
          {deleting && (
            <Button onClick={() => deleteDeck.mutate()} disabled={deleteDeck.isPending}>
              Delete deck
            </Button>
          )}
        </Panel>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <WalkList
            groups={groups}
            onToggle={onToggle}
            onCurrentChange={setCurrent}
            renderActions={(walkLine) => {
              const line = byKey.get(walkLine.key);
              if (!line || line.returned) return null;
              return (
                <LineMenu
                  line={line}
                  canKeep={!deleting}
                  onSendElsewhere={() => setSendingElsewhere(line)}
                  onKeep={() => setException(line.stackId, { kind: 'keep' })}
                  onReset={() => setException(line.stackId, null)}
                />
              );
            }}
          />
          <div className="lg:sticky lg:top-20">
            <NowPickingPane
              heading="Now putting away"
              line={current?.line ?? null}
              location={current?.group.location ?? null}
              progress={{ done, total, label: 'put away' }}
            />
          </div>
        </div>
      )}

      {sendingElsewhere && (
        <SendElsewhereDialog
          line={sendingElsewhere}
          onClose={() => setSendingElsewhere(null)}
          onPick={(location) => {
            setException(sendingElsewhere.stackId, { kind: 'elsewhere', location });
            setSendingElsewhere(null);
          }}
        />
      )}
      <ReturnAllDialog
        open={confirmingAll}
        onOpenChange={setConfirmingAll}
        cards={allCards}
        onConfirm={() => {
          setConfirmingAll(false);
          returnLines.mutate(toReturnAll);
        }}
      />
    </div>
  );
}

/**
 * The walk list's groups: one per destination in the server's order, with lines sent elsewhere
 * under their new location (new groups placed in location-tree order) and kept lines last.
 */
function buildGroups(lines: ScreenLine[], treeOrder: Id[]): WalkGroupData[] {
  const groups = new Map<string, { location?: LocationRef; lines: ScreenLine[] }>();
  const add = (key: string, location: LocationRef | undefined, line: ScreenLine) => {
    const group = groups.get(key) ?? { location, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  };
  for (const line of lines) {
    if (line.exception?.kind === 'keep') add(KEPT_GROUP, undefined, line);
    else {
      const location = line.exception?.location ?? line.destination;
      add(String(location.id), location, line);
    }
  }
  const rank = (location?: LocationRef) => {
    if (!location) return Number.POSITIVE_INFINITY;
    const index = treeOrder.indexOf(location.id);
    return index === -1 ? treeOrder.length : index;
  };
  // The server's order wins; tree order only places groups that a change created.
  const serverOrder = [...new Set(lines.map((line) => line.destination.id))];
  const entries = [...groups.entries()].sort(([, a], [, b]) => {
    if (!a.location || !b.location) return rank(a.location) - rank(b.location);
    const aServer = serverOrder.indexOf(a.location.id);
    const bServer = serverOrder.indexOf(b.location.id);
    if (aServer !== -1 && bServer !== -1) return aServer - bServer;
    return rank(a.location) - rank(b.location);
  });
  return entries.map(([key, group]) => {
    const cards = group.lines.reduce((sum, line) => sum + line.quantity, 0);
    return {
      key,
      location: group.location,
      title: group.location ? undefined : 'Kept in box',
      countText: group.location ? `put ${cards} here` : `keep ${cards}`,
      lines: group.lines.map(toWalkLine),
    };
  });
}

function toWalkLine(line: ScreenLine): WalkLineData {
  return {
    key: String(line.stackId),
    quantity: line.quantity,
    card: line.card,
    copy: {
      setCode: line.printing.setCode,
      rarity: line.printing.rarity,
      collectorNumber: line.printing.collectorNumber,
      finish: line.finish,
      condition: line.condition,
      isProxy: line.isProxy,
    },
    done: line.returned,
    tag: line.exception
      ? { text: `Changed · was ${line.destination.path}`, tone: 'info' }
      : undefined,
  };
}

function LineMenu({
  line,
  canKeep,
  onSendElsewhere,
  onKeep,
  onReset,
}: {
  line: ScreenLine;
  canKeep: boolean;
  onSendElsewhere: () => void;
  onKeep: () => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More for ${line.card.name}`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onSelect={onSendElsewhere}>Send elsewhere</DropdownMenuItem>
        {canKeep && line.exception?.kind !== 'keep' && (
          <DropdownMenuItem onSelect={onKeep}>Keep in box</DropdownMenuItem>
        )}
        {line.exception && (
          <DropdownMenuItem onSelect={onReset}>Send to {line.destination.path}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SendElsewhereDialog({
  line,
  onClose,
  onPick,
}: {
  line: ScreenLine;
  onClose: () => void;
  onPick: (location: LocationRef) => void;
}) {
  const pickerId = useId();
  const tree = useLocationTree();
  const [picked, setPicked] = useState<Id | null>(
    line.exception?.kind === 'elsewhere' ? line.exception.location.id : null,
  );
  const node = tree.data?.nodes.find((n) => n.id === picked);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send {line.card.name} elsewhere</DialogTitle>
          <DialogDescription>
            {plural(line.quantity, 'copy', 'copies')} will live there from now on instead of{' '}
            {line.destination.path}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <label htmlFor={pickerId} className="font-semibold">
            Location
          </label>
          <LocationPicker id={pickerId} value={picked} onChange={setPicked} excludeDeckBoxes />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!node}
            onClick={() =>
              node &&
              onPick({
                id: node.id,
                name: node.name,
                type: node.type,
                path: node.path,
                color: node.effectiveColor,
                forTrade: node.forTrade,
              })
            }
          >
            Send here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnAllDialog({
  open,
  onOpenChange,
  cards,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: number;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return {plural(cards, 'card')}?</DialogTitle>
          <DialogDescription>
            Each card goes to the location it shows under. Cards kept in the box stay there.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={onConfirm}>
            Return {plural(cards, 'card')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
