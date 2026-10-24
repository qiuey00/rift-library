import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { LocationRef, PrintingSummary, StackRow } from '../../shared/api/common';
import type { MissingLine, PickLine, PickListResponse } from '../../shared/api/pick-list';
import { Panel } from '../components/Panel';
import {
  ApiError,
  addProxy,
  fetchCard,
  fetchPickList,
  pickListQueryKey,
  pull,
  undoMovement,
} from '../components/pick-list/api';
import { ConfirmPullDialog, ProxyPrintingDialog } from '../components/pick-list/dialogs';
import { MissingSection, type ProxyState, RunesLine } from '../components/pick-list/MissingSection';
import { SwitchCopyPopover } from '../components/pick-list/SwitchCopyPopover';
import { walkCopy } from '../components/pick-list/walk-copy';
import { useUndoBar } from '../components/UndoBar';
import { Button } from '../components/ui/button';
import {
  NowPickingPane,
  type WalkCurrent,
  type WalkGroupData,
  type WalkLineData,
  WalkList,
} from '../components/walk-list';

const OTHER_DECKS = 'other-decks';

/** A ticked line. It stays on the list (greyed) even once the server stops listing it. */
type Tick = {
  status: 'pulling' | 'pulled' | 'returning';
  movementId?: number;
  line: PickLine;
  groupKey: string;
  location: LocationRef | null;
};

type Group = { key: string; location: LocationRef | null; lines: PickLine[] };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const sumQuantity = (lines: { quantity: number }[]) =>
  lines.reduce((sum, line) => sum + line.quantity, 0);

/** Assembles a deck: the pick list, ordered through storage (`/decks/:id/assemble`). */
export function PickList() {
  const deckId = Number(useParams().id);
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const query = useQuery({
    queryKey: pickListQueryKey(deckId),
    queryFn: () => fetchPickList(deckId),
    // Worked out again each time the screen opens; while walking, only a stale copy refetches.
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const [ticks, setTicks] = useState<Record<string, Tick>>({});
  const [chosen, setChosen] = useState<Record<string, StackRow>>({});
  const [stale, setStale] = useState<Record<string, boolean>>({});
  const [proxies, setProxies] = useState<Record<number, ProxyState>>({});
  const [confirming, setConfirming] = useState<PickLine | null>(null);
  const [choosingPrinting, setChoosingPrinting] = useState<{
    line: MissingLine;
    printings: PrintingSummary[];
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [current, setCurrent] = useState<WalkCurrent | null>(null);

  // One pick list is one History entry: every pull after the first sends its batch id, so
  // pulls go to the server one after another.
  const batchId = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((work: () => Promise<void>) => {
    queue.current = queue.current.then(work);
  }, []);
  // Where each line first appeared, so a refetch keeps the lines in place.
  const order = useRef(new Map<string, number>());

  const refreshOtherScreens = useCallback(() => {
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'pick-list' });
  }, [queryClient]);

  const data = query.data;

  // The server's groups, plus ticked lines it no longer lists (their slots are filled now).
  const groups = useMemo<Group[]>(() => {
    if (!data) return [];
    const result: Group[] = data.pickList.groups.map((group) => ({
      key: `location-${group.location.id}`,
      location: group.location,
      lines: [...group.lines],
    }));
    if (data.pickList.otherDecks.length > 0) {
      result.push({ key: OTHER_DECKS, location: null, lines: [...data.pickList.otherDecks] });
    }
    for (const group of result) {
      for (const line of group.lines) {
        if (!order.current.has(line.key)) order.current.set(line.key, order.current.size);
      }
    }
    const listed = new Set(result.flatMap((group) => group.lines.map((line) => line.key)));
    for (const tick of Object.values(ticks)) {
      if (listed.has(tick.line.key)) continue;
      let group = result.find((g) => g.key === tick.groupKey);
      if (!group) {
        group = { key: tick.groupKey, location: tick.location, lines: [] };
        if (tick.groupKey === OTHER_DECKS) result.push(group);
        else result.splice(result.filter((g) => g.key !== OTHER_DECKS).length, 0, group);
      }
      group.lines.push(tick.line);
    }
    const at = (line: PickLine) => order.current.get(line.key) ?? Number.MAX_SAFE_INTEGER;
    for (const group of result) group.lines.sort((a, b) => at(a) - at(b));
    return result;
  }, [data, ticks]);

  const lineByKey = useMemo(() => {
    const map = new Map<string, { line: PickLine; group: Group }>();
    for (const group of groups) for (const line of group.lines) map.set(line.key, { line, group });
    return map;
  }, [groups]);

  const stackFor = useCallback(
    (line: PickLine) => ticks[line.key]?.line.suggested ?? chosen[line.key] ?? line.suggested,
    [ticks, chosen],
  );

  const isDone = (key: string) => {
    const status = ticks[key]?.status;
    return status === 'pulling' || status === 'pulled';
  };

  const pullLine = (line: PickLine) => {
    const entry = lineByKey.get(line.key);
    if (!entry) return;
    const stack = chosen[line.key] ?? line.suggested;
    setNotice(null);
    setStale(({ [line.key]: _, ...rest }) => rest);
    // The tick keeps the copy it pulled, as the line's suggestion.
    setTicks((all) => ({
      ...all,
      [line.key]: {
        status: 'pulling',
        line: { ...line, suggested: stack },
        groupKey: entry.group.key,
        location: entry.group.location,
      },
    }));
    enqueue(async () => {
      try {
        const result = await pull(deckId, {
          slotId: line.slotId,
          stackId: stack.stackId,
          quantity: line.quantity,
          batchId: batchId.current,
        });
        batchId.current ??= result.batchId;
        setTicks((all) => ({
          ...all,
          [line.key]: { ...all[line.key], status: 'pulled', movementId: result.movementId },
        }));
        // Unticking the line is its undo, so the bar only names the move.
        undoBar.show({ message: result.message, batchId: null });
        refreshOtherScreens();
      } catch (error) {
        setTicks(({ [line.key]: _, ...rest }) => rest);
        if (error instanceof ApiError && error.status === 409) {
          setStale((all) => ({ ...all, [line.key]: true }));
          setChosen(({ [line.key]: _, ...rest }) => rest);
          void query.refetch();
        } else {
          setNotice(messageOf(error));
        }
      }
    });
  };

  const returnLine = (line: PickLine) => {
    const tick = ticks[line.key];
    if (tick?.status !== 'pulled' || tick.movementId === undefined) return;
    const { movementId } = tick;
    setNotice(null);
    setTicks((all) => ({ ...all, [line.key]: { ...tick, status: 'returning' } }));
    enqueue(async () => {
      try {
        const result = await undoMovement(movementId);
        setTicks(({ [line.key]: _, ...rest }) => rest);
        undoBar.show({ message: result.message, batchId: null });
        refreshOtherScreens();
      } catch (error) {
        setTicks((all) => ({ ...all, [line.key]: { ...tick, status: 'pulled' } }));
        setNotice(messageOf(error));
      }
    });
  };

  const onToggle = (walkLine: WalkLineData) => {
    const entry = lineByKey.get(walkLine.key);
    if (!entry) return;
    const status = ticks[walkLine.key]?.status;
    if (status === 'pulled') returnLine(entry.line);
    else if (status) return;
    else if (entry.line.fromDeck) setConfirming(entry.line);
    else pullLine(entry.line);
  };

  const postProxy = (line: MissingLine, printingId: string) => {
    setProxies((all) => ({ ...all, [line.slotId]: { status: 'adding' } }));
    enqueue(async () => {
      try {
        const result = await addProxy(deckId, {
          slotId: line.slotId,
          printingId,
          quantity: line.quantity,
          batchId: batchId.current,
        });
        batchId.current ??= result.batchId;
        setProxies((all) => ({
          ...all,
          [line.slotId]: { status: 'added', movementId: result.movementId },
        }));
        undoBar.show({ message: result.message, batchId: null });
        refreshOtherScreens();
      } catch (error) {
        setProxies(({ [line.slotId]: _, ...rest }) => rest);
        setNotice(messageOf(error));
      }
    });
  };

  const onAddProxy = async (line: MissingLine) => {
    setNotice(null);
    setProxies((all) => ({ ...all, [line.slotId]: { status: 'adding' } }));
    let printings: PrintingSummary[];
    try {
      const details = await queryClient.fetchQuery({
        queryKey: ['cards', line.card.id],
        queryFn: () => fetchCard(line.card.id),
      });
      printings = details.printings;
    } catch (error) {
      setProxies(({ [line.slotId]: _, ...rest }) => rest);
      setNotice(messageOf(error));
      return;
    }
    const { hint } = line;
    const match = hint
      ? printings.find(
          (p) => p.publicCode === hint.publicCode || p.publicCode.startsWith(`${hint.publicCode}/`),
        )
      : undefined;
    if (match) {
      postProxy(line, match.printingId);
    } else {
      setProxies(({ [line.slotId]: _, ...rest }) => rest);
      setChoosingPrinting({ line, printings });
    }
  };

  const onRemoveProxy = (line: MissingLine) => {
    const proxy = proxies[line.slotId];
    if (proxy?.status !== 'added' || proxy.movementId === undefined) return;
    const { movementId } = proxy;
    setNotice(null);
    setProxies((all) => ({ ...all, [line.slotId]: { ...proxy, status: 'removing' } }));
    enqueue(async () => {
      try {
        const result = await undoMovement(movementId);
        setProxies(({ [line.slotId]: _, ...rest }) => rest);
        undoBar.show({ message: result.message, batchId: null });
        refreshOtherScreens();
      } catch (error) {
        setProxies((all) => ({ ...all, [line.slotId]: proxy }));
        setNotice(messageOf(error));
      }
    });
  };

  const walkGroups: WalkGroupData[] = groups.map((group) => ({
    key: group.key,
    location: group.location ?? undefined,
    title: group.location ? undefined : 'In other deck boxes',
    countText: group.location
      ? `pull ${sumQuantity(group.lines)} here`
      : 'Pulling one leaves that deck partly assembled',
    tone: group.location ? 'default' : 'warning',
    lines: group.lines.map((line) => {
      const stack = stackFor(line);
      const switched = !ticks[line.key] && chosen[line.key] !== undefined;
      return {
        key: line.key,
        quantity: line.quantity,
        card: line.card,
        copy: walkCopy(stack),
        done: isDone(line.key),
        tag: stale[line.key]
          ? { text: 'This copy has moved, pick another', tone: 'missing' }
          : switched
            ? { text: `Switched · ${stack.location.path}`, tone: 'info' }
            : line.fromDeck
              ? { text: `In ${line.fromDeck.name} deck box`, tone: 'warning' }
              : line.fromTrade
                ? { text: 'From trade binder', tone: 'trade' }
                : undefined,
        note: line.fromDeck?.becomesPartly
          ? `${line.fromDeck.name} becomes partly assembled`
          : undefined,
      };
    }),
  }));

  const allLines = groups.flatMap((group) => group.lines);
  const progress = {
    done: sumQuantity(allLines.filter((line) => isDone(line.key))),
    total: sumQuantity(allLines),
    label: 'pulled',
  };

  const locationGroups = groups.filter((group) => group.location !== null);
  const currentLine = current ? lineByKey.get(current.line.key) : undefined;
  const stop = currentLine ? locationGroups.indexOf(currentLine.group) : -1;

  const deckPath = `/decks/${deckId}`;
  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        {data && (
          <Link to={deckPath} className="font-semibold text-muted-foreground text-sm">
            {data.deck.name}
          </Link>
        )}
        <h1 className="font-serif text-[44px] leading-[1.05]">Pick list</h1>
        {data && <p className="m-0 max-w-3xl text-muted-foreground">{summary(data)}</p>}
      </div>
      <Button asChild>
        <Link to={deckPath}>Done</Link>
      </Button>
    </div>
  );

  if (!data) {
    return (
      <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-8 pt-8 pb-12">
        {header}
        <Panel className="p-5 text-muted-foreground">
          {query.isError ? messageOf(query.error) : 'Working out the pick list…'}
        </Panel>
      </div>
    );
  }

  const { missing, runes } = data.pickList;
  const nothingLeft = allLines.length === 0 && missing.length === 0 && runes.length === 0;

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-8 pt-8 pb-12">
      {header}
      {notice && (
        <div
          role="alert"
          className="rounded-lg border border-status-missing/30 bg-status-missing-soft px-4 py-3 font-semibold text-status-missing"
        >
          {notice}
        </div>
      )}
      {nothingLeft ? (
        <Panel className="p-5 text-muted-foreground">
          Nothing left to pull. Every slot is filled.
        </Panel>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <WalkList
              groups={walkGroups}
              onToggle={onToggle}
              onCurrentChange={setCurrent}
              renderActions={(walkLine) => {
                const entry = lineByKey.get(walkLine.key);
                if (!entry || ticks[walkLine.key] || entry.line.alternatives.length === 0) {
                  return null;
                }
                const { line } = entry;
                return (
                  <SwitchCopyPopover
                    cardName={line.card.name}
                    quantity={line.quantity}
                    copies={[line.suggested, ...line.alternatives]}
                    chosenStackId={stackFor(line).stackId}
                    onChoose={(stack) => {
                      setStale(({ [line.key]: _, ...rest }) => rest);
                      setChosen(({ [line.key]: _, ...rest }) =>
                        stack.stackId === line.suggested.stackId
                          ? rest
                          : { ...rest, [line.key]: stack },
                      );
                    }}
                  />
                );
              }}
            />
            {missing.length > 0 && (
              <MissingSection
                lines={missing}
                proxies={proxies}
                onAddProxy={onAddProxy}
                onRemoveProxy={onRemoveProxy}
              />
            )}
            {runes.length > 0 && (
              <RunesLine
                runes={runes.map((rune) => ({ name: rune.card.name, quantity: rune.quantity }))}
              />
            )}
          </div>
          <div className="lg:sticky lg:top-5">
            <NowPickingPane
              line={current?.line ?? null}
              location={currentLine ? stackFor(currentLine.line).location : null}
              locationNote={
                stop >= 0
                  ? `Stop ${stop + 1} of ${locationGroups.length}`
                  : currentLine
                    ? 'In another deck box'
                    : undefined
              }
              progress={progress}
            />
          </div>
        </div>
      )}
      <ConfirmPullDialog
        line={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={(line) => {
          setConfirming(null);
          pullLine(line);
        }}
      />
      <ProxyPrintingDialog
        cardName={choosingPrinting?.line.card.name ?? null}
        printings={choosingPrinting?.printings ?? []}
        onCancel={() => setChoosingPrinting(null)}
        onPick={(printing) => {
          if (!choosingPrinting) return;
          setChoosingPrinting(null);
          postProxy(choosingPrinting.line, printing.printingId);
        }}
      />
    </div>
  );
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

/** "13 cards from 4 places in storage, then 1 from other deck boxes. 2 are missing. …" */
function summary({ deck, pickList }: PickListResponse) {
  const storage = sumQuantity(pickList.groups.flatMap((group) => group.lines));
  const other = sumQuantity(pickList.otherDecks);
  const missing = sumQuantity(pickList.missing);
  const parts: string[] = [];
  if (storage > 0) {
    parts.push(
      `${plural(storage, 'card')} from ${plural(pickList.groups.length, 'place')} in storage`,
    );
  }
  if (other > 0) {
    parts.push(
      storage > 0
        ? `then ${other} from other deck boxes`
        : `${plural(other, 'card')} from other deck boxes`,
    );
  }
  let text = parts.length > 0 ? `${parts.join(', ')}.` : '';
  if (missing > 0) text += ` ${missing} ${missing === 1 ? 'is' : 'are'} missing.`;
  text += ` Ticking a line moves that copy into the ${deck.name} deck box.`;
  return text.trim();
}
