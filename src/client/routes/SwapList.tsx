import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  Minus,
  MoreHorizontal,
  Plus,
  Repeat2,
} from 'lucide-react';
import { type ReactNode, useCallback, useId, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type {
  CopyDetails,
  Id,
  LocationRef,
  PrintingSummary,
  StackRow,
} from '../../shared/api/common';
import type { MissingLine, PickLine } from '../../shared/api/pick-list';
import type { PutAwayLine } from '../../shared/api/put-away';
import type { SwapResponse } from '../../shared/api/swap';
import { AddToBuyListDialog } from '../components/AddToBuyListDialog';
import { LocationPicker, useLocationTree } from '../components/LocationPicker';
import { LocationTile } from '../components/LocationTile';
import { Panel } from '../components/Panel';
import {
  ApiError,
  fetchSwap,
  pull,
  returnCopies,
  swapQueryKey,
  undoMovement,
} from '../components/swap-list/api';
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
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import {
  CopyLabel,
  type WalkCopy,
  type WalkGroupData,
  type WalkLineData,
  WalkList,
  WalkProgress,
} from '../components/walk-list';
import { cn } from '../lib/utils';

type GroupInfo = { key: string; location: LocationRef | null };

/** A line of either part, with the group it is shown in. */
type Entry =
  | { part: 'out'; key: string; line: PutAwayLine; group: GroupInfo }
  | { part: 'in'; key: string; line: PickLine; group: GroupInfo };

/** A ticked line. It stays on the list (greyed) even once the server stops listing it. */
type Tick = {
  status: 'moving' | 'done' | 'undoing';
  /** What unticking undoes. */
  movementId?: Id;
  /** The line as it was ticked: for a pull-in, `suggested` is the copy it pulled. */
  entry: Entry;
};

const OTHER_DECKS = 'in-other-decks';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const sumQuantity = (lines: { quantity: number }[]) =>
  lines.reduce((sum, line) => sum + line.quantity, 0);

/** The copy details a walk line shows for a copy stack or put-away line. */
function walkCopy(
  copy: { printing: PrintingSummary } & Pick<CopyDetails, 'finish' | 'condition' | 'isProxy'>,
): WalkCopy {
  return {
    setCode: copy.printing.setCode,
    rarity: copy.printing.rarity,
    collectorNumber: copy.printing.collectorNumber,
    finish: copy.finish,
    condition: copy.condition,
    isProxy: copy.isProxy,
  };
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

/** Every line the server lists, in its order: take-outs by destination, pull-ins by location. */
function entriesOf(data: SwapResponse): Entry[] {
  const out: Entry[] = data.takeOut.groups.flatMap((group) =>
    group.lines.map((line) => ({
      part: 'out' as const,
      key: `out-${line.stackId}`,
      line,
      group: { key: `out-${group.location.id}`, location: group.location },
    })),
  );
  const inStorage: Entry[] = data.pullIn.groups.flatMap((group) =>
    group.lines.map((line) => ({
      part: 'in' as const,
      key: `in-${line.key}`,
      line,
      group: { key: `in-${group.location.id}`, location: group.location },
    })),
  );
  const inOtherDecks: Entry[] = data.pullIn.otherDecks.map((line) => ({
    part: 'in' as const,
    key: `in-${line.key}`,
    line,
    group: { key: OTHER_DECKS, location: null },
  }));
  return [...out, ...inStorage, ...inOtherDecks];
}

/** Brings an assembled deck in line with its changed decklist (`/decks/:id/swap`). */
export function SwapList() {
  const deckId = Number(useParams().id);
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const query = useQuery({
    queryKey: swapQueryKey(deckId),
    queryFn: () => fetchSwap(deckId),
    // Worked out again each time the screen opens; while walking, only a stale copy refetches.
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const [ticks, setTicks] = useState<Record<string, Tick>>({});
  /** Send elsewhere: where a take-out line goes instead of its destination. */
  const [elsewhere, setElsewhere] = useState<Record<string, LocationRef>>({});
  /** Switch copy: the copy a pull-in line pulls instead of the suggested one. */
  const [chosen, setChosen] = useState<Record<string, StackRow>>({});
  const [stale, setStale] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState<Entry | null>(null);
  const [confirming, setConfirming] = useState<PickLine | null>(null);
  const [buying, setBuying] = useState<MissingLine | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Both parts are one batch, so the whole swap is one History entry: every move after the
  // first sends its batch id, so moves go to the server one after another.
  const batchId = useRef<Id | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((work: () => Promise<void>) => {
    queue.current = queue.current.then(work);
  }, []);
  // Where each line first appeared, so a refetch keeps the lines in place.
  const order = useRef(new Map<string, number>());

  const refreshOtherScreens = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (q) => !(q.queryKey[0] === 'decks' && q.queryKey[2] === 'swap'),
    });
  }, [queryClient]);

  const data = query.data;

  // The server's lines, plus ticked lines it no longer lists.
  const entries = useMemo<Entry[]>(() => {
    if (!data) return [];
    const listed = entriesOf(data);
    const keys = new Set(listed.map((entry) => entry.key));
    const all = [
      ...listed,
      ...Object.values(ticks)
        .map((tick) => tick.entry)
        .filter((e) => !keys.has(e.key)),
    ];
    for (const entry of all) {
      if (!order.current.has(entry.key)) order.current.set(entry.key, order.current.size);
    }
    return all;
  }, [data, ticks]);

  const byKey = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);

  const isDone = (key: string) => {
    const status = ticks[key]?.status;
    return status === 'moving' || status === 'done';
  };

  const stackFor = (entry: Entry & { part: 'in' }) => {
    const ticked = ticks[entry.key]?.entry;
    if (ticked?.part === 'in') return ticked.line.suggested;
    return chosen[entry.key] ?? entry.line.suggested;
  };

  /** Records a move the server made: the tick keeps its movement so unticking can undo it. */
  const moved = (key: string, movementId: Id, message: string) => {
    setTicks((all) => ({ ...all, [key]: { ...all[key], status: 'done', movementId } }));
    // Unticking the line is its undo, so the bar only names the move.
    undoBar.show({ message, batchId: null });
    refreshOtherScreens();
  };

  const failed = (key: string, error: unknown) => {
    setTicks(({ [key]: _, ...rest }) => rest);
    if (error instanceof ApiError && error.code === 'stale_copy') {
      setStale((all) => ({ ...all, [key]: true }));
      setChosen(({ [key]: _, ...rest }) => rest);
      setNotice(error.message);
      void query.refetch();
    } else {
      setNotice(messageOf(error));
    }
  };

  const takeOut = (entry: Entry & { part: 'out' }) => {
    const { key, line } = entry;
    const to = elsewhere[key];
    setNotice(null);
    setStale(({ [key]: _, ...rest }) => rest);
    setTicks((all) => ({ ...all, [key]: { status: 'moving', entry } }));
    enqueue(async () => {
      try {
        const result = await returnCopies(deckId, {
          lines: [
            {
              stackId: line.stackId,
              quantity: line.quantity,
              ...(to ? { toLocationId: to.id } : {}),
            },
          ],
          batchId: batchId.current,
          reason: 'swapped_out',
        });
        batchId.current ??= result.batchId;
        moved(key, result.movementIds[0], result.message);
      } catch (error) {
        failed(key, error);
      }
    });
  };

  const pullIn = (entry: Entry & { part: 'in' }) => {
    const { key, line } = entry;
    const stack = chosen[key] ?? line.suggested;
    setNotice(null);
    setStale(({ [key]: _, ...rest }) => rest);
    setTicks((all) => ({
      ...all,
      [key]: { status: 'moving', entry: { ...entry, line: { ...line, suggested: stack } } },
    }));
    enqueue(async () => {
      try {
        const result = await pull(deckId, {
          slotId: line.slotId,
          stackId: stack.stackId,
          quantity: line.quantity,
          batchId: batchId.current,
          reason: 'swapped_in',
        });
        batchId.current ??= result.batchId;
        moved(key, result.movementId, result.message);
      } catch (error) {
        failed(key, error);
      }
    });
  };

  const untick = (key: string) => {
    const tick = ticks[key];
    if (tick?.status !== 'done' || tick.movementId === undefined) return;
    const { movementId } = tick;
    setNotice(null);
    setTicks((all) => ({ ...all, [key]: { ...tick, status: 'undoing' } }));
    enqueue(async () => {
      try {
        const result = await undoMovement(movementId);
        setTicks(({ [key]: _, ...rest }) => rest);
        undoBar.show({ message: result.message, batchId: null });
        refreshOtherScreens();
      } catch (error) {
        setTicks((all) => ({ ...all, [key]: tick }));
        setNotice(messageOf(error));
      }
    });
  };

  const onToggle = (walkLine: WalkLineData) => {
    const entry = byKey.get(walkLine.key);
    if (!entry) return;
    const status = ticks[entry.key]?.status;
    if (status === 'done') untick(entry.key);
    else if (status) return;
    else if (entry.part === 'out') takeOut(entry);
    else if (entry.line.fromDeck) setConfirming(entry.line);
    else pullIn(entry);
  };

  const walkGroups = (part: Entry['part']): WalkGroupData[] => {
    const groups = new Map<string, { info: GroupInfo; entries: Entry[] }>();
    for (const entry of entries) {
      if (entry.part !== part) continue;
      const group = groups.get(entry.group.key) ?? { info: entry.group, entries: [] };
      group.entries.push(entry);
      groups.set(entry.group.key, group);
    }
    const at = (entry: Entry) => order.current.get(entry.key) ?? Number.MAX_SAFE_INTEGER;
    // Lines from other deck boxes come last, as on the pick list.
    const sorted = [...groups.values()].sort(
      (a, b) => Number(a.info.key === OTHER_DECKS) - Number(b.info.key === OTHER_DECKS),
    );
    return sorted.map(({ info, entries: lines }) => ({
      key: info.key,
      location: info.location ?? undefined,
      title: info.location ? undefined : 'In other deck boxes',
      countText: !info.location
        ? 'Pulling one leaves that deck partly assembled'
        : `${part === 'out' ? 'put' : 'pull'} ${sumQuantity(lines.map((e) => e.line))} here`,
      tone: info.location ? 'default' : 'warning',
      lines: [...lines].sort((a, b) => at(a) - at(b)).map(walkLine),
    }));
  };

  const walkLine = (entry: Entry): WalkLineData => {
    const base = {
      key: entry.key,
      quantity: entry.line.quantity,
      card: entry.line.card,
      done: isDone(entry.key),
    };
    const staleTag = stale[entry.key]
      ? { text: 'This copy has moved, pick another', tone: 'missing' as const }
      : undefined;
    if (entry.part === 'out') {
      const to = ticks[entry.key] ? undefined : elsewhere[entry.key];
      return {
        ...base,
        copy: walkCopy(entry.line),
        tag:
          staleTag ??
          (to
            ? { text: `Send to ${to.path}`, tone: 'info' }
            : entry.line.cameFrom
              ? undefined
              : { text: 'Had no spot of its own', tone: 'info' }),
      };
    }
    const stack = stackFor(entry);
    const switched = !ticks[entry.key] && chosen[entry.key] !== undefined;
    const { fromDeck } = entry.line;
    return {
      ...base,
      copy: walkCopy(stack),
      tag:
        staleTag ??
        (switched
          ? { text: `Switched · ${stack.location.path}`, tone: 'info' }
          : fromDeck
            ? { text: `In ${fromDeck.name} deck box`, tone: 'warning' }
            : undefined),
      note: fromDeck?.becomesPartly ? `${fromDeck.name} becomes partly assembled` : undefined,
    };
  };

  const renderActions = (walkLine: WalkLineData) => {
    const entry = byKey.get(walkLine.key);
    if (!entry || ticks[entry.key]) return null;
    if (entry.part === 'out') {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`More for ${entry.line.card.name}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setSending(entry)}>Send elsewhere…</DropdownMenuItem>
            {elsewhere[entry.key] && (
              <DropdownMenuItem
                onSelect={() => setElsewhere(({ [entry.key]: _, ...rest }) => rest)}
              >
                Send to {entry.line.destination.path}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    if (entry.line.alternatives.length === 0) return null;
    const { line, key } = entry;
    return (
      <SwitchCopyPopover
        cardName={line.card.name}
        quantity={line.quantity}
        copies={[line.suggested, ...line.alternatives]}
        chosenStackId={stackFor(entry).stackId}
        onChoose={(stack) => {
          setStale(({ [key]: _, ...rest }) => rest);
          setChosen(({ [key]: _, ...rest }) =>
            stack.stackId === line.suggested.stackId ? rest : { ...rest, [key]: stack },
          );
        }}
      />
    );
  };

  const deckPath = `/decks/${deckId}`;
  const outLines = entries
    .filter((entry) => entry.part === 'out')
    .map((entry) => ({ ...entry.line, key: entry.key }));
  const inLines = entries
    .filter((entry) => entry.part === 'in')
    .map((entry) => ({ ...entry.line, key: entry.key }));
  const doneOf = (lines: { key: string; quantity: number }[]) =>
    sumQuantity(lines.filter((line) => isDone(line.key)));
  const outDone = doneOf(outLines);
  const inDone = doneOf(inLines);
  const outTotal = sumQuantity(outLines);
  const inTotal = sumQuantity(inLines);

  const header = (
    <div className="flex flex-col gap-3.5">
      {data && (
        <Link
          to={deckPath}
          className="flex w-fit items-center gap-1 font-semibold text-[13px] text-primary hover:underline"
        >
          <ChevronLeft aria-hidden="true" className="size-3.5" />
          {data.deck.name}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-serif text-[42px] leading-[1.05]">Swap list</h1>
          {data && (
            <p className="m-0 max-w-3xl text-[#4a5161] text-[15px]">
              The list changed: {plural(data.counts.takeOut, 'card')} come
              {data.counts.takeOut === 1 ? 's' : ''} out of the deck box and {data.counts.pullIn} go
              {data.counts.pullIn === 1 ? 'es' : ''} in. Cards that come out go back to their own
              spots.
            </p>
          )}
        </div>
        <Button asChild>
          <Link
            to={deckPath}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['decks', deckId] })}
          >
            Done
          </Link>
        </Button>
      </div>
      {data && (
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-2 rounded-lg bg-[#e8eefc] px-3 py-2 font-semibold text-[#1b3f9c]">
            <ArrowLeftRight aria-hidden="true" className="size-4" />
            {outDone} of {outTotal} taken out · {inDone} of {inTotal} pulled in
          </span>
          <WalkProgress
            className="min-w-60 flex-1"
            done={outDone + inDone}
            total={outTotal + inTotal}
            label="swapped"
          />
        </div>
      )}
    </div>
  );

  if (!data) {
    return (
      <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-6 pt-8 pb-12">
        {header}
        <Panel className="p-5 text-muted-foreground" role={query.isError ? 'alert' : 'status'}>
          {query.isError ? messageOf(query.error) : 'Working out the swap list…'}
        </Panel>
      </div>
    );
  }

  const { missing, runes } = data.pullIn;
  // Only one list takes the keys: Take out until it is all ticked, then Pull in.
  const keysOnOut = outLines.some((line) => !isDone(line.key));

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-6 pt-8 pb-12">
      {header}
      {notice && (
        <div
          role="alert"
          className="rounded-lg border border-status-missing/30 bg-status-missing-soft px-4 py-3 font-semibold text-status-missing"
        >
          {notice}
        </div>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <SwapPart
          title="Take out"
          subtitle="grouped by where each copy goes"
          icon={<Minus aria-hidden="true" className="size-4" />}
          iconClassName="bg-status-missing-soft text-status-missing"
        >
          {outLines.length === 0 ? (
            <Panel className="p-5 text-muted-foreground">Nothing to take out.</Panel>
          ) : (
            <WalkList
              groups={walkGroups('out')}
              onToggle={onToggle}
              renderActions={renderActions}
              keyboard={keysOnOut}
            />
          )}
        </SwapPart>
        <SwapPart
          title="Pull in"
          subtitle="laid out like the pick list"
          icon={<Plus aria-hidden="true" className="size-4" />}
          iconClassName="bg-status-in-box-soft text-status-in-box"
        >
          {inLines.length === 0 && missing.length === 0 && runes.length === 0 ? (
            <Panel className="p-5 text-muted-foreground">Nothing to pull in.</Panel>
          ) : (
            <>
              {inLines.length > 0 && (
                <WalkList
                  groups={walkGroups('in')}
                  onToggle={onToggle}
                  renderActions={renderActions}
                  keyboard={!keysOnOut}
                />
              )}
              {missing.length > 0 && (
                <MissingPanel lines={missing} onBuy={(line) => setBuying(line)} />
              )}
              {runes.length > 0 && (
                <Panel className="px-4 py-3 text-sm">
                  <span className="font-semibold">Runes to add: </span>
                  {runes.map((rune) => `${rune.quantity} ${rune.card.name}`).join(', ')}
                </Panel>
              )}
            </>
          )}
        </SwapPart>
      </div>

      {sending?.part === 'out' && (
        <SendElsewhereDialog
          line={sending.line}
          current={elsewhere[sending.key] ?? null}
          onClose={() => setSending(null)}
          onPick={(location) => {
            const { key, line } = sending;
            setElsewhere(({ [key]: _, ...rest }) =>
              location.id === line.destination.id ? rest : { ...rest, [key]: location },
            );
            setSending(null);
          }}
        />
      )}
      <ConfirmPullDialog
        line={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={(line) => {
          setConfirming(null);
          const entry = byKey.get(`in-${line.key}`);
          if (entry?.part === 'in') pullIn(entry);
        }}
      />
      {buying && (
        <AddToBuyListDialog
          open
          onOpenChange={(open) => !open && setBuying(null)}
          cardId={buying.card.id}
          quantity={buying.quantity}
        />
      )}
    </div>
  );
}

/** One of the two parts: a heading with its icon, then its lists. */
function SwapPart({
  title,
  subtitle,
  icon,
  iconClassName,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  iconClassName: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span
          className={cn('flex size-[30px] items-center justify-center rounded-lg', iconClassName)}
        >
          {icon}
        </span>
        <h2 id={headingId} className="m-0 font-bold text-xl">
          {title}
        </h2>
        <span className="text-[#4a5161]">{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

/** Slots no copy anywhere can fill. */
function MissingPanel({
  lines,
  onBuy,
}: {
  lines: MissingLine[];
  onBuy: (line: MissingLine) => void;
}) {
  return (
    <section
      aria-label="Missing"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="border-[#f3d3d0] border-b bg-status-missing-soft px-4 py-3">
        <h3 className="m-0 font-bold text-base text-status-missing">Missing</h3>
      </div>
      <ul className="m-0 list-none py-1">
        {lines.map((line) => (
          <li
            key={line.slotId}
            className="flex flex-wrap items-center justify-between gap-3 border-[#f0f2f5] border-t px-4 py-2.5 first:border-t-0"
          >
            <span className="font-semibold text-[15px]">
              {line.quantity} {line.card.name}
            </span>
            <Button variant="outline" size="sm" onClick={() => onBuy(line)}>
              Add to buy list
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Send elsewhere on a take-out line: the copies go to the picked location instead. */
function SendElsewhereDialog({
  line,
  current,
  onClose,
  onPick,
}: {
  line: PutAwayLine;
  current: LocationRef | null;
  onClose: () => void;
  onPick: (location: LocationRef) => void;
}) {
  const pickerId = useId();
  const [picked, setPicked] = useState<LocationRef | null>(current);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send {line.card.name} elsewhere</DialogTitle>
          <DialogDescription>
            It goes to {line.destination.path} unless you pick another spot. Ticking the line moves
            it there.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={pickerId} className="font-semibold text-sm">
            Where it goes
          </label>
          <LocationPickerField id={pickerId} value={picked} onChange={setPicked} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button disabled={!picked} onClick={() => picked && onPick(picked)}>
            Send here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The location picker, handing back the whole location rather than its id. */
function LocationPickerField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: LocationRef | null;
  onChange: (location: LocationRef) => void;
}) {
  const tree = useLocationTree();
  return (
    <LocationPicker
      id={id}
      value={value?.id ?? null}
      excludeDeckBoxes
      onChange={(locationId) => {
        const node = tree.data?.nodes.find((n) => n.id === locationId);
        if (!node) return;
        const { name, type, path, effectiveColor, forTrade } = node;
        onChange({ id: node.id, name, type, path, color: effectiveColor, forTrade });
      }}
    />
  );
}

/** Switch copy on a pull-in line: the suggested copy and every alternative with where it is. */
function SwitchCopyPopover({
  cardName,
  quantity,
  copies,
  chosenStackId,
  onChoose,
}: {
  cardName: string;
  /** How many the line pulls; a stack holding fewer can't fill it. */
  quantity: number;
  /** The suggested copy first, then the alternatives. */
  copies: StackRow[];
  chosenStackId: Id;
  onChoose: (stack: StackRow) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Switch copy of ${cardName}`}>
          <Repeat2 aria-hidden="true" />
          Switch copy
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-1.5">
        <div role="menu" aria-label={`Copies of ${cardName}`} className="flex flex-col">
          {copies.map((stack) => {
            const isChosen = stack.stackId === chosenStackId;
            const tooFew = stack.quantity < quantity;
            return (
              <button
                key={stack.stackId}
                type="button"
                role="menuitemradio"
                aria-checked={isChosen}
                disabled={tooFew}
                onClick={() => {
                  onChoose(stack);
                  setOpen(false);
                }}
                className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <Check
                  aria-hidden="true"
                  className={cn('mt-0.5 size-4 text-primary', !isChosen && 'invisible')}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-semibold">
                    <LocationTile type={stack.location.type} color={stack.location.color} />
                    <span className="truncate">{stack.location.path}</span>
                  </span>
                  <CopyLabel copy={walkCopy(stack)} className="text-[13px] text-muted-foreground" />
                  {tooFew && (
                    <span className="text-[13px] text-muted-foreground">
                      Only {stack.quantity} here
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Asks before pulling a copy out of another deck's box. */
function ConfirmPullDialog({
  line,
  onConfirm,
  onCancel,
}: {
  /** The line being ticked; the dialog is closed when null. */
  line: PickLine | null;
  onConfirm: (line: PickLine) => void;
  onCancel: () => void;
}) {
  const deck = line?.fromDeck;
  return (
    <Dialog open={line !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        {line && deck && (
          <>
            <DialogHeader>
              <DialogTitle>
                Pull {line.card.name} from the {deck.name} deck box?
              </DialogTitle>
              <DialogDescription>
                {deck.becomesPartly
                  ? `${deck.name} becomes partly assembled.`
                  : `The copy moves out of the ${deck.name} deck box.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button onClick={() => onConfirm(line)}>Pull it</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
