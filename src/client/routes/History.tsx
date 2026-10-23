import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronDown, ChevronRight, ChevronsUpDown, Undo2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorBody, type Id, type LocationRef } from '../../shared/api/common';
import type { DeckList } from '../../shared/api/decks';
import type {
  BatchKind,
  HistoryBatch,
  HistoryDay,
  HistoryEntry,
  MovementReason,
  MovementRow,
} from '../../shared/api/history';
import { api } from '../api';
import { LocationPicker } from '../components/LocationPicker';
import { LocationTile } from '../components/LocationTile';
import { Panel } from '../components/Panel';
import { useUndoBar } from '../components/UndoBar';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '../components/ui/command';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { cardDetailsQuery, useCardSearch } from '../lib/cards';
import { cn } from '../lib/utils';

/** The error message a failed answer carries, written for Jeff. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = ErrorBody.safeParse(await res.json().catch(() => null));
  return new Error(body.success ? body.data.error.message : fallback);
}

type Scope = 'all' | 'card' | 'location' | 'deck';

const scopes: { value: Scope; label: string }[] = [
  { value: 'all', label: 'Recently moved' },
  { value: 'card', label: 'Card' },
  { value: 'location', label: 'Location' },
  { value: 'deck', label: 'Deck' },
];

/** An id from the address, or null when it is missing or not a whole number. */
function idFrom(text: string | null): Id | null {
  const id = Number(text);
  return text && Number.isInteger(id) && id > 0 ? id : null;
}

/** Every movement by day, with undo (`/history`). */
export function History() {
  const [params, setParams] = useSearchParams();
  const card = params.get('card');
  const location = params.get('location');
  const deck = params.get('deck');
  // A scope picked before its card, location or deck is; the address decides once one is.
  const [picking, setPicking] = useState<Scope>('all');
  const scope: Scope = card ? 'card' : location ? 'location' : deck ? 'deck' : picking;

  const pickScope = (next: Scope) => {
    setPicking(next);
    if (next !== scope) {
      setParams({});
    }
  };
  const filterBy = (key: 'card' | 'location' | 'deck', value: string) => {
    setPicking(key);
    setParams({ [key]: value });
  };

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-4 px-8 pt-8 pb-12">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-[44px] leading-[1.05]">History</h1>
        <p className="text-[15px] text-muted-foreground">
          Every move of every copy, newest first. Undo writes the reverse move, so nothing here is
          ever deleted.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <fieldset
          aria-label="Show history for"
          className="inline-flex overflow-hidden rounded-lg border border-input bg-card"
        >
          {scopes.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={scope === option.value}
              onClick={() => pickScope(option.value)}
              className={cn(
                'h-10 border-border border-r px-3.5 last:border-r-0 focus-visible:outline-2 focus-visible:outline-ring',
                scope === option.value
                  ? 'bg-[#e8eefc] font-semibold text-[#1b3f9c]'
                  : 'font-medium text-muted-foreground hover:bg-[#f4f6fa]',
              )}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        {scope === 'card' && (
          <div className="w-[300px]">
            <CardFilter oracleId={card} onChange={(oracleId) => filterBy('card', oracleId)} />
          </div>
        )}
        {scope === 'location' && (
          <div className="w-[300px]">
            <label htmlFor="history-location" className="sr-only">
              Location
            </label>
            <LocationPicker
              id="history-location"
              value={idFrom(location)}
              onChange={(id) => filterBy('location', String(id))}
              placeholder="Pick a location"
            />
          </div>
        )}
        {scope === 'deck' && (
          <DeckFilter deckId={idFrom(deck)} onChange={(id) => filterBy('deck', String(id))} />
        )}
      </div>

      <HistoryList card={card} location={location} deck={deck} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// The list

const columns =
  'grid grid-cols-[84px_minmax(0,1.5fr)_48px_minmax(0,2fr)_112px_minmax(0,120px)_96px] items-center gap-3';

function HistoryList({
  card,
  location,
  deck,
}: {
  card: string | null;
  location: string | null;
  deck: string | null;
}) {
  // Days follow Jeff's clock.
  const offset = useMemo(() => new Date().getTimezoneOffset(), []);
  const undo = useUndo();

  const history = useInfiniteQuery({
    queryKey: ['history', { card, location, deck, offset }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<HistoryDay> => {
      const query: Record<string, string> = { offset: String(offset) };
      if (pageParam) query.before = pageParam;
      if (card) query.card = card;
      if (location) query.location = location;
      if (deck) query.deck = deck;
      const res = await api.history.$get({ query: query as { offset: string } });
      if (!res.ok) {
        throw await failure(res, "Couldn't load the history.");
      }
      return res.json();
    },
    getNextPageParam: (day) => day.nextBefore ?? undefined,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = history;
  const end = useRef<HTMLDivElement>(null);
  // Load the next older day as the end of the list scrolls into view.
  useEffect(() => {
    const target = end.current;
    if (!target || !hasNextPage || isFetchingNextPage) {
      return;
    }
    const observer = new IntersectionObserver(
      (seen) => {
        if (seen.some((entry) => entry.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { rootMargin: '0px 0px 200px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const days = (history.data?.pages ?? []).filter((day) => day.entries.length > 0);

  return (
    <>
      {undo.error && (
        <p role="alert" className="text-sm text-status-missing">
          {undo.error}
        </p>
      )}
      {history.isPending ? (
        <Panel className="p-5 text-muted-foreground">Loading the history…</Panel>
      ) : history.isError && days.length === 0 ? (
        <Panel role="alert" className="p-5 text-status-missing">
          {history.error.message}
        </Panel>
      ) : days.length === 0 ? (
        <Panel className="px-6 py-10 text-center text-muted-foreground">No moves match.</Panel>
      ) : (
        <Panel role="region" aria-label="Moves" className="overflow-hidden">
          <div
            aria-hidden="true"
            className={cn(
              columns,
              'border-border border-b bg-[#f6f7f9] px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-[0.04em]',
            )}
          >
            <span>Time</span>
            <span>Card</span>
            <span>Qty</span>
            <span>From → to</span>
            <span>Reason</span>
            <span>Deck</span>
            <span />
          </div>
          {days.map((day) => (
            <section key={day.day} aria-label={dayLabel(day.day)} data-day={day.day}>
              <h2 className="border-[#eceef2] border-b bg-[#fbfbfc] px-4 py-2 font-bold text-[#2b303b] text-[13px]">
                {dayLabel(day.day)}
              </h2>
              <ul>
                {day.entries.map((entry) => (
                  <Entry key={entryKey(entry)} entry={entry} undo={undo} />
                ))}
              </ul>
            </section>
          ))}
        </Panel>
      )}
      <div ref={end} aria-live="polite" className="text-center text-muted-foreground text-sm">
        {isFetchingNextPage
          ? 'Loading older moves…'
          : history.isError && days.length > 0
            ? history.error.message
            : history.isSuccess && !hasNextPage && days.length > 0
              ? 'That is the start of the history.'
              : null}
      </div>
    </>
  );
}

const entryKey = (entry: HistoryEntry) =>
  entry.kind === 'batch' ? `batch-${entry.batch.id}` : `movement-${entry.movement.id}`;

function Entry({ entry, undo }: { entry: HistoryEntry; undo: Undo }) {
  return entry.kind === 'batch' ? (
    <BatchEntry batch={entry.batch} undo={undo} />
  ) : (
    <MovementEntry movement={entry.movement} undo={undo} />
  );
}

function MovementEntry({ movement, undo }: { movement: MovementRow; undo: Undo }) {
  const undone = movement.undoneAt !== null;
  const isUndo = movement.reason === 'undo';
  return (
    <li
      data-movement-id={movement.id}
      data-undone={undone || undefined}
      className={cn(
        columns,
        'border-[#eceef2] border-b px-4 py-2 hover:bg-[#f6f8fb]',
        isUndo && 'bg-[#fffaf0]',
      )}
    >
      <Time at={movement.createdAt} />
      <Faded undone={undone}>
        <CardName movement={movement} undone={undone} />
      </Faded>
      <Faded undone={undone} className="font-semibold tabular-nums">
        {movement.quantity}
      </Faded>
      <Faded undone={undone}>
        <FromTo from={movement.from} to={movement.to} />
      </Faded>
      <Faded undone={undone}>
        <ReasonChip reason={movement.reason} />
      </Faded>
      <Faded undone={undone}>
        <DeckLink deck={movement.deck} />
      </Faded>
      <span className="text-right">
        {undone ? (
          <UndoneTag />
        ) : isUndo ? null : (
          <UndoButton
            label={`Undo this move of ${movement.card.name}`}
            pending={undo.pending({ kind: 'movement', id: movement.id })}
            onClick={() => undo.run({ kind: 'movement', id: movement.id })}
          />
        )}
      </span>
    </li>
  );
}

function BatchEntry({ batch, undo }: { batch: HistoryBatch; undo: Undo }) {
  const [open, setOpen] = useState(false);
  const { undone } = batch;
  const quantity = batch.movements.reduce((sum, movement) => sum + movement.quantity, 0);
  const froms = distinct(batch.movements.map((movement) => movement.from));
  const tos = distinct(batch.movements.map((movement) => movement.to));
  const canUndo = !undone && batch.kind !== 'undo';

  return (
    <li data-batch-id={batch.id} data-undone={undone || undefined}>
      <div
        className={cn(
          columns,
          'border-[#eceef2] border-b px-4 py-2 hover:bg-[#f6f8fb]',
          batch.kind === 'undo' && 'bg-[#fffaf0]',
        )}
      >
        <Time at={batch.createdAt} />
        <Faded undone={undone} className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`Show the moves in ${batch.summary}`}
            onClick={() => setOpen(!open)}
            className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-md border border-input bg-card text-muted-foreground hover:bg-[#f4f6fa]"
          >
            {open ? (
              <ChevronDown aria-hidden="true" className="size-3.5" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-3.5" />
            )}
          </button>
          <span className="flex min-w-0 flex-col">
            <span className={cn('truncate font-semibold', undone && 'line-through')}>
              {batch.summary}
            </span>
            <span className="text-muted-foreground text-xs">
              {plural(batch.movements.length, 'movement')}
            </span>
          </span>
        </Faded>
        <Faded undone={undone} className="font-semibold tabular-nums">
          {quantity}
        </Faded>
        <Faded undone={undone}>
          <FromTo
            from={froms.length === 1 ? froms[0] : `From ${froms.length} places`}
            to={tos.length === 1 ? tos[0] : `To ${tos.length} places`}
          />
        </Faded>
        <Faded undone={undone}>
          <ReasonChip reason={batchReason[batch.kind]} />
        </Faded>
        <Faded undone={undone}>
          <DeckLink deck={batch.deck} />
        </Faded>
        <span className="text-right">
          {undone ? (
            <UndoneTag />
          ) : canUndo ? (
            <UndoButton
              label={`Undo ${batch.summary}`}
              pending={undo.pending({ kind: 'batch', id: batch.id })}
              onClick={() => undo.run({ kind: 'batch', id: batch.id })}
            />
          ) : null}
        </span>
      </div>
      {open && (
        <ul
          aria-label={`Moves in ${batch.summary}`}
          className="border-[#eceef2] border-b bg-[#fafbfc] py-1"
        >
          {batch.movements.map((movement) => {
            const movementUndone = movement.undoneAt !== null;
            return (
              <li
                key={movement.id}
                data-movement-id={movement.id}
                data-undone={movementUndone || undefined}
                className={cn(columns, 'px-4 py-1 text-[13px]')}
              >
                <Time at={movement.createdAt} />
                <Faded undone={movementUndone} className="pl-[34px]">
                  <CardName movement={movement} undone={movementUndone} />
                </Faded>
                <Faded undone={movementUndone} className="tabular-nums">
                  {movement.quantity}
                </Faded>
                <Faded undone={movementUndone}>
                  <FromTo from={movement.from} to={movement.to} />
                </Faded>
                <Faded undone={movementUndone}>
                  <ReasonChip reason={movement.reason} />
                </Faded>
                <span />
                <span className="text-right">
                  {movementUndone ? (
                    <UndoneTag />
                  ) : movement.reason === 'undo' || undone ? null : (
                    <UndoButton
                      small
                      label={`Undo this move of ${movement.card.name}`}
                      pending={undo.pending({ kind: 'movement', id: movement.id })}
                      onClick={() => undo.run({ kind: 'movement', id: movement.id })}
                    />
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** The locations among a batch's movements, each once (null, for none, counts too). */
function distinct(locations: (LocationRef | null)[]) {
  const seen = new Map<Id | null, LocationRef | null>();
  for (const location of locations) {
    seen.set(location?.id ?? null, location);
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------------------
// Pieces of a row

function Faded({
  undone,
  className,
  children,
}: {
  undone: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cn('min-w-0', undone && 'opacity-50', className)}>{children}</span>;
}

/** Such as "3:15 PM", on Jeff's clock. */
function Time({ at }: { at: string }) {
  return (
    <time dateTime={at} className="text-[13px] text-muted-foreground tabular-nums">
      {new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
    </time>
  );
}

const rarityClasses = new Set(['common', 'uncommon', 'rare', 'mythic']);

function CardName({ movement, undone }: { movement: MovementRow; undone: boolean }) {
  const { card, printing } = movement;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <i
        aria-hidden="true"
        className={cn(
          'ss ss-fw shrink-0 text-[15px]',
          `ss-${printing.setCode}`,
          rarityClasses.has(printing.rarity) && `ss-${printing.rarity}`,
        )}
      />
      <Link
        to={`/cards/${card.oracleId}`}
        className={cn(
          'truncate font-semibold text-foreground hover:underline',
          undone && 'line-through',
        )}
      >
        {card.name}
      </Link>
    </span>
  );
}

function Place({ location }: { location: LocationRef | string | null }) {
  if (location === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (typeof location === 'string') {
    return <span className="truncate text-muted-foreground">{location}</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-location-id={location.id}>
      <LocationTile type={location.type} color={location.color} size="sm" />
      <span className="truncate">{location.path}</span>
    </span>
  );
}

function FromTo({
  from,
  to,
}: {
  from: LocationRef | string | null;
  to: LocationRef | string | null;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-[13px]">
      <span className="min-w-0" data-side="from">
        <Place location={from} />
      </span>
      <ArrowRight aria-label="to" className="size-3.5 shrink-0 text-[#8a909c]" />
      <span className="min-w-0 font-semibold" data-side="to">
        <Place location={to} />
      </span>
    </span>
  );
}

const reasonWords: Record<MovementReason, string> = {
  imported: 'Imported',
  added: 'Added',
  moved: 'Moved',
  assembled: 'Pulled',
  returned: 'Returned',
  swapped_out: 'Swapped out',
  swapped_in: 'Swapped in',
  location_update: 'Location update',
  undo: 'Undo',
};

const reasonColors: Record<MovementReason, string> = {
  imported: 'bg-[#e2f2f4] text-[#0e6170]',
  added: 'bg-[#e2f2f4] text-[#0e6170]',
  moved: 'bg-[#eef0f3] text-[#3b4252]',
  assembled: 'bg-[#e8eefc] text-[#1b3f9c]',
  returned: 'bg-[#e3f3e9] text-[#146c3a]',
  swapped_out: 'bg-[#f0ebfa] text-[#5b3fa8]',
  swapped_in: 'bg-[#f0ebfa] text-[#5b3fa8]',
  location_update: 'bg-[#eef0f3] text-[#3b4252]',
  undo: 'bg-[#fdf0dc] text-[#8f4a00]',
};

/** The reason a batch's chip shows. A swap batch holds both directions. */
const batchReason: Record<BatchKind, MovementReason | 'swap'> = {
  import: 'imported',
  pick_list: 'assembled',
  put_away: 'returned',
  swap: 'swap',
  move: 'moved',
  add: 'added',
  undo: 'undo',
};

function ReasonChip({ reason }: { reason: MovementReason | 'swap' }) {
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 font-bold text-xs',
        reason === 'swap' ? reasonColors.swapped_in : reasonColors[reason],
      )}
    >
      {reason === 'swap' ? 'Swapped' : reasonWords[reason]}
    </span>
  );
}

function DeckLink({ deck }: { deck: { id: Id; name: string } | null }) {
  return deck ? (
    <Link
      to={`/decks/${deck.id}`}
      className="block truncate font-semibold text-[13px] text-primary hover:underline"
    >
      {deck.name}
    </Link>
  ) : (
    <span className="text-[#8a909c] text-[13px]">—</span>
  );
}

function UndoneTag() {
  return (
    <span className="rounded-full bg-status-basic-soft px-2 py-0.5 font-semibold text-status-basic text-xs">
      Undone
    </span>
  );
}

function UndoButton({
  label,
  pending,
  onClick,
  small = false,
}: {
  label: string;
  pending: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={pending}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border bg-card font-semibold hover:border-[#e6c48f] hover:bg-[#fdf0dc] hover:text-[#8f4a00] focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60',
        small ? 'h-[26px] border-border px-2 text-xs' : 'h-[30px] border-input px-2.5 text-[13px]',
      )}
    >
      {!small && <Undo2 aria-hidden="true" className="size-3.5" />}
      {pending ? 'Undoing…' : 'Undo'}
    </button>
  );
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date as "2026-10-18", on Jeff's clock. */
function localDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Today", "Yesterday", or such as "Sat 18 Oct" (with the year when it isn't this year). */
function dayLabel(day: string) {
  const now = new Date();
  if (day === localDate(now)) return 'Today';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (day === localDate(yesterday)) return 'Yesterday';
  const [year, month, date] = day.split('-').map(Number);
  const when = new Date(year, month - 1, date);
  const label = `${weekdays[when.getDay()]} ${date} ${months[month - 1]}`;
  return year === now.getFullYear() ? label : `${label} ${year}`;
}

// ---------------------------------------------------------------------------------------
// Undo

type UndoTarget = { kind: 'movement' | 'batch'; id: Id };

type Undo = {
  run: (target: UndoTarget) => void;
  pending: (target: UndoTarget) => boolean;
  error: string | null;
};

function useUndo(): Undo {
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ kind, id }: UndoTarget) => {
      const param = { id: String(id) };
      const res =
        kind === 'movement'
          ? await api.movements[':id'].undo.$post({ param })
          : await api.batches[':id'].undo.$post({ param });
      if (!res.ok) {
        throw await failure(res, "Couldn't undo that. Check the list to see what moved.");
      }
      return res.json();
    },
    onMutate: () => setError(null),
    onSuccess: (result) => {
      undoBar.show({ message: result.message, batchId: result.batchId });
      // Copies moved back, so every screen's data may be out of date.
      void queryClient.invalidateQueries();
    },
    onError: (failed) => setError(failed.message),
  });

  return {
    run: (target) => mutation.mutate(target),
    pending: (target) =>
      mutation.isPending &&
      mutation.variables?.kind === target.kind &&
      mutation.variables.id === target.id,
    error,
  };
}

// ---------------------------------------------------------------------------------------
// Filters

/** Picks a card by searching its name; shows the picked card's name. */
function CardFilter({
  oracleId,
  onChange,
}: {
  oracleId: string | null;
  onChange: (oracleId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), 150);
    return () => clearTimeout(timer);
  }, [text]);

  const picked = useQuery({ ...cardDetailsQuery(oracleId ?? ''), enabled: oracleId !== null });
  const search = useCardSearch(query);
  const results = query.trim() === '' ? [] : (search.data?.results ?? []);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setText('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label="Card"
          aria-expanded={open}
          aria-haspopup="listbox"
          className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {oracleId ? (
            <span className="truncate font-semibold">
              {picked.data?.card.name ?? (picked.isError ? 'Unknown card' : 'Loading…')}
            </span>
          ) : (
            <span className="truncate text-muted-foreground">Search for a card</span>
          )}
          <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-[280px] overflow-hidden p-0"
      >
        <Command label="Search cards" shouldFilter={false} className="bg-popover">
          <CommandInput value={text} onValueChange={setText} placeholder="Search cards" />
          <CommandList aria-label="Cards">
            {text.trim() !== '' && (
              <CommandEmpty>
                {search.isFetching || query !== text
                  ? 'Searching…'
                  : `No cards match “${text.trim()}”.`}
              </CommandEmpty>
            )}
            {results.map((result) => (
              <CommandItem
                key={result.oracleId}
                value={result.oracleId}
                onSelect={() => {
                  onChange(result.oracleId);
                  setOpen(false);
                  setText('');
                }}
                className="m-1 min-h-9 rounded-md"
              >
                <span className="truncate">{result.name}</span>
                <Check
                  aria-hidden="true"
                  className={cn(
                    'ml-auto size-4 text-primary',
                    result.oracleId === oracleId ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DeckFilter({ deckId, onChange }: { deckId: Id | null; onChange: (id: Id) => void }) {
  const decks = useQuery({
    queryKey: ['decks'],
    queryFn: async (): Promise<DeckList> => {
      const res = await api.decks.$get();
      if (!res.ok) {
        throw await failure(res, "Couldn't load the decks.");
      }
      return res.json();
    },
  });

  return (
    <NativeSelect
      aria-label="Deck"
      value={deckId === null ? '' : String(deckId)}
      onChange={(event) => onChange(Number(event.target.value))}
      className="min-w-[240px]"
    >
      <NativeSelectOption value="" disabled>
        {decks.isPending ? 'Loading decks…' : decks.isError ? decks.error.message : 'Pick a deck'}
      </NativeSelectOption>
      {decks.data?.decks.map((d) => (
        <NativeSelectOption key={d.id} value={d.id}>
          {d.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
