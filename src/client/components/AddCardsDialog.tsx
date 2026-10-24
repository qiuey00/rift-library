import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, Search, Undo2 } from 'lucide-react';
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from 'react';
import type { CardDetailsResponse, CardSearchResponse } from '../../shared/api/cards';
import {
  type ActionResult,
  type CardSummary,
  ErrorBody,
  type Finish,
  type Id,
  type PrintingSummary,
} from '../../shared/api/common';
import type { AddCopiesBody } from '../../shared/api/copies';
import { api } from '../api';
import { isPublicCode } from '../lib/card-text';
import { CONDITIONS, choiceLabel, FINISH_WORDS, LANGUAGES } from '../lib/copy-fields';
import { cn } from '../lib/utils';
import { LocationPicker, useLocationTree } from './LocationPicker';
import { ProxyTag } from './ProxyTag';
import { undoBatch } from './UndoBar';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { NativeSelect, NativeSelectOption } from './ui/native-select';

export type AddCardsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The location the cards go to until Jeff picks another; the "to sort" inbox when left out. */
  defaultLocationId?: Id;
};

/** How long typing must pause before the search runs. */
const DEBOUNCE_MS = 200;
/** The most cards whose printings the search shows. */
const CARD_LIMIT = 6;
/** The printings in a row of the results, which the up and down arrows move by. */
const COLUMNS = 6;

/** The error message a failed answer carries, written for Jeff. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = ErrorBody.safeParse(await res.json().catch(() => null));
  return new Error(body.success ? body.data.error.message : fallback);
}

/** One printing in the search results, with the card it belongs to. */
type Match = { card: CardSummary; printing: PrintingSummary };

/** One line of the Added list. */
type AddedLine = {
  key: number;
  batchId: Id | null;
  quantity: number;
  name: string;
  publicCode: string;
  finish: Finish;
  condition: string;
  language: string;
  isProxy: boolean;
  location: string;
  phase: 'added' | 'undoing' | 'failed';
  /** Why the undo failed, written for Jeff. */
  error?: string;
};

/**
 * Quick add (COL-5, COL-12): search by name or public code, pick a printing with the arrow
 * keys and press Enter to add it. After each add the search clears and keeps focus, and the
 * location and every field keep their value, so a run of cards needs only names and Enter.
 * Each add is its own batch, undone from its line in the Added list; the undo bar stays away
 * while the dialog is open, and the screen underneath refreshes when it closes.
 */
export function AddCardsDialog({ open, onOpenChange, defaultLocationId }: AddCardsDialogProps) {
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const changed = useRef(false);

  const change = (next: boolean) => {
    if (!next && changed.current) {
      changed.current = false;
      // Copies were added or taken back, so every screen's counts and lists may be out of date.
      void queryClient.invalidateQueries();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
        className="max-h-[calc(100vh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[920px]"
      >
        {/* Mounted only while open, so each opening starts from the props again. */}
        <AddCardsForm
          defaultLocationId={defaultLocationId}
          searchRef={searchRef}
          onChanged={() => {
            changed.current = true;
          }}
          onClose={() => change(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

/** The printings of the cards matching `q`, the typed public code's printing first. */
function usePrintingSearch(q: string) {
  const search = useQuery({
    queryKey: ['cards', 'search', { q, limit: CARD_LIMIT }],
    enabled: q !== '',
    queryFn: async (): Promise<CardSearchResponse> => {
      const res = await api.cards.$get({ query: { q, limit: String(CARD_LIMIT) } });
      if (!res.ok) {
        throw await failure(res, "Couldn't search the cards.");
      }
      return res.json();
    },
  });
  const cards = q !== '' ? (search.data?.results ?? []) : [];
  const details = useQueries({
    queries: cards.map((card) => ({
      queryKey: ['cards', card.id],
      queryFn: async (): Promise<CardDetailsResponse> => {
        const res = await api.cards[':id'].$get({ param: { id: String(card.id) } });
        if (!res.ok) {
          throw await failure(res, "Couldn't load this card's printings.");
        }
        return res.json();
      },
    })),
  });

  const matches: Match[] = cards.flatMap((card, i) =>
    (details[i]?.data?.printings ?? []).map((printing) => ({ card, printing })),
  );
  const byCode = matches.filter((m) => isPublicCode(m.printing.publicCode, q));
  const ordered = [...byCode, ...matches.filter((m) => !byCode.includes(m))];

  let message: string | null = null;
  if (q !== '') {
    if (search.isError) message = search.error.message;
    else if (!search.data || (ordered.length === 0 && details.some((d) => d.isPending)))
      message = 'Searching…';
    else if (ordered.length === 0) message = 'No cards match.';
  }
  return { matches: ordered, message };
}

function AddCardsForm({
  defaultLocationId,
  searchRef,
  onChanged,
  onClose,
}: {
  defaultLocationId?: Id;
  searchRef: RefObject<HTMLInputElement | null>;
  onChanged: () => void;
  onClose: () => void;
}) {
  const ids = useId();
  const tree = useLocationTree();

  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const { matches, message } = usePrintingSearch(q);
  const [selected, setSelected] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [pickedFinish, setPickedFinish] = useState<Finish>('normal');
  const [condition, setCondition] = useState('near_mint');
  const [language, setLanguage] = useState('en');
  const [isProxy, setIsProxy] = useState(false);
  const [pickedLocation, setPickedLocation] = useState<Id | null>(null);
  const [added, setAdded] = useState<AddedLine[]>([]);
  const nextKey = useRef(0);

  // A new search starts on its first printing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the search changes
  useEffect(() => setSelected(0), [q]);

  const nodes = tree.data?.nodes ?? [];
  const inboxId = nodes.find((node) => node.type === 'inbox')?.id ?? null;
  const locationId = pickedLocation ?? defaultLocationId ?? inboxId;
  const location = nodes.find((node) => node.id === locationId);

  // Results still showing for text that changed aren't what Jeff is looking for any more.
  const current = q === text.trim() ? matches : [];
  const match = current[Math.min(selected, current.length - 1)];
  const finishes = match?.printing.finishes ?? [];
  // The finish Jeff picked, unless this printing doesn't come in it.
  const finish = finishes.includes(pickedFinish) ? pickedFinish : finishes[0];

  const add = useMutation({
    mutationFn: async (body: AddCopiesBody): Promise<ActionResult> => {
      const res = await api.stacks.add.$post({ json: body });
      if (!res.ok) {
        throw await failure(res, "Couldn't add the card. Try again.");
      }
      return res.json();
    },
  });

  const ready = match !== undefined && finish !== undefined && locationId !== null;

  const submit = () => {
    if (!ready || add.isPending) {
      return;
    }
    const line = {
      quantity,
      name: match.card.name,
      publicCode: match.printing.publicCode,
      finish,
      condition,
      language,
      isProxy,
      location: location?.path ?? '',
    };
    const submitted = text;
    add.mutate(
      {
        printingId: match.printing.printingId,
        quantity,
        finish,
        condition,
        language,
        misprint: false,
        altered: false,
        isProxy,
        locationId,
      },
      {
        onSuccess: (result) => {
          onChanged();
          nextKey.current += 1;
          const key = nextKey.current;
          setAdded((lines) => [
            { ...line, key, batchId: result.batchId, phase: 'added' },
            ...lines,
          ]);
          // Ready for the next card: every field and the location stay as they are. If Jeff
          // already started typing the next card while this add was on its way, keep that.
          setText((now) => (now === submitted ? '' : now));
          searchRef.current?.focus();
        },
      },
    );
  };

  const undo = async (line: AddedLine) => {
    if (line.batchId === null || line.phase === 'undoing') {
      return;
    }
    const update = (patch: Partial<AddedLine>) =>
      setAdded((lines) => lines.map((l) => (l.key === line.key ? { ...l, ...patch } : l)));
    update({ phase: 'undoing', error: undefined });
    const result = await undoBatch(line.batchId);
    if (result.ok) {
      onChanged();
      setAdded((lines) => lines.filter((l) => l.key !== line.key));
    } else {
      update({ phase: 'failed', error: result.message });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
      return;
    }
    if (current.length === 0) {
      return;
    }
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      setSelected((index) => Math.max(0, Math.min(current.length - 1, index + step)));
    }
  };

  const total = added.reduce((sum, line) => sum + line.quantity, 0);
  const optionId = (i: number) => `${ids}-printing-${i}`;

  return (
    <div className="flex flex-col">
      <DialogHeader className="px-[22px] pt-[18px]">
        <DialogTitle className="font-normal font-serif text-[32px] leading-tight">
          Add cards
        </DialogTitle>
        <DialogDescription className="sr-only">
          Search for a card, pick its printing and press Enter to add it.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4 px-[22px] pt-3.5 pb-[18px]">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-[0_1_300px] flex-col gap-1.5">
            <label htmlFor={`${ids}-location`} className="font-semibold text-[13px]">
              Add to
            </label>
            <LocationPicker
              id={`${ids}-location`}
              value={locationId}
              onChange={setPickedLocation}
              placeholder="Pick where they go"
            />
          </div>
          <span className="pb-2.5 text-[13px] text-muted-foreground">
            {defaultLocationId !== undefined
              ? 'Starts on the location open behind this dialog.'
              : 'Starts on the "to sort" inbox.'}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex h-12 items-center gap-2.5 rounded-[10px] border-2 border-primary px-3.5 focus-within:ring-4 focus-within:ring-primary/15">
            <Search aria-hidden="true" className="size-[18px] shrink-0 text-primary" />
            <input
              ref={searchRef}
              type="search"
              role="combobox"
              aria-label="Card name or public code"
              aria-expanded={current.length > 0}
              aria-controls={`${ids}-printings`}
              aria-activedescendant={match ? optionId(current.indexOf(match)) : undefined}
              aria-autocomplete="list"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Card name or public code, such as OGN-030"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-muted-foreground"
            />
            <span className="whitespace-nowrap text-[12px] text-muted-foreground max-sm:hidden">
              <Key>←</Key> <Key>→</Key> to move, <Key>Enter</Key> to add
            </span>
          </div>
          {message && (
            <p role="status" className="px-1 text-[13px] text-muted-foreground">
              {message}
            </p>
          )}
        </div>

        {current.length > 0 && (
          <div
            id={`${ids}-printings`}
            role="listbox"
            aria-label="Printings"
            className="grid grid-cols-3 gap-3 sm:grid-cols-6"
          >
            {current.map((m, i) => {
              const on = m === match;
              const tags = [
                m.printing.alternateArt && 'Alt art',
                m.printing.overnumbered && 'Overnumbered',
                m.printing.signature && 'Signature',
              ].filter((tag): tag is string => tag !== false);
              return (
                <button
                  type="button"
                  key={m.printing.printingId}
                  id={optionId(i)}
                  role="option"
                  aria-selected={on}
                  aria-label={`${m.card.name}, ${m.printing.publicCode}`}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSelected(i);
                    searchRef.current?.focus();
                  }}
                  className={cn(
                    'flex min-w-0 cursor-pointer flex-col text-left gap-1.5 rounded-[10px] border-2 p-1.5 hover:border-[#8fa6dc]',
                    on ? 'border-primary bg-primary/10' : 'border-border bg-card',
                  )}
                >
                  <div className="aspect-[488/680] w-full overflow-hidden rounded-md bg-muted">
                    {m.printing.imageUrl && (
                      <img
                        src={m.printing.imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-contain"
                      />
                    )}
                  </div>
                  <span className="truncate font-semibold text-[13px]">{m.card.name}</span>
                  <span className="truncate text-[12px] text-muted-foreground tabular-nums">
                    {m.printing.setCode} · #{m.printing.collectorNumber}
                  </span>
                  <span className="truncate text-[12px] tabular-nums">{m.printing.publicCode}</span>
                  {tags.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4 [&_[data-slot=native-select-wrapper]]:w-44">
          <fieldset className="flex flex-col">
            <legend className="mb-1.5 font-semibold text-[13px]">Quantity</legend>
            <span className="flex h-10 items-center rounded-lg border border-input">
              <button
                type="button"
                aria-label="Fewer"
                disabled={quantity <= 1}
                onClick={() => setQuantity((n) => Math.max(1, n - 1))}
                className="flex size-10 items-center justify-center rounded-l-lg hover:bg-accent disabled:opacity-40"
              >
                <Minus aria-hidden="true" className="size-3.5" />
              </button>
              <output className="w-8 text-center font-semibold tabular-nums">{quantity}</output>
              <button
                type="button"
                aria-label="More"
                onClick={() => setQuantity((n) => n + 1)}
                className="flex size-10 items-center justify-center rounded-r-lg hover:bg-accent"
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </button>
            </span>
          </fieldset>

          <fieldset className="flex flex-col">
            <legend className="mb-1.5 font-semibold text-[13px]">Finish</legend>
            <span className="flex h-10 overflow-hidden rounded-lg border border-input">
              {(['normal', 'foil'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={finish === f}
                  disabled={match !== undefined && !finishes.includes(f)}
                  title={
                    match !== undefined && !finishes.includes(f)
                      ? `This printing doesn't come in ${FINISH_WORDS[f].toLowerCase()}.`
                      : undefined
                  }
                  onClick={() => setPickedFinish(f)}
                  className={cn(
                    'px-3.5 disabled:opacity-40',
                    finish === f || (match === undefined && pickedFinish === f)
                      ? 'bg-foreground font-semibold text-white'
                      : 'bg-card font-medium hover:bg-accent',
                  )}
                >
                  {FINISH_WORDS[f]}
                </button>
              ))}
            </span>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-condition`} className="font-semibold text-[13px]">
              Condition
            </label>
            <NativeSelect
              id={`${ids}-condition`}
              value={condition}
              onChange={(event) => setCondition(event.target.value)}
            >
              {CONDITIONS.map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-language`} className="font-semibold text-[13px]">
              Language
            </label>
            <NativeSelect
              id={`${ids}-language`}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {LANGUAGES.map(([code, label]) => (
                <NativeSelectOption key={code} value={code}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <label className="flex h-10 items-center gap-2 font-medium text-sm">
            <input
              type="checkbox"
              checked={isProxy}
              onChange={(event) => setIsProxy(event.target.checked)}
              className="size-4 accent-primary"
            />
            Proxy
          </label>

          <Button
            type="button"
            className="ml-auto"
            disabled={!ready || add.isPending}
            onClick={submit}
          >
            <Plus aria-hidden="true" />
            {add.isPending ? 'Adding…' : `Add ${quantity}`}
          </Button>
        </div>

        <p className="text-[13px] text-muted-foreground">
          After each add, the search clears and keeps focus, and every field keeps its value for the
          next card.
        </p>

        {add.isError && (
          <p role="alert" className="text-sm text-status-missing">
            {add.error.message}
          </p>
        )}

        <section aria-labelledby={`${ids}-added`} className="flex flex-col gap-2">
          <h3 id={`${ids}-added`} className="font-semibold text-sm">
            Added
          </h3>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {added.length === 0 && (
              <li className="px-3 py-2.5 text-muted-foreground text-sm">Nothing added yet.</li>
            )}
            {added.map((line, i) => (
              <li
                key={line.key}
                aria-label={`${line.quantity} ${line.name}`}
                className={cn('flex items-center gap-3 px-3 py-2', i === 0 && 'bg-[#f2f8f4]')}
              >
                <span className="w-8 shrink-0 font-semibold tabular-nums">{line.quantity}×</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 truncate font-medium">
                    {line.name}
                    {line.isProxy && <ProxyTag />}
                  </span>
                  <span className="truncate text-[12px] text-muted-foreground">
                    {line.publicCode} · {FINISH_WORDS[line.finish]} ·{' '}
                    {choiceLabel(CONDITIONS, line.condition)} ·{' '}
                    {choiceLabel(LANGUAGES, line.language)} → {line.location}
                  </span>
                  {line.error && (
                    <span role="alert" className="text-[12px] text-status-missing">
                      {line.error}
                    </span>
                  )}
                </span>
                {line.batchId !== null && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={line.phase === 'undoing'}
                    onClick={() => void undo(line)}
                  >
                    <Undo2 aria-hidden="true" />
                    {line.phase === 'undoing' ? 'Undoing…' : 'Undo'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <DialogFooter className="items-center border-border border-t px-[22px] py-3.5 sm:justify-between">
        <span className="text-muted-foreground text-sm" data-testid="added-summary">
          {total === 0 ? 'Nothing added yet.' : `${total} ${total === 1 ? 'card' : 'cards'} added.`}
        </span>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </div>
  );
}

function Key({ children }: { children: string }) {
  return <kbd className="rounded border border-input px-1 font-sans">{children}</kbd>;
}
