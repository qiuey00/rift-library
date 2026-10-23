import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Info, Minus, Plus, Search, Upload } from 'lucide-react';
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { CardSearchResult } from '../../shared/api/cards';
import type { CardSummary, ErrorBody } from '../../shared/api/common';
import type { DeckWarning } from '../../shared/api/deck-checks';
import type { DeckView } from '../../shared/api/decks';
import type {
  LineFixes,
  MoxfieldCreateRequest,
  MoxfieldLine,
  MoxfieldLineTag,
  MoxfieldPreview,
  MoxfieldPreviewRequest,
  ParsedSlot,
} from '../../shared/api/moxfield';
import type {
  DeckChanges,
  MoxfieldUpdateApplyRequest,
  MoxfieldUpdateApplyResult,
  MoxfieldUpdatePreview,
} from '../../shared/api/moxfield-update';
import { api } from '../api';
import { Panel } from '../components/Panel';
import { StatePill } from '../components/StatePill';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';

const TITLE = 'Import a Moxfield deck';
const UPDATE_TITLE = 'Update from Moxfield';

/**
 * Pastes a Moxfield decklist to make a deck (`/import/moxfield`) or to update one from a fresh
 * export (`/import/moxfield?deck=<id>`, opened by the deck view).
 */
export function MoxfieldImport() {
  const [params] = useSearchParams();
  const deck = params.get('deck');
  if (deck === null) return <DeckImport />;
  const deckId = Number(deck);
  return <DeckImport key={deckId} deckId={deckId} />;
}

/** Waits until `value` has stopped changing for `delay` ms. */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** The body of an API answer, or an error carrying the server's message for Jeff. */
async function answer<T>(response: { ok: boolean; json(): Promise<unknown> }): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as ErrorBody | null)?.error?.message;
    throw new Error(message ?? 'Something went wrong. Try again.');
  }
  return body as T;
}

/** The text's lines, numbered from 1 as the server numbers them. */
function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Jeff's choices for unmatched lines, kept by the line's text so they survive edits that move
 * lines up or down, and turned into line numbers for each request.
 */
type LineChoices = { fixes: Map<string, CardSummary>; skips: Set<string> };

function choicesFor(text: string, choices: LineChoices) {
  const fixes: LineFixes = {};
  const skips: number[] = [];
  splitLines(text).forEach((line, index) => {
    const key = line.trim();
    const fix = choices.fixes.get(key);
    if (fix) fixes[index + 1] = fix.oracleId;
    else if (choices.skips.has(key)) skips.push(index + 1);
  });
  return { fixes, skips };
}

/** The deck being updated, shared with the deck view's cache. */
function useDeck(deckId: number | undefined) {
  return useQuery({
    queryKey: ['decks', deckId],
    queryFn: async () =>
      answer<DeckView>(await api.decks[':id'].$get({ param: { id: String(deckId) } })),
    enabled: deckId !== undefined,
  });
}

/** A new import, or updating the deck `deckId`: the same paste and review either way. */
function DeckImport({ deckId }: { deckId?: number }) {
  const updating = deckId !== undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deck = useDeck(deckId);
  const [text, setText] = useState('');
  const settledText = useDebounced(text, 300);
  const [commanders, setCommanders] = useState<CardSummary[] | null>(null);
  const [choices, setChoices] = useState<LineChoices>({ fixes: new Map(), skips: new Set() });
  const [typedName, setTypedName] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);

  const hasText = settledText.trim() !== '';
  const lineChoices = useMemo(() => choicesFor(settledText, choices), [settledText, choices]);
  const previewRequest: MoxfieldPreviewRequest = {
    text: settledText,
    ...(commanders && { commanders: commanders.map((card) => card.oracleId) }),
    ...(Object.keys(lineChoices.fixes).length > 0 && { fixes: lineChoices.fixes }),
    ...(lineChoices.skips.length > 0 && { skips: lineChoices.skips }),
  };

  const preview = useQuery({
    queryKey: [
      'imports',
      'moxfield',
      updating ? 'update-preview' : 'preview',
      deckId,
      previewRequest,
    ],
    queryFn: async (): Promise<MoxfieldPreview | MoxfieldUpdatePreview> =>
      deckId === undefined
        ? answer<MoxfieldPreview>(
            await api.imports.moxfield.preview.$post({ json: previewRequest }),
          )
        : answer<MoxfieldUpdatePreview>(
            await api.imports.moxfield['update-preview'].$post({
              json: { deckId, ...previewRequest },
            }),
          ),
    enabled: hasText && (!updating || deck.isSuccess),
    placeholderData: keepPreviousData,
  });
  const shown = hasText ? preview.data : undefined;

  const slots = useMemo(
    () =>
      (shown?.slots ?? []).map((slot) => ({
        oracleId: slot.card.oracleId,
        board: slot.board,
        quantity: slot.quantity,
      })),
    [shown],
  );
  const checks = useQuery({
    queryKey: ['deck-checks', slots],
    queryFn: async () =>
      answer<{ warnings: DeckWarning[] }>(await api['deck-checks'].$post({ json: { slots } })),
    enabled: slots.length > 0,
    placeholderData: keepPreviousData,
  });

  const shownCommanders = shown?.commanders ?? [];
  const defaultName = shownCommanders.map((card) => card.name).join(' & ');
  const name = updating ? (deck.data?.deck.name ?? '') : (typedName ?? defaultName);
  const changes = updating ? (shown as MoxfieldUpdatePreview | undefined)?.changes : undefined;
  const open = (shown?.unmatched ?? []).filter(
    ({ lineNo }) => !(lineNo in lineChoices.fixes) && !lineChoices.skips.includes(lineNo),
  );

  const create = useMutation({
    mutationFn: async (request: MoxfieldCreateRequest) =>
      answer<{ deckId: number }>(await api.imports.moxfield.create.$post({ json: request })),
    onSuccess: ({ deckId }) => navigate(`/decks/${deckId}`),
  });
  const update = useMutation({
    mutationFn: async (request: MoxfieldUpdateApplyRequest) =>
      answer<MoxfieldUpdateApplyResult>(
        await api.imports.moxfield['update-apply'].$post({ json: request }),
      ),
    onSuccess: async ({ deckId, needsSwap }) => {
      await queryClient.invalidateQueries({ queryKey: ['decks'] });
      navigate(needsSwap ? `/decks/${deckId}/swap` : `/decks/${deckId}`);
    },
  });
  const saving = updating ? update : create;
  const blocker = !shown
    ? 'Paste a Moxfield export first.'
    : shownCommanders.length === 0
      ? 'Choose a commander first.'
      : name.trim() === ''
        ? 'Give the deck a name first.'
        : open.length > 0
          ? `Fix or skip ${open.length === 1 ? 'the unmatched name' : `the ${open.length} unmatched names`} first.`
          : preview.isFetching || text !== settledText
            ? 'Reading the list…'
            : null;

  function changeText(next: string) {
    setText(next);
    saving.reset();
  }

  function save() {
    const choices = {
      text: settledText,
      commanders: shownCommanders.map((card) => card.oracleId),
      fixes: lineChoices.fixes,
      skips: lineChoices.skips,
    };
    if (deckId === undefined) create.mutate({ ...choices, name: name.trim() });
    else update.mutate({ ...choices, deckId });
  }

  function setLineChoice(line: string, fix: CardSummary | 'skip' | null) {
    const key = line.trim();
    setChoices((current) => {
      const fixes = new Map(current.fixes);
      const skips = new Set(current.skips);
      fixes.delete(key);
      skips.delete(key);
      if (fix === 'skip') skips.add(key);
      else if (fix) fixes.set(key, fix);
      return { fixes, skips };
    });
  }

  function lineText(lineNo: number) {
    return splitLines(settledText)[lineNo - 1] ?? '';
  }

  function pick(card: CardSummary) {
    if (!picker) return;
    if (picker.kind === 'commander') setCommanders([card]);
    else if (picker.kind === 'partner') setCommanders([...shownCommanders.slice(0, 1), card]);
    else setLineChoice(lineText(picker.lineNo), card);
    setPicker(null);
  }

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-8 pt-6 pb-12">
      <div className="flex flex-col gap-2.5">
        <Link
          to={updating ? `/decks/${deckId}` : '/'}
          className="flex w-fit items-center gap-1 font-semibold text-[13px] text-primary hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {updating ? (deck.data?.deck.name ?? 'Deck') : 'Decks'}
        </Link>
        <h1 className="font-serif text-[44px] leading-[1.05]">{updating ? UPDATE_TITLE : TITLE}</h1>
        <p className="text-[15px] text-muted-foreground">
          {updating
            ? 'Paste a fresh export of this deck from Moxfield. It replaces the list; cards that stay keep the printing you picked.'
            : 'Paste an export from Moxfield, with or without sets.'}{' '}
          Lines after SIDEBOARD go to the maybe board.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <DecklistPanel
          text={text}
          onTextChange={changeText}
          preview={shown}
          reading={preview.isFetching}
          error={hasText ? preview.error : null}
        />

        <aside
          aria-label="Review"
          className="flex min-w-0 flex-[1_1_400px] flex-col gap-3.5 lg:max-w-[460px]"
        >
          {shown ? (
            <>
              <CommanderPanel
                commanders={shownCommanders}
                onChange={() => setPicker({ kind: 'commander' })}
                onAddPartner={() => setPicker({ kind: 'partner' })}
                onRemovePartner={() => setCommanders(shownCommanders.slice(0, 1))}
              />

              <Panel className="flex flex-col gap-3 px-4 py-3.5">
                {updating ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground text-xs uppercase tracking-[0.05em]">
                      Deck to update
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <h2 className="font-serif text-2xl leading-tight">{name}</h2>
                      {deck.data && <StatePill state={deck.data.deck.state} />}
                    </span>
                  </div>
                ) : (
                  <label
                    htmlFor="deck-name"
                    className="flex flex-col gap-1.5 font-semibold text-[13px]"
                  >
                    Deck name
                    <Input
                      id="deck-name"
                      value={name}
                      onChange={(event) => setTypedName(event.target.value)}
                      className="font-normal"
                    />
                  </label>
                )}
                <Counts preview={shown} />
              </Panel>

              {changes && <ChangesPanel changes={changes} />}

              {shown.lookupFailed && (
                <Panel
                  role="status"
                  className="flex items-start gap-2 border-status-other-decks-fill bg-status-other-decks-soft px-4 py-3 text-[13px] text-status-other-decks"
                >
                  <Info aria-hidden="true" className="mt-px size-4 shrink-0" />
                  Scryfall couldn't be reached, so names the app doesn't know yet weren't looked up.
                  Try again later, or fix them by hand below.
                </Panel>
              )}

              {(shown.unmatched.length > 0 || choices.fixes.size + choices.skips.size > 0) && (
                <UnmatchedPanel
                  preview={shown}
                  fixes={lineChoices.fixes}
                  skips={lineChoices.skips}
                  fixedCard={(lineNo) => choices.fixes.get(lineText(lineNo).trim())}
                  onFind={(lineNo, query) => setPicker({ kind: 'fix', lineNo, query })}
                  onSkip={(lineNo) => setLineChoice(lineText(lineNo), 'skip')}
                  onUndo={(lineNo) => setLineChoice(lineText(lineNo), null)}
                />
              )}

              <ChecksPanel
                warnings={checks.data?.warnings}
                failed={checks.isError}
                stillOk={
                  updating ? 'The deck can still be updated' : 'The deck can still be created'
                }
              />

              {saving.error && (
                <p role="alert" className="text-[13px] text-destructive">
                  {saving.error.message}
                </p>
              )}
              <Button
                size="lg"
                className="h-[46px] text-[15px]"
                disabled={blocker !== null || saving.isPending}
                onClick={save}
              >
                {updating
                  ? update.isPending
                    ? 'Updating…'
                    : 'Update deck'
                  : create.isPending
                    ? 'Creating…'
                    : 'Create deck'}
              </Button>
              {blocker && (
                <p className="text-center text-[13px] text-muted-foreground">{blocker}</p>
              )}
            </>
          ) : (
            <Panel className="px-4 py-3.5 text-muted-foreground">
              {deck.error ? (
                <span role="alert" className="text-destructive">
                  {deck.error.message}
                </span>
              ) : hasText && preview.isFetching ? (
                'Reading the list…'
              ) : (
                'Paste a list or drop a .txt file to see the deck here.'
              )}
            </Panel>
          )}
        </aside>
      </div>

      <CardPickerDialog picker={picker} onClose={() => setPicker(null)} onPick={pick} />
    </div>
  );
}

const TAGS: Partial<Record<MoxfieldLineTag, { label: string; className: string }>> = {
  commander: { label: 'Commander', className: 'bg-primary text-primary-foreground' },
  basic: { label: 'Basic', className: 'bg-status-basic-soft text-status-basic' },
  maybe: {
    label: 'Maybe board',
    className: 'bg-status-other-decks-soft text-status-other-decks',
  },
  unmatched: { label: 'Unmatched', className: 'bg-status-missing-soft text-status-missing' },
  skipped: { label: 'Skipped', className: 'bg-muted text-muted-foreground' },
};

function DecklistPanel({
  text,
  onTextChange,
  preview,
  reading,
  error,
}: {
  text: string;
  onTextChange: (text: string) => void;
  preview: MoxfieldPreview | undefined;
  reading: boolean;
  error: Error | null;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const lineCount = text === '' ? 0 : splitLines(text).length;

  async function readFile(file: File | undefined) {
    if (file) onTextChange(await file.text());
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void readFile(event.dataTransfer.files[0]);
  }

  return (
    <section
      aria-labelledby="decklist-title"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      className={cn(
        'min-w-0 flex-[1_1_560px] overflow-hidden rounded-xl border border-border bg-card',
        dragging && 'border-primary ring-[3px] ring-primary/30',
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5 border-border border-b bg-[#f6f7f9] px-3.5 py-2.5">
        <h2 id="decklist-title" className="font-semibold text-[15px]">
          Decklist
        </h2>
        {preview && (
          <span className="rounded-full bg-status-in-box-soft px-2.5 py-0.5 font-semibold text-status-in-box text-xs">
            {preview.format === 'sets' ? 'Moxfield, with sets' : 'Moxfield, plain'}
          </span>
        )}
        <span className="text-[13px] text-muted-foreground">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          {reading && ' · reading…'}
        </span>
        <span className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload aria-hidden="true" />
            Upload .txt
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".txt,text/plain"
            aria-label="Upload a .txt file"
            className="hidden"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              void readFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={text === ''}
            onClick={() => onTextChange('')}
          >
            Clear
          </Button>
        </span>
      </div>

      <label className="sr-only" htmlFor="moxfield-text">
        Moxfield export
      </label>
      <textarea
        id="moxfield-text"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={
          'Paste the export from Moxfield (More → Export → Copy), or drop the .txt file here.\n\n1 Sol Ring (EOC) 57\n1 Arcane Signet'
        }
        rows={text === '' ? 14 : 8}
        spellCheck={false}
        className="block w-full resize-y border-border border-b bg-card px-3.5 py-2.5 font-mono text-[13px] leading-[1.75] outline-none placeholder:text-muted-foreground focus-visible:bg-[#fbfcfd]"
      />

      {error && (
        <p role="alert" className="px-3.5 py-2.5 text-[13px] text-destructive">
          {error.message}
        </p>
      )}

      {preview && (
        <ol aria-label="Lines" className="py-2.5 font-mono text-[13px] leading-[1.75]">
          {preview.lines.map((line) => (
            <LineRow key={line.lineNo} line={line} />
          ))}
        </ol>
      )}
    </section>
  );
}

/** Updating a deck: the line's card isn't in the deck's current list. */
const NEW_TAG = { label: 'New', className: 'bg-status-in-box-soft text-status-in-box' };

function LineRow({ line }: { line: MoxfieldLine }) {
  const tags = [TAGS[line.tag], line.isNew ? NEW_TAG : undefined].filter(
    (tag) => tag !== undefined,
  );
  return (
    <li
      data-tag={line.tag}
      data-new={line.isNew || undefined}
      className={cn(
        'grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 pr-3.5',
        line.tag === 'commander' && 'bg-[#f3f6fe]',
        line.isNew && line.tag !== 'commander' && 'bg-status-in-box-soft/50',
        line.tag === 'unmatched' && 'bg-status-missing-soft/60',
      )}
    >
      <span aria-hidden="true" className="select-none text-right text-[#a0a6b1]">
        {line.lineNo}
      </span>
      <span
        className={cn(
          'overflow-hidden text-ellipsis whitespace-pre',
          (line.tag === 'commander' || line.tag === 'header') && 'font-bold',
          line.tag === 'basic' && 'text-status-basic',
          line.tag === 'maybe' && 'text-status-other-decks',
          line.tag === 'unmatched' && 'text-status-missing',
          line.tag === 'skipped' && 'text-muted-foreground line-through',
        )}
      >
        {line.text}
      </span>
      <span className="flex gap-1">
        {tags.map((tag) => (
          <span
            key={tag.label}
            className={cn(
              'rounded-full px-2 font-bold font-sans text-[11px] leading-[18px]',
              tag.className,
            )}
          >
            {tag.label}
          </span>
        ))}
      </span>
    </li>
  );
}

function ManaCost({ cost }: { cost: string }) {
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((match) =>
    match[1].toLowerCase().replace('/', ''),
  );
  if (symbols.length === 0) return null;
  return (
    <span className="flex gap-0.5 text-xs" role="img" aria-label={`Mana cost ${cost}`}>
      {symbols.map((symbol, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a cost can repeat a symbol
        <i key={index} aria-hidden="true" className={`ms ms-${symbol} ms-cost ms-shadow`} />
      ))}
    </span>
  );
}

function CardImage({ card, className }: { card: CardSummary; className: string }) {
  const src = card.imageNormal ?? card.imageSmall;
  return src ? (
    <img src={src} alt="" className={cn('rounded-[5%] bg-[#15161a] object-contain', className)} />
  ) : (
    <div aria-hidden="true" className={cn('rounded-[5%] bg-[#15161a]', className)} />
  );
}

function CommanderPanel({
  commanders,
  onChange,
  onAddPartner,
  onRemovePartner,
}: {
  commanders: CardSummary[];
  onChange: () => void;
  onAddPartner: () => void;
  onRemovePartner: () => void;
}) {
  const [first, partner] = commanders;
  return (
    <Panel aria-labelledby="commander-title" className="flex items-center gap-3.5 px-4 py-3.5">
      {first ? (
        <CardImage card={first} className="h-[138px] w-[99px] shrink-0" />
      ) : (
        <div className="h-[138px] w-[99px] shrink-0 rounded-[5%] border border-border border-dashed" />
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2
          id="commander-title"
          className="text-muted-foreground text-xs uppercase tracking-[0.05em]"
        >
          {commanders.length > 1 ? 'Commanders' : 'Commander'}
        </h2>
        {first ? (
          <ul className="flex flex-col gap-1" aria-label="Commanders">
            {commanders.map((card) => (
              <li key={card.oracleId} className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-base">{card.name}</span>
                <ManaCost cost={card.manaCost} />
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[13px] text-muted-foreground">
            No commander found in the list. Choose one.
          </span>
        )}
        <span className="mt-0.5 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onChange}>
            {first ? 'Change' : 'Choose commander'}
          </Button>
          {first && !partner && (
            <Button variant="outline" size="sm" onClick={onAddPartner}>
              Add partner
            </Button>
          )}
          {partner && (
            <Button variant="outline" size="sm" onClick={onRemovePartner}>
              Remove partner
            </Button>
          )}
        </span>
      </div>
    </Panel>
  );
}

function Counts({ preview }: { preview: MoxfieldPreview }) {
  const basics = preview.slots
    .filter((slot) => slot.card.isBasicLand && slot.board === 'main')
    .sort((a, b) => b.quantity - a.quantity)
    .map((slot) => `${slot.quantity} ${slot.card.name}`)
    .join(', ');
  const rows: [string, number, string][] = [
    ['Commander', preview.commanders.length, ''],
    ['Main board', preview.counts.main, ''],
    ['Basic lands', preview.counts.basics, basics ? `in the main board · ${basics}` : ''],
    ['Maybe board', preview.counts.maybe, preview.counts.maybe > 0 ? 'from SIDEBOARD' : ''],
  ];
  return (
    <dl aria-label="Counts" className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5">
      {rows.map(([label, count, note]) => (
        <div key={label} className="contents">
          <dt className="text-right font-bold tabular-nums">{count}</dt>
          <dd>
            {label}
            {note && <span className="text-[13px] text-muted-foreground"> · {note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function UnmatchedPanel({
  preview,
  fixes,
  skips,
  fixedCard,
  onFind,
  onSkip,
  onUndo,
}: {
  preview: MoxfieldPreview;
  fixes: LineFixes;
  skips: number[];
  fixedCard: (lineNo: number) => CardSummary | undefined;
  onFind: (lineNo: number, query: string) => void;
  onSkip: (lineNo: number) => void;
  onUndo: (lineNo: number) => void;
}) {
  const rows = new Map(
    preview.unmatched.map((row) => [row.lineNo, { name: row.name, quantity: row.quantity }]),
  );
  // Lines Jeff fixed or skipped may no longer be unmatched; keep them listed so he can undo.
  for (const lineNo of [...Object.keys(fixes).map(Number), ...skips]) {
    if (rows.has(lineNo)) continue;
    const line = preview.lines.find((l) => l.lineNo === lineNo);
    if (line) rows.set(lineNo, { name: line.text, quantity: 0 });
  }
  const sorted = [...rows].sort(([a], [b]) => a - b);
  if (sorted.length === 0) return null;

  return (
    <Panel aria-labelledby="unmatched-title" className="flex flex-col gap-2.5 px-4 py-3.5">
      <h2 id="unmatched-title" className="font-semibold text-[15px]">
        Unmatched names
      </h2>
      <ul className="flex flex-col gap-2">
        {sorted.map(([lineNo, row]) => {
          const fixed = lineNo in fixes ? fixedCard(lineNo) : undefined;
          const skipped = skips.includes(lineNo);
          return (
            <li
              key={lineNo}
              aria-label={`Line ${lineNo}: ${row.name}`}
              className="flex flex-wrap items-center gap-2 text-[13px]"
            >
              <span className="w-10 shrink-0 text-muted-foreground tabular-nums">#{lineNo}</span>
              <span className="min-w-0 flex-1">
                <span className={cn('font-semibold', !fixed && !skipped && 'text-status-missing')}>
                  {row.quantity > 0 && `${row.quantity} `}
                  {row.name}
                </span>
                {fixed && <span className="text-status-in-box"> → {fixed.name}</span>}
                {skipped && <span className="text-muted-foreground"> · skipped</span>}
              </span>
              {fixed || skipped ? (
                <Button variant="outline" size="sm" onClick={() => onUndo(lineNo)}>
                  Undo
                </Button>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => onFind(lineNo, row.name)}>
                    <Search aria-hidden="true" />
                    Find card
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onSkip(lineNo)}>
                    Skip
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ChecksPanel({
  warnings,
  failed,
  stillOk,
}: {
  warnings: DeckWarning[] | undefined;
  failed: boolean;
  /** Such as "The deck can still be created". */
  stillOk: string;
}) {
  return (
    <Panel aria-labelledby="checks-title" className="flex flex-col gap-2.5 px-4 py-3.5">
      <h2 id="checks-title" className="font-semibold text-[15px]">
        Checks
      </h2>
      {failed ? (
        <p className="text-[13px] text-muted-foreground">The checks couldn't run just now.</p>
      ) : !warnings ? (
        <p className="text-[13px] text-muted-foreground">Checking…</p>
      ) : warnings.length === 0 ? (
        <p className="text-[13px] text-status-in-box">The list follows the Commander rules.</p>
      ) : (
        <>
          <ul aria-label="Warnings" className="flex flex-col gap-2">
            {warnings.map((warning) => (
              <li
                key={`${warning.kind}:${warning.message}`}
                className="flex items-start gap-2 rounded-lg bg-status-other-decks-soft px-2.5 py-2 text-[13px] text-status-other-decks"
              >
                <AlertTriangle aria-hidden="true" className="mt-px size-4 shrink-0" />
                {warning.message}
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted-foreground">{stillOk}; checks only warn.</p>
        </>
      )}
    </Panel>
  );
}

/** One card line of the change list, such as "1 Chaos Warp". */
function slotLabel(slot: ParsedSlot) {
  return `${slot.quantity} ${slot.card.name}${slot.board === 'maybe' ? ' (maybe board)' : ''}`;
}

/** Updating a deck: what the new text adds, removes and changes, from the server's preview. */
function ChangesPanel({ changes }: { changes: DeckChanges }) {
  const none = changes.added.length + changes.removed.length + changes.changed.length === 0;
  return (
    <Panel aria-labelledby="changes-title" className="flex flex-col gap-3 px-4 py-3.5">
      <h2 id="changes-title" className="font-semibold text-[15px]">
        What changes
      </h2>
      {none ? (
        <p className="text-[13px] text-muted-foreground">
          The list is the same as the deck's. Nothing changes.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-3">
          <ChangeList
            label={`${changes.removed.length} out`}
            icon={<Minus aria-hidden="true" className="size-3.5" strokeWidth={2.6} />}
            className="text-status-missing"
            lines={changes.removed.map(slotLabel)}
          />
          <ChangeList
            label={`${changes.added.length} in`}
            icon={<Plus aria-hidden="true" className="size-3.5" strokeWidth={2.6} />}
            className="text-status-in-box"
            lines={changes.added.map(slotLabel)}
          />
          {changes.changed.length > 0 && (
            <div className="col-span-2">
              <ChangeList
                label={`${changes.changed.length} changed ${changes.changed.length === 1 ? 'quantity' : 'quantities'}`}
                className="text-foreground"
                lines={changes.changed.map(
                  (change) =>
                    `${change.card.name}${change.board === 'maybe' ? ' (maybe board)' : ''}: ${change.from} → ${change.to}`,
                )}
              />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function ChangeList({
  label,
  icon,
  className,
  lines,
}: {
  label: string;
  icon?: ReactNode;
  className: string;
  lines: string[];
}) {
  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-1.5">
      <h3 className={cn('flex items-center gap-1.5 font-bold text-sm', className)}>
        {icon}
        {label}
      </h3>
      <ul className="flex flex-col gap-1 text-[13px]">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

type Picker =
  | { kind: 'commander' }
  | { kind: 'partner' }
  | { kind: 'fix'; lineNo: number; query: string };

function CardPickerDialog({
  picker,
  onClose,
  onPick,
}: {
  picker: Picker | null;
  onClose: () => void;
  onPick: (card: CardSummary) => void;
}) {
  const title =
    picker?.kind === 'commander'
      ? 'Choose the commander'
      : picker?.kind === 'partner'
        ? 'Add a partner'
        : `Find the card for line ${picker?.lineNo ?? ''}`;
  return (
    <Dialog open={picker !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-popover sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {picker?.kind === 'fix'
              ? 'Search for the card this line means.'
              : 'Search cards that can be commanders.'}
          </DialogDescription>
        </DialogHeader>
        {picker && (
          <CardSearch
            commanderOnly={picker.kind !== 'fix'}
            initialQuery={picker.kind === 'fix' ? picker.query : ''}
            onPick={onPick}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardSearch({
  commanderOnly,
  initialQuery,
  onPick,
}: {
  commanderOnly: boolean;
  initialQuery: string;
  onPick: (card: CardSummary) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const q = useDebounced(query.trim(), 250);
  const search = useQuery({
    queryKey: ['cards', 'search', q, commanderOnly],
    queryFn: async () =>
      answer<{ results: CardSearchResult[] }>(
        await api.cards.search.$get({
          query: commanderOnly ? { q, commander: '1' } : { q },
        }),
      ),
    enabled: q !== '',
  });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex h-10 items-center gap-2 rounded-lg border border-input bg-card px-3 focus-within:border-ring">
        <Search aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="sr-only">Card name</span>
        <input
          type="search"
          // biome-ignore lint/a11y/noAutofocus: the dialog opens to type a name
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Card name"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </label>
      {search.error ? (
        <p className="text-[13px] text-destructive">{search.error.message}</p>
      ) : search.data && search.data.results.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No cards match “{q}”.</p>
      ) : (
        <ul aria-label="Results" className="flex max-h-[360px] flex-col gap-1 overflow-y-auto">
          {(search.data?.results ?? []).map((card) => (
            <li key={card.oracleId}>
              <button
                type="button"
                onClick={() => onPick(card)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <CardImage card={card} className="h-[42px] w-[30px] shrink-0" />
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2 font-semibold">
                    {card.name}
                    <ManaCost cost={card.manaCost} />
                  </span>
                  <span className="text-muted-foreground text-xs">{card.typeLine}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
