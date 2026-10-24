import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowRightLeft,
  Check,
  ChevronsUpDown,
  Download,
  MapPinPlus,
  Plus,
  Search,
  ShoppingCart,
  X,
} from 'lucide-react';
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link, useSearchParams } from 'react-router';
import { Domain, ErrorBody, type StackRow } from '../../shared/api/common';
import { type CollectionValue, type StacksPage, StacksQuery } from '../../shared/api/stacks';
import { type CollectionTerm, parseCollectionQuery } from '../../shared/collection-query';
import { api } from '../api';
import { AddCardsDialog } from '../components/AddCardsDialog';
import { AddToBuyListDialog } from '../components/AddToBuyListDialog';
import { type CopyStackAction, CopyStackTable } from '../components/CopyStackTable';
import { DOMAIN_WORDS, DomainIcon } from '../components/DomainIcon';
import { LocationPicker, useLocationTree } from '../components/LocationPicker';
import { MoveToDialog } from '../components/MoveToDialog';
import { Panel } from '../components/Panel';
import { Button } from '../components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '../components/ui/command';
import { Input } from '../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { useSetProxy } from '../components/useSetProxy';
import {
  chipLabel,
  findFilter,
  removeTerm,
  replaceFilter,
  toggleDomain,
} from '../lib/collection-search';
import { formatCents, pricesUpdated } from '../lib/money';
import { cn } from '../lib/utils';

/** The query key prefix for GET /api/stacks; the search text follows it. */
export const STACKS_QUERY_KEY = ['stacks'];

/** The query key for GET /api/collection/value, shared with the Locations screen. */
const COLLECTION_VALUE_QUERY_KEY = ['collection', 'value'];

/** The CSV backup of the whole collection, with each card's location. */
const EXPORT_URL = '/api/exports/collection.csv';

type Sort = StacksQuery['sort'];

/** The Sort select's choices, sent as `sort` to GET /api/stacks. */
const sorts: [Sort, string][] = [
  ['name', 'Name'],
  ['value', 'Value'],
  ['location', 'Location'],
  ['set', 'Set and number'],
  ['recent', 'Recently added'],
];

/** How long typing pauses before the search is sent. */
const SEARCH_DELAY_MS = 300;

/** The card types the Type filter offers. */
const cardTypes = ['Legend', 'Unit', 'Spell', 'Gear', 'Battlefield', 'Rune', 'Token'];

/** The rarities the Rarity filter offers. */
const rarities = ['Common', 'Uncommon', 'Rare', 'Epic', 'Showcase', 'Promo'];

/** The choices of a dropdown, plus a typed value that isn't one of them, so it still shows. */
function withTyped(choices: string[], typed: string | undefined): string[] {
  return typed && !choices.some((choice) => choice.toLowerCase() === typed)
    ? [...choices, typed]
    : choices;
}

/** The error message a failed answer carries, written for Jeff. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = ErrorBody.safeParse(await res.json().catch(() => null));
  return new Error(body.success ? body.data.error.message : fallback);
}

/** Every copy Jeff owns, searchable, with where each one is (`/collection`). */
export function Collection() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const sortParam = StacksQuery.shape.sort.safeParse(params.get('sort') ?? undefined);
  const sort: Sort = sortParam.success ? sortParam.data : 'name';
  // The address keeps the search and the sort, leaving out what is the default.
  const show = (next: { q: string; sort: Sort }) =>
    setParams(
      {
        ...(next.q === '' ? {} : { q: next.q }),
        ...(next.sort === 'name' ? {} : { sort: next.sort }),
      },
      { replace: true, preventScrollReset: true },
    );
  const setQ = (next: string) => show({ q: next, sort });
  const setSort = (next: Sort) => show({ q, sort: next });

  const terms = useMemo(() => parseCollectionQuery(q), [q]);
  const invalid = terms.filter((term) => term.kind === 'invalid');
  const sentQ = useDelayed(q.trim(), SEARCH_DELAY_MS);
  // A term the server can't use would only answer 400, so the last good list stays instead.
  const sentOk = useMemo(
    () => parseCollectionQuery(sentQ).every((term) => term.kind !== 'invalid'),
    [sentQ],
  );

  const stacks = useInfiniteQuery({
    queryKey: [...STACKS_QUERY_KEY, sentQ, sort],
    enabled: sentOk,
    initialPageParam: null as string | null,
    getNextPageParam: (page: StacksPage) => page.nextCursor,
    placeholderData: (previous) => previous,
    queryFn: async ({ pageParam }): Promise<StacksPage> => {
      const res = await api.stacks.$get({
        query: {
          ...(sentQ === '' ? {} : { q: sentQ }),
          sort,
          ...(pageParam === null ? {} : { cursor: pageParam }),
        },
      });
      if (!res.ok) {
        throw await failure(res, "Couldn't load the collection.");
      }
      return res.json();
    },
  });

  const worth = useQuery({
    queryKey: COLLECTION_VALUE_QUERY_KEY,
    queryFn: async (): Promise<CollectionValue> => {
      const res = await api.collection.value.$get();
      if (!res.ok) throw await failure(res, "Couldn't load the collection's value.");
      return res.json();
    },
  });

  const rows = useMemo(() => stacks.data?.pages.flatMap((page) => page.rows) ?? [], [stacks.data]);
  const [hovered] = useState(createHoverStore);
  const total = stacks.data?.pages[0]?.total;
  const sets = useSeenSets(rows);

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
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-8 pt-8 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-[44px] leading-[1.05]">Collection</h1>
          {total && (
            <p className="text-[15px] text-muted-foreground" data-testid="collection-totals">
              {sentQ === '' ? '' : 'The search matches '}
              {plural(total.cards, 'card')} in {plural(total.stacks, 'stack')},{' '}
              {plural(total.proxies, 'proxy', 'proxies')}.
            </p>
          )}
          {worth.data && <CollectionWorth worth={worth.data} />}
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="outline" asChild>
            <a
              href={EXPORT_URL}
              aria-label="Export the collection as a CSV"
              download
              title="A CSV backup with each card's location."
            >
              <Download aria-hidden="true" />
              Export
            </a>
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add card
          </Button>
        </div>
      </div>

      <Panel className="flex flex-col gap-3 p-4">
        <SearchBox value={q} onChange={setQ} />
        <Filters
          q={q}
          terms={terms}
          sets={sets}
          sort={sort}
          onChange={setQ}
          onSortChange={setSort}
        />
        {terms.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <ul aria-label="Search terms" className="flex flex-wrap gap-2">
              {terms.map((term) => (
                <Chip key={term.start} term={term} onRemove={() => setQ(removeTerm(q, term))} />
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setQ('')}
              className="px-1 font-medium text-primary text-sm hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
        {invalid.map((term) => (
          <p key={term.start} role="alert" className="text-sm text-status-missing">
            {term.message}
          </p>
        ))}
      </Panel>

      {proxy.error && (
        <p role="alert" className="text-sm text-status-missing">
          {proxy.error.message}
        </p>
      )}

      {stacks.isPending && stacks.fetchStatus !== 'idle' ? (
        <Panel className="p-5 text-muted-foreground">Loading the collection…</Panel>
      ) : stacks.isError && rows.length === 0 ? (
        <Panel role="alert" className="p-5 text-status-missing">
          {stacks.error.message}
        </Panel>
      ) : (
        <div className="flex items-start gap-5">
          <PreviewPane store={hovered} fallback={rows[0] ?? null} />
          <CopyStackTable
            className="min-w-0 flex-1"
            rows={rows}
            actions={actions}
            viewKey="collection-view"
            showValue
            showTradeTag
            onPreview={hovered.set}
            onEndReached={() => {
              if (stacks.hasNextPage && !stacks.isFetchingNextPage) {
                void stacks.fetchNextPage();
              }
            }}
            emptyMessage={
              q.trim() === '' ? (
                <EmptyCollection onAdd={() => setAdding(true)} />
              ) : (
                'No cards match the search.'
              )
            }
          />
        </div>
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
      <AddCardsDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}

/** What the whole collection is worth, and how that was worked out. */
function CollectionWorth({ worth }: { worth: CollectionValue }) {
  return (
    <div className="mt-2 flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">Collection value</span>
      <span
        data-testid="collection-value"
        className="font-semibold text-[30px] tabular-nums leading-tight"
      >
        {formatCents(worth.value)}
      </span>
      <span data-testid="collection-value-note" className="text-[13px] text-muted-foreground">
        {plural(worth.cards - worth.proxies, 'card')} · {worth.noPriceCount.toLocaleString('en-US')}{' '}
        with no price · proxies not counted · {pricesUpdated(worth.pricesUpdatedAt)}
      </span>
    </div>
  );
}

/**
 * Holds the stack under the pointer outside React state, so moving over the rows (which
 * happens on every scroll) redraws only the preview pane, not the whole screen.
 */
function createHoverStore() {
  let row: StackRow | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => row,
    set: (next: StackRow) => {
      if (next === row) return;
      row = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

type HoverStore = ReturnType<typeof createHoverStore>;

/** The card on the left of the list: the hovered stack, or the first one. */
function PreviewPane({ store, fallback }: { store: HoverStore; fallback: StackRow | null }) {
  const hovered = useSyncExternalStore(store.subscribe, store.get);
  const row = hovered ?? fallback;
  if (!row) return null;
  const image = row.printing.imageUrl ?? row.card.imageUrl;
  return (
    <aside className="sticky top-3 hidden w-[240px] shrink-0 lg:block">
      <Panel role="region" aria-label="Card preview" className="flex flex-col gap-2.5 p-2.5 pb-3.5">
        <div className="aspect-[488/680] overflow-hidden rounded-[4.75%/3.5%] bg-[#15161a]">
          {image ? (
            <img src={image} alt={row.card.name} className="size-full object-contain" />
          ) : (
            <span className="flex size-full items-center justify-center p-4 text-center text-white">
              {row.card.name}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 px-1.5">
          <span className="font-semibold">{row.card.name}</span>
          <span className="text-[13px] text-muted-foreground">
            {row.printing.setName} · #{row.printing.collectorNumber}
          </span>
          <span data-testid="preview-price" className="text-[13px] tabular-nums">
            {row.isProxy
              ? 'Proxy, not counted in the value'
              : row.unitPrice === null
                ? 'No price'
                : row.quantity === 1
                  ? `${formatCents(row.unitPrice)} each`
                  : `${formatCents(row.unitPrice)} each · ${formatCents(row.value)} for ${row.quantity}`}
          </span>
          <Link
            to={`/cards/${row.card.id}`}
            className="flex items-center gap-1 font-semibold text-[13px] text-primary hover:underline"
          >
            Open card page
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
      </Panel>
    </aside>
  );
}

/** A new install: start with where the cards live, then add cards. */
function EmptyCollection({ onAdd }: { onAdd: () => void }) {
  return (
    <span className="flex flex-col items-center gap-4 py-4">
      <span>No cards yet. Create a location for each box and binder, then add cards to it.</span>
      <span className="flex flex-wrap justify-center gap-2.5">
        <Button asChild>
          <Link to="/locations">
            <MapPinPlus aria-hidden="true" />
            Create a location
          </Link>
        </Button>
        <Button variant="outline" onClick={onAdd}>
          <Plus aria-hidden="true" />
          Add cards
        </Button>
      </span>
    </span>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const id = useId();
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        Search the collection
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder='Try a name, domain:fury, type:unit, rarity:epic, set:ogn, finish:foil, loc:"Rares binder"'
        className="pl-9"
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

function Filters({
  q,
  terms,
  sets,
  sort,
  onChange,
  onSortChange,
}: {
  q: string;
  terms: CollectionTerm[];
  sets: { code: string; name: string }[];
  sort: Sort;
  onChange: (q: string) => void;
  onSortChange: (sort: Sort) => void;
}) {
  const ids = useId();
  const tree = useLocationTree();
  const finish = findFilter(terms, 'finish');
  const proxy = findFilter(terms, 'proxy');
  const type = findFilter(terms, 'type');
  const rarity = findFilter(terms, 'rarity');
  const location = findFilter(terms, 'location');
  const set = findFilter(terms, 'set');
  const forTrade = findFilter(terms, 'trade')?.value === true;
  const domains = new Set(terms.flatMap((term) => (term.kind === 'domain' ? [term.value] : [])));
  const locationId =
    tree.data?.nodes.find((node) => node.name.toLowerCase() === location?.value.toLowerCase())
      ?.id ?? null;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <fieldset aria-labelledby={`${ids}-domain`} className="flex flex-col gap-1">
        <span id={`${ids}-domain`} className="font-medium text-muted-foreground text-xs">
          Domain
        </span>
        <div className="flex h-10 items-center gap-1">
          {Domain.options.map((value) => {
            const on = domains.has(value);
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                aria-label={DOMAIN_WORDS[value]}
                title={DOMAIN_WORDS[value]}
                onClick={() => onChange(toggleDomain(q, value))}
                className={cn(
                  'inline-flex size-9 items-center justify-center rounded-full border-2 text-[22px] transition-opacity',
                  on ? 'border-primary' : 'border-transparent hover:bg-[#f4f6fa]',
                  domains.size > 0 && !on && 'opacity-40 hover:opacity-100',
                )}
              >
                <DomainIcon domain={value} />
              </button>
            );
          })}
        </div>
      </fieldset>
      <Field label="Type" id={`${ids}-type`}>
        <NativeSelect
          id={`${ids}-type`}
          value={type?.value ?? ''}
          onChange={(event) =>
            onChange(
              replaceFilter(
                q,
                'type',
                event.target.value === '' ? null : { kind: 'type', value: event.target.value },
              ),
            )
          }
        >
          <NativeSelectOption value="">Any type</NativeSelectOption>
          {withTyped(cardTypes, type?.value).map((name) => (
            <NativeSelectOption key={name} value={name.toLowerCase()}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Rarity" id={`${ids}-rarity`}>
        <NativeSelect
          id={`${ids}-rarity`}
          value={rarity?.value ?? ''}
          onChange={(event) =>
            onChange(
              replaceFilter(
                q,
                'rarity',
                event.target.value === '' ? null : { kind: 'rarity', value: event.target.value },
              ),
            )
          }
        >
          <NativeSelectOption value="">Any rarity</NativeSelectOption>
          {withTyped(rarities, rarity?.value).map((name) => (
            <NativeSelectOption key={name} value={name.toLowerCase()}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Set" id={`${ids}-set`}>
        <SetFilter
          id={`${ids}-set`}
          sets={sets}
          value={set?.value}
          onChange={(code) => onChange(replaceFilter(q, 'set', { kind: 'set', value: code }))}
        />
      </Field>
      <Field label="Finish" id={`${ids}-finish`}>
        <NativeSelect
          id={`${ids}-finish`}
          value={finish?.value ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            onChange(
              replaceFilter(
                q,
                'finish',
                value === 'normal' || value === 'foil' ? { kind: 'finish', value } : null,
              ),
            );
          }}
        >
          <NativeSelectOption value="">Any finish</NativeSelectOption>
          <NativeSelectOption value="normal">Normal</NativeSelectOption>
          <NativeSelectOption value="foil">Foil</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field label="Proxy" id={`${ids}-proxy`}>
        <NativeSelect
          id={`${ids}-proxy`}
          value={proxy === undefined ? '' : proxy.value ? 'proxy' : 'real'}
          onChange={(event) => {
            const value = event.target.value;
            onChange(
              replaceFilter(
                q,
                'proxy',
                value === '' ? null : { kind: 'proxy', value: value === 'proxy' },
              ),
            );
          }}
        >
          <NativeSelectOption value="">Real and proxy</NativeSelectOption>
          <NativeSelectOption value="real">Real only</NativeSelectOption>
          <NativeSelectOption value="proxy">Proxies only</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field label="Location" id={`${ids}-location`} className="w-[240px]">
        <LocationPicker
          id={`${ids}-location`}
          value={locationId}
          placeholder={location?.value ?? 'Anywhere'}
          onChange={(id) => {
            const node = tree.data?.nodes.find((n) => n.id === id);
            if (node) {
              onChange(replaceFilter(q, 'location', { kind: 'location', value: node.name }));
            }
          }}
        />
      </Field>
      <button
        type="button"
        aria-pressed={forTrade}
        onClick={() =>
          onChange(replaceFilter(q, 'trade', forTrade ? null : { kind: 'trade', value: true }))
        }
        className={cn(
          'inline-flex h-10 items-center gap-2 rounded-full border px-4 font-medium text-sm',
          forTrade
            ? 'border-trade bg-trade-soft text-trade'
            : 'border-input bg-card text-foreground hover:bg-[#f4f6fa]',
        )}
      >
        <span aria-hidden="true" className="size-2.5 rounded-full bg-trade" />
        For trade
      </button>
      <Field label="Sort" id={`${ids}-sort`} className="ml-auto">
        <NativeSelect
          id={`${ids}-sort`}
          value={sort}
          onChange={(event) => {
            const picked = sorts.find(([value]) => value === event.target.value);
            if (picked) onSortChange(picked[0]);
          }}
        >
          {sorts.map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
    </div>
  );
}

function Field({
  label,
  id,
  className,
  children,
}: {
  label: string;
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="font-medium text-muted-foreground text-xs">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Picks a set from the sets of the copies loaded so far, searchable by code or name. */
function SetFilter({
  id,
  sets,
  value,
  onChange,
}: {
  id: string;
  sets: { code: string; name: string }[];
  value: string | undefined;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const picked = sets.find((set) => set.code === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          className="flex h-10 w-[220px] min-w-0 items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {value ? (
            <span className="truncate">{picked ? picked.name : value.toUpperCase()}</span>
          ) : (
            <span className="truncate text-muted-foreground">Any set</span>
          )}
          <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] overflow-hidden p-0">
        <Command label="Search sets" className="bg-popover">
          <CommandInput placeholder="Search sets" />
          <CommandList aria-label="Sets">
            <CommandEmpty>No set matches.</CommandEmpty>
            {sets.map((set) => (
              <CommandItem
                key={set.code}
                value={`${set.code} ${set.name}`}
                onSelect={() => {
                  onChange(set.code);
                  setOpen(false);
                }}
                className="m-1 min-h-9 rounded-md"
              >
                <span className="truncate">{set.name}</span>
                <span className="text-muted-foreground text-xs">{set.code}</span>
                <Check
                  aria-hidden="true"
                  className={cn(
                    'ml-auto size-4 text-primary',
                    set.code === value ? 'opacity-100' : 'opacity-0',
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

function Chip({ term, onRemove }: { term: CollectionTerm; onRemove: () => void }) {
  const label = chipLabel(term);
  return (
    <li
      className={cn(
        'inline-flex h-8 items-center gap-1 rounded-full border pr-1 pl-3 font-medium text-sm',
        term.kind === 'invalid'
          ? 'border-status-missing text-status-missing'
          : 'border-[#c9d6f5] bg-[#e8eefc] text-[#1b3f9c]',
      )}
    >
      {label}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="inline-flex size-6 items-center justify-center rounded-full hover:bg-black/10"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

/** The value, once it has stopped changing for `delay` ms. */
function useDelayed<T>(value: T, delay: number): T {
  const [delayed, setDelayed] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDelayed(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return delayed;
}

/**
 * The sets of every copy loaded since the screen opened, by name. Kept across searches, so
 * picking a set doesn't shrink the list to that one set.
 */
function useSeenSets(rows: StackRow[]) {
  const seen = useRef(new Map<string, string>());
  return useMemo(() => {
    for (const row of rows) seen.current.set(row.printing.setCode, row.printing.setName);
    return [...seen.current]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}
