import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, List, type LucideIcon, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { BuyItem, BuyItemChange, BuyList as BuyListResponse } from '../../shared/api/buy-list';
import { ErrorBody, type Id } from '../../shared/api/common';
import { api } from '../api';
import { BUY_LIST_QUERY_KEY, printingLabel } from '../components/AddToBuyListDialog';
import { Panel } from '../components/Panel';
import { Input } from '../components/ui/input';
import { typeLine } from '../lib/card-text';
import { cn } from '../lib/utils';

/** The error message a failed answer carries, written for Jeff. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = ErrorBody.safeParse(await res.json().catch(() => null));
  return new Error(body.success ? body.data.error.message : fallback);
}

/** Cards to buy (`/buy-list`). */
export function BuyList() {
  const [listView, setListView] = useRememberedListView();
  const [hoveredId, setHoveredId] = useState<Id | null>(null);
  const actions = useBuyItemActions();

  const list = useQuery({
    queryKey: BUY_LIST_QUERY_KEY,
    queryFn: async (): Promise<BuyListResponse> => {
      const res = await api['buy-list'].$get();
      if (!res.ok) {
        throw await failure(res, "Couldn't load the buy list.");
      }
      return res.json();
    },
  });

  const items = list.data?.items ?? [];
  const copies = items.reduce((sum, item) => sum + item.quantity, 0);
  const previewed = items.find((item) => item.id === hoveredId) ?? items[0];

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-8 pt-8 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-[44px] leading-[1.05]">Buy list</h1>
          {list.isSuccess && items.length > 0 && (
            <p className="text-[15px] text-muted-foreground">
              {plural(items.length, 'card')}, {plural(copies, 'copy', 'copies')}. Nothing lands here
              on its own: you add cards from a deck, a pick list or a card page.
            </p>
          )}
        </div>
        {items.length > 0 && (
          <Toggle
            label="View"
            value={listView}
            onChange={setListView}
            options={[
              { value: 'rows', label: 'Rows', icon: List },
              { value: 'images', label: 'Images', icon: LayoutGrid },
            ]}
          />
        )}
      </div>

      {actions.error && (
        <p role="alert" className="text-sm text-status-missing">
          {actions.error}
        </p>
      )}

      {list.isPending ? (
        <Panel className="p-5 text-muted-foreground">Loading the buy list…</Panel>
      ) : list.isError ? (
        <Panel role="alert" className="p-5 text-status-missing">
          {list.error.message}
        </Panel>
      ) : items.length === 0 ? (
        <Panel className="px-6 py-10 text-center text-muted-foreground">
          Nothing to buy. Add cards from a deck, a pick list or a card page.
        </Panel>
      ) : listView === 'rows' ? (
        <div className="flex flex-wrap items-start gap-5">
          <Panel
            role="region"
            aria-label="Cards to buy"
            className="min-w-0 flex-[999_1_760px] overflow-hidden"
          >
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#f6f7f9] text-left text-muted-foreground text-xs uppercase tracking-[0.04em]">
                  <th scope="col" className="border-border border-b px-4 py-2.5 font-semibold">
                    Card
                  </th>
                  <th scope="col" className="border-border border-b px-2 py-2.5 font-semibold">
                    Printing
                  </th>
                  <th scope="col" className="border-border border-b px-2 py-2.5 font-semibold">
                    Qty
                  </th>
                  <th scope="col" className="border-border border-b px-2 py-2.5 font-semibold">
                    Note
                  </th>
                  <th scope="col" className="border-border border-b px-2 py-2.5 font-semibold">
                    Added
                  </th>
                  <th scope="col" className="border-border border-b py-2.5 pr-4 pl-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    hovered={item.id === previewed?.id}
                    onHover={() => setHoveredId(item.id)}
                    actions={actions}
                  />
                ))}
              </tbody>
            </table>
          </Panel>
          {previewed && <Preview item={previewed} />}
        </div>
      ) : (
        <Panel role="region" aria-label="Cards to buy" className="px-4 py-[18px]">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-3.5 gap-y-5">
            {items.map((item) => (
              <ItemImage key={item.id} item={item} actions={actions} />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function itemImage(item: BuyItem) {
  return item.printing?.imageUrl ?? item.card.imageUrl;
}

/** Such as "Oct 18, 2026", in Jeff's time zone. */
function addedOn(createdAt: string) {
  return new Date(createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------------------
// Editing and removing

type BuyItemActions = {
  change: (id: Id, change: BuyItemChange) => void;
  remove: (id: Id) => void;
  removing: (id: Id) => boolean;
  error: string | null;
};

function useBuyItemActions(): BuyItemActions {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: BUY_LIST_QUERY_KEY });

  const change = useMutation({
    mutationFn: async ({ id, change }: { id: Id; change: BuyItemChange }) => {
      const res = await api['buy-list'][':id'].$patch({ param: { id: String(id) }, json: change });
      if (!res.ok) {
        throw await failure(res, "Couldn't save the change. Try again.");
      }
      return res.json();
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: Id) => {
      const res = await api['buy-list'][':id'].$delete({ param: { id: String(id) } });
      if (!res.ok) {
        throw await failure(res, "Couldn't remove the card. Try again.");
      }
    },
    onSettled: refresh,
  });

  const latest = [change, remove]
    .filter((mutation) => mutation.isError)
    .sort((a, b) => b.submittedAt - a.submittedAt)[0];

  return {
    change: (id, value) => change.mutate({ id, change: value }),
    remove: (id) => remove.mutate(id),
    removing: (id) => remove.isPending && remove.variables === id,
    error: latest?.error?.message ?? null,
  };
}

/** The quantity field: saved when it loses focus, put back when it isn't a whole number. */
function QuantityField({ item, actions }: { item: BuyItem; actions: BuyItemActions }) {
  const [draft, setDraft] = useState(String(item.quantity));
  useEffect(() => setDraft(String(item.quantity)), [item.quantity]);

  const save = () => {
    const quantity = Number(draft);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setDraft(String(item.quantity));
    } else if (quantity !== item.quantity) {
      actions.change(item.id, { quantity });
    }
  };

  return (
    <Input
      type="number"
      inputMode="numeric"
      min={1}
      step={1}
      aria-label={`Quantity of ${item.card.name}`}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      className="w-[72px] tabular-nums"
    />
  );
}

/** The note field: saved when it loses focus. */
function NoteField({ item, actions }: { item: BuyItem; actions: BuyItemActions }) {
  const [draft, setDraft] = useState(item.note);
  useEffect(() => setDraft(item.note), [item.note]);

  const save = () => {
    if (draft !== item.note) {
      actions.change(item.id, { note: draft });
    }
  };

  return (
    <Input
      aria-label={`Note for ${item.card.name}`}
      placeholder="Add a note"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
      className="border-transparent bg-transparent hover:border-input focus-visible:bg-card"
    />
  );
}

function RemoveButton({ item, actions }: { item: BuyItem; actions: BuyItemActions }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${item.card.name}`}
      title="Remove"
      disabled={actions.removing(item.id)}
      onClick={() => actions.remove(item.id)}
      className="inline-flex size-10 items-center justify-center rounded-lg text-status-rune hover:bg-status-missing-soft hover:text-status-missing focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
    >
      <Trash2 aria-hidden="true" className="size-[17px]" />
    </button>
  );
}

// ---------------------------------------------------------------------------------------
// Rows

function ItemRow({
  item,
  hovered,
  onHover,
  actions,
}: {
  item: BuyItem;
  hovered: boolean;
  onHover: () => void;
  actions: BuyItemActions;
}) {
  return (
    <tr
      data-item-id={item.id}
      onMouseEnter={onHover}
      onFocus={onHover}
      className={cn('border-[#eceef2] border-b last:border-b-0', hovered && 'bg-[#f6f8fb]')}
    >
      <td className="px-4 py-2.5 align-middle">
        <div className="flex flex-col gap-0.5">
          <Link
            to={`/cards/${item.card.id}`}
            className="font-semibold text-[15px] text-foreground hover:text-primary hover:underline"
          >
            {item.card.name}
          </Link>
          <span className="text-[13px] text-muted-foreground">{typeLine(item.card)}</span>
        </div>
      </td>
      <td className="px-2 py-2.5 text-sm">
        {item.printing ? (
          printingLabel(item.printing)
        ) : (
          <span className="text-muted-foreground">Any printing</span>
        )}
      </td>
      <td className="px-2 py-2.5">
        <QuantityField item={item} actions={actions} />
      </td>
      <td className="w-[30%] px-2 py-2.5">
        <NoteField item={item} actions={actions} />
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 text-[13px] text-muted-foreground">
        {addedOn(item.createdAt)}
      </td>
      <td className="py-2.5 pr-4 pl-2 text-right">
        <RemoveButton item={item} actions={actions} />
      </td>
    </tr>
  );
}

/** The hovered row's card, beside the table. */
function Preview({ item }: { item: BuyItem }) {
  const image = itemImage(item);
  return (
    <aside aria-label="Card preview" className="flex w-[300px] max-w-full flex-[1_1_260px]">
      <Panel className="flex w-full flex-col items-center gap-3 p-3">
        <div className="aspect-[488/680] w-full overflow-hidden rounded-[12px] bg-muted">
          {image && <img src={image} alt={item.card.name} className="size-full object-contain" />}
        </div>
        <Link
          to={`/cards/${item.card.id}`}
          className="font-semibold text-[13px] text-primary hover:underline"
        >
          Open card page
        </Link>
      </Panel>
    </aside>
  );
}

// ---------------------------------------------------------------------------------------
// Images

function ItemImage({ item, actions }: { item: BuyItem; actions: BuyItemActions }) {
  const image = itemImage(item);
  return (
    <li data-item-id={item.id} className="flex flex-col gap-2">
      <Link
        to={`/cards/${item.card.id}`}
        className="block aspect-[488/680] overflow-hidden rounded-[9px] bg-muted"
      >
        {image ? (
          <img
            src={image}
            alt={item.card.name}
            loading="lazy"
            className="size-full object-contain"
          />
        ) : (
          <span className="flex size-full items-center justify-center p-3 text-center font-semibold">
            {item.card.name}
          </span>
        )}
      </Link>
      <div className="flex flex-col gap-0.5">
        <Link
          to={`/cards/${item.card.id}`}
          className="truncate font-semibold text-foreground hover:text-primary hover:underline"
        >
          {item.card.name}
        </Link>
        <span className="truncate text-[13px] text-muted-foreground">
          {item.printing ? printingLabel(item.printing) : 'Any printing'} ·{' '}
          {addedOn(item.createdAt)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <QuantityField item={item} actions={actions} />
        <RemoveButton item={item} actions={actions} />
      </div>
      <NoteField item={item} actions={actions} />
    </li>
  );
}

// ---------------------------------------------------------------------------------------
// Toolbar

type ListView = 'rows' | 'images';

/** The rows / images switch, remembered across visits; each screen keeps its own choice. */
const LIST_VIEW_KEY = 'buy-list-view';

function useRememberedListView(): [ListView, (view: ListView) => void] {
  const [view, setView] = useState<ListView>(() => {
    try {
      return localStorage.getItem(LIST_VIEW_KEY) === 'images' ? 'images' : 'rows';
    } catch {
      return 'rows';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(LIST_VIEW_KEY, view);
    } catch {
      // Not remembered this time; the switch still works.
    }
  }, [view]);
  return [view, setView];
}

function Toggle<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
}) {
  return (
    <fieldset
      aria-label={label}
      className="flex overflow-hidden rounded-lg border border-input bg-card"
    >
      {options.map(({ value: option, label: optionLabel, icon: Icon }) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'flex h-[38px] items-center gap-1.5 px-3 focus-visible:outline-2 focus-visible:outline-ring',
            value === option
              ? 'bg-[#e8eefc] font-semibold text-[#1b3f9c]'
              : 'font-medium text-muted-foreground hover:bg-[#f4f6fa]',
          )}
        >
          {Icon && <Icon aria-hidden="true" className="size-[15px]" />}
          {optionLabel}
        </button>
      ))}
    </fieldset>
  );
}
