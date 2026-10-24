import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Info, Minus, Plus, Search, Upload } from 'lucide-react';
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { CardSearchResult } from '../../shared/api/cards';
import { type Board, type CardSummary, ErrorBody, type Id } from '../../shared/api/common';
import type { DeckCheck } from '../../shared/api/deck-checks';
import type {
  DeckChanges,
  DeckListLine,
  DeckListPreview,
  DeckListPreviewRequest,
  LineFix,
  ListedSlot,
} from '../../shared/api/deck-lists';
import type { DeckSummary, DeckView } from '../../shared/api/decks';
import { api } from '../api';
import { CardSearchPicker } from '../components/CardSearchPicker';
import { DomainIcons } from '../components/DomainIcon';
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
import { BOARD_WORDS, typeLine } from '../lib/card-text';
import { cn } from '../lib/utils';

/**
 * Pastes a deck list to make a deck (`/decks/import`, DECK-14, DECK-15) or to update one
 * (`/decks/:id/deck-list`, CHG-1, CHG-2): the list tagged by board on the left, the review on
 * the right.
 */
export function DeckListImport() {
  const { id } = useParams();
  if (id === undefined) return <DeckListPage />;
  const deckId = Number(id);
  return <DeckListPage key={deckId} deckId={deckId} />;
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
async function answer<T>(
  response: { ok: boolean; json(): Promise<unknown> },
  fallback: string,
): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    throw new Error(parsed.success ? parsed.data.error.message : fallback);
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
  const fixes: LineFix[] = [];
  const skips: number[] = [];
  splitLines(text).forEach((line, index) => {
    const key = line.trim();
    const fix = choices.fixes.get(key);
    if (fix) fixes.push({ lineNumber: index + 1, cardId: fix.id });
    else if (choices.skips.has(key)) skips.push(index + 1);
  });
  return { fixes, skips };
}

/** What the Legend or Chosen Champion picker is choosing, or the unmatched line it fixes. */
type Picker =
  | { kind: 'legend' }
  | { kind: 'champion'; championTag: string | null }
  | { kind: 'fix'; lineNumber: number; name: string };

/** A new deck, or updating the deck `deckId`: the same paste and review either way. */
function DeckListPage({ deckId }: { deckId?: Id }) {
  const updating = deckId !== undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const nameId = useId();
  const [text, setText] = useState('');
  const settledText = useDebounced(text, 300);
  const [choices, setChoices] = useState<LineChoices>({ fixes: new Map(), skips: new Set() });
  const [legend, setLegend] = useState<CardSummary | null>(null);
  const [champion, setChampion] = useState<CardSummary | null>(null);
  const [typedName, setTypedName] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);

  const deck = useQuery({
    queryKey: ['decks', deckId],
    queryFn: async () =>
      answer<DeckView>(
        await api.decks[':id'].$get({ param: { id: String(deckId) } }),
        "Couldn't load this deck.",
      ),
    enabled: updating,
  });

  const hasText = settledText.trim() !== '';
  const lineChoices = useMemo(() => choicesFor(settledText, choices), [settledText, choices]);
  const request: DeckListPreviewRequest = {
    text: settledText,
    ...(lineChoices.fixes.length > 0 && { fixes: lineChoices.fixes }),
    ...(lineChoices.skips.length > 0 && { skips: lineChoices.skips }),
    ...(deckId !== undefined && { deckId }),
  };

  const preview = useQuery({
    queryKey: ['deck-lists', 'preview', request],
    queryFn: async () =>
      answer<DeckListPreview>(
        await api['deck-lists'].preview.$post({ json: request }),
        "Couldn't read the deck list.",
      ),
    enabled: hasText && (!updating || deck.isSuccess),
    placeholderData: keepPreviousData,
  });
  const shown = hasText ? preview.data : undefined;

  const shownLegend = legend ?? shown?.legend ?? null;
  const shownChampion = champion ?? shown?.champion ?? null;
  const name = updating ? (deck.data?.deck.name ?? '') : (typedName ?? shownLegend?.name ?? '');
  const open = (shown?.unmatched ?? []).filter(
    ({ lineNumber }) =>
      !lineChoices.fixes.some((fix) => fix.lineNumber === lineNumber) &&
      !lineChoices.skips.includes(lineNumber),
  );

  const create = useMutation({
    mutationFn: async (previewId: string) =>
      answer<DeckSummary>(
        await api['deck-lists'][':previewId'].create.$post({
          param: { previewId },
          json: {
            name: name.trim(),
            legendId: shownLegend?.id ?? 0,
            championId: shownChampion?.id ?? null,
          },
        }),
        "Couldn't create the deck.",
      ),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['decks'] });
      navigate(`/decks/${created.id}`);
    },
  });
  const update = useMutation({
    mutationFn: async () =>
      answer<{ deck: DeckSummary; needsSwap: boolean }>(
        await api.decks[':id']['deck-list'].$post({
          param: { id: String(deckId) },
          json: {
            text: settledText,
            ...(lineChoices.fixes.length > 0 && { fixes: lineChoices.fixes }),
            ...(lineChoices.skips.length > 0 && { skips: lineChoices.skips }),
          },
        }),
        "Couldn't update the deck.",
      ),
    onSuccess: async ({ deck: updated, needsSwap }) => {
      await queryClient.invalidateQueries({ queryKey: ['decks'] });
      navigate(needsSwap ? `/decks/${updated.id}/swap` : `/decks/${updated.id}`);
    },
  });
  const saving = updating ? update : create;

  const blocker = !shown
    ? 'Paste a deck list first.'
    : !updating && !shownLegend
      ? 'Choose the Legend first.'
      : name.trim() === ''
        ? 'Give the deck a name first.'
        : open.length > 0
          ? `Fix or skip ${open.length === 1 ? 'the name that didn’t match' : `the ${open.length} names that didn’t match`} first.`
          : preview.isFetching || text !== settledText
            ? 'Reading the list…'
            : null;

  const swapsAfter =
    updating && deck.data !== undefined && deck.data.deck.state !== 'not_assembled';

  function changeText(next: string) {
    setText(next);
    saving.reset();
  }

  function save() {
    if (!shown) return;
    if (updating) update.mutate();
    else create.mutate(shown.previewId);
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

  const lineText = (lineNumber: number) => splitLines(settledText)[lineNumber - 1] ?? '';

  function pick(card: CardSearchResult) {
    if (!picker) return;
    if (picker.kind === 'legend') setLegend(card);
    else if (picker.kind === 'champion') setChampion(card);
    else setLineChoice(lineText(picker.lineNumber), card);
    setPicker(null);
  }

  const deckName = deck.data?.deck.name;
  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-6 pt-6 pb-12">
      <div className="flex flex-col gap-2.5">
        <Link
          to={updating ? `/decks/${deckId}` : '/'}
          className="flex w-fit items-center gap-1 font-semibold text-[13px] text-primary hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {updating ? (deckName ?? 'Deck') : 'Decks'}
        </Link>
        <h1 className="font-serif text-[44px] leading-[1.05]">
          {updating ? `Update ${deckName ?? 'the deck'} from a deck list` : 'Paste a deck list'}
        </h1>
        <p className="text-[15px] text-muted-foreground">
          {updating
            ? 'Paste the new list. The review shows what changes before anything moves.'
            : 'Paste or upload a list. Each line is tagged with the board it goes on.'}
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <DeckListPanel
          text={text}
          onTextChange={changeText}
          lines={shown?.lines}
          reading={preview.isFetching}
          error={hasText ? preview.error : null}
        />

        <aside
          aria-label="Review"
          className="flex min-w-0 flex-[1_1_400px] flex-col gap-3.5 lg:max-w-[480px]"
        >
          {shown ? (
            <>
              <LeadersPanel
                legend={shownLegend}
                champion={shownChampion}
                onChange={
                  updating
                    ? undefined
                    : (kind) =>
                        setPicker(
                          kind === 'legend'
                            ? { kind }
                            : { kind, championTag: shownLegend?.championTag ?? null },
                        )
                }
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
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={nameId} className="font-semibold text-[13px]">
                      Deck name
                    </label>
                    <Input
                      id={nameId}
                      value={name}
                      onChange={(event) => setTypedName(event.target.value)}
                      placeholder="Named after the Legend"
                    />
                  </div>
                )}
                <BoardCounts preview={shown} />
              </Panel>

              {shown.changes && (
                <ChangesPanel
                  deckName={name}
                  changes={shown.changes}
                  swapsAfter={swapsAfter}
                  deckState={deck.data?.deck.state}
                />
              )}

              {shown.lookupFailed && (
                <Panel
                  role="status"
                  className="flex items-start gap-2 border-status-other-decks-fill bg-status-other-decks-soft px-4 py-3 text-[13px] text-status-other-decks"
                >
                  <Info aria-hidden="true" className="mt-px size-4 shrink-0" />
                  Riftcodex couldn't be reached, so names the app doesn't know yet weren't looked
                  up. Try again later, or fix them by hand below.
                </Panel>
              )}

              <UnmatchedPanel
                preview={shown}
                choices={choices}
                lineText={lineText}
                lineChoices={lineChoices}
                onFind={(lineNumber, name) => setPicker({ kind: 'fix', lineNumber, name })}
                onSkip={(lineNumber) => setLineChoice(lineText(lineNumber), 'skip')}
                onUndo={(lineNumber) => setLineChoice(lineText(lineNumber), null)}
              />

              <ChecksPanel checks={shown.checks} />

              {saving.error && (
                <p role="alert" className="text-[13px] text-destructive">
                  {saving.error.message}
                </p>
              )}
              <div className="flex gap-2.5">
                <Button asChild variant="outline" className="h-[46px]">
                  <Link to={updating ? `/decks/${deckId}` : '/'}>Cancel</Link>
                </Button>
                <Button
                  className="h-[46px] flex-1 text-[15px]"
                  disabled={blocker !== null || saving.isPending}
                  onClick={save}
                >
                  {updating
                    ? update.isPending
                      ? 'Updating…'
                      : swapsAfter
                        ? 'Update deck and open swap list'
                        : 'Update deck'
                    : create.isPending
                      ? 'Creating…'
                      : 'Create deck'}
                </Button>
              </div>
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

      <PickerDialog picker={picker} onClose={() => setPicker(null)} onPick={pick} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// The pasted list

/** Each board's tag on a line, as the design canvas colors them. */
const BOARD_TAGS: Record<Board, { label: string; className: string }> = {
  legend: { label: 'Legend', className: 'bg-[#efe7fa] text-[#55339a]' },
  champion: { label: 'Champion', className: 'bg-[#fbe6e3] text-[#962a23]' },
  main: { label: 'Main', className: 'bg-[#e7eefc] text-[#1f4aa8]' },
  battlefield: { label: 'Battlefield', className: 'bg-[#eceef2] text-[#3b4252]' },
  rune: { label: 'Rune', className: 'bg-[#eceef2] text-[#3b4252]' },
  sideboard: { label: 'Sideboard', className: 'bg-[#e3f3e9] text-[#146c3a]' },
  maybe: { label: 'Maybe', className: 'bg-[#f1f2f4] text-[#4a5161]' },
};

function lineTags(line: DeckListLine): { label: string; className: string }[] {
  const tags: { label: string; className: string }[] = [];
  if (line.kind === 'unmatched')
    tags.push({ label: 'Unknown', className: 'bg-white text-status-missing' });
  else if (line.kind === 'skipped')
    tags.push({ label: 'Skipped', className: 'bg-[#f1f2f4] text-[#4a5161]' });
  else if (line.kind === 'card' && line.board) tags.push(BOARD_TAGS[line.board]);
  if (line.isNew && line.kind === 'card')
    tags.push({ label: 'New', className: 'bg-status-in-box-soft text-status-in-box' });
  return tags;
}

function DeckListPanel({
  text,
  onTextChange,
  lines,
  reading,
  error,
}: {
  text: string;
  onTextChange: (text: string) => void;
  lines: DeckListLine[] | undefined;
  reading: boolean;
  error: Error | null;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const textId = useId();
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
      aria-labelledby="deck-list-title"
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
        <h2 id="deck-list-title" className="font-semibold text-[15px]">
          Deck list
        </h2>
        <span className="text-[13px] text-muted-foreground">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          {reading && ' · reading…'}
        </span>
        <span className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload aria-hidden="true" />
            Upload a file
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

      <label className="sr-only" htmlFor={textId}>
        Deck list text
      </label>
      <textarea
        id={textId}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={
          'Paste a deck list, or drop the .txt file here.\n\nLegend:\n1 Jinx, Loose Cannon\n\nMain:\n3 Fierce Blast OGN-135'
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

      {lines && (
        <ol aria-label="Lines" className="py-2.5 font-mono text-[13px] leading-[1.75]">
          {lines.map((line) => (
            <LineRow key={line.lineNumber} line={line} />
          ))}
        </ol>
      )}
      <p className="border-border border-t px-3.5 py-2.5 text-[13px] text-muted-foreground">
        Lines are read as a count and a card name under board headings. Repeated names on one board
        merge into one slot.
      </p>
    </section>
  );
}

function LineRow({ line }: { line: DeckListLine }) {
  const tags = lineTags(line);
  return (
    <li
      data-kind={line.kind}
      data-board={line.board ?? undefined}
      data-new={line.isNew || undefined}
      className={cn(
        'grid min-h-[22px] grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 pr-3.5',
        line.kind === 'unmatched' && 'bg-[#fde8e7]',
        line.isNew && line.kind === 'card' && 'bg-status-in-box-soft/50',
      )}
    >
      <span aria-hidden="true" className="select-none text-right text-[#a0a6b1]">
        {line.lineNumber}
      </span>
      <span
        className={cn(
          'overflow-hidden text-ellipsis whitespace-pre',
          line.kind === 'heading' && 'font-semibold text-[#5d6474]',
          line.kind === 'unmatched' && 'font-semibold text-status-missing',
          line.kind === 'skipped' && 'text-muted-foreground line-through',
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

// ---------------------------------------------------------------------------------------
// The review

function CardImage({ card, className }: { card: CardSummary; className: string }) {
  return card.imageUrl ? (
    <img
      src={card.imageUrl}
      alt=""
      className={cn('rounded-[5%] bg-[#15161a] object-contain', className)}
    />
  ) : (
    <div aria-hidden="true" className={cn('rounded-[5%] bg-[#15161a]', className)} />
  );
}

function LeadersPanel({
  legend,
  champion,
  onChange,
}: {
  legend: CardSummary | null;
  champion: CardSummary | null;
  /** Left out when updating a deck: its Legend and Chosen Champion come from the list. */
  onChange?: (kind: 'legend' | 'champion') => void;
}) {
  const leaders = [
    { kind: 'legend' as const, label: 'Legend', card: legend },
    { kind: 'champion' as const, label: 'Chosen Champion', card: champion },
  ];
  return (
    <Panel aria-labelledby="leaders-title" className="flex flex-col gap-3 px-4 py-3.5">
      <h2 id="leaders-title" className="font-semibold text-[15px]">
        Proposed Legend and Chosen Champion
      </h2>
      <ul className="flex flex-col gap-3">
        {leaders.map(({ kind, label, card }) => (
          <li key={kind} aria-label={label} className="flex items-center gap-3.5">
            {card ? (
              <CardImage card={card} className="h-[98px] w-[70px] shrink-0" />
            ) : (
              <div className="h-[98px] w-[70px] shrink-0 rounded-[5%] border border-border border-dashed" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-muted-foreground text-xs uppercase tracking-[0.05em]">
                {label}
              </span>
              {card ? (
                <>
                  <span className="flex flex-wrap items-center gap-2 font-bold text-base">
                    {card.name}
                    <DomainIcons domains={card.domains} className="text-xs" />
                  </span>
                  <span className="text-[13px] text-muted-foreground">{typeLine(card)}</span>
                </>
              ) : (
                <span className="text-[13px] text-muted-foreground">
                  {kind === 'legend'
                    ? 'No Legend found in the list. Choose one.'
                    : 'No Chosen Champion found in the list.'}
                </span>
              )}
            </div>
            {onChange && (
              <Button
                variant="outline"
                size="sm"
                aria-label={`${card ? 'Change' : 'Choose'} the ${label}`}
                onClick={() => onChange(kind)}
              >
                {card ? 'Change' : 'Choose'}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const COUNTED: { board: Board; label: string }[] = [
  { board: 'legend', label: 'Legend' },
  { board: 'champion', label: 'Chosen Champion' },
  { board: 'main', label: 'Main deck' },
  { board: 'battlefield', label: 'Battlefields' },
  { board: 'rune', label: 'Runes' },
  { board: 'sideboard', label: 'Sideboard' },
  { board: 'maybe', label: 'Maybe board' },
];

function BoardCounts({ preview }: { preview: DeckListPreview }) {
  const { boards } = preview;
  const runes = preview.slots
    .filter((slot) => slot.board === 'rune')
    .map((slot) => `${slot.quantity} ${slot.card.name.replace(/ Rune$/, '')}`)
    .join(' · ');
  const notes: Partial<Record<Board, string>> = {
    legend: preview.legend?.championTag ?? '',
    champion: 'Counts toward the main deck',
    main: `${boards.main + boards.champion} with the Chosen Champion`,
    rune: runes,
    sideboard: 'Pulled with the deck',
    maybe: 'Not counted',
  };
  return (
    <section aria-labelledby="counts-title" className="flex flex-col gap-1.5">
      <h3 id="counts-title" className="text-muted-foreground text-xs uppercase tracking-[0.05em]">
        Cards per board
      </h3>
      <dl aria-label="Cards per board" className="grid grid-cols-[auto_auto_1fr] gap-x-3.5 gap-y-1">
        {COUNTED.map(({ board, label }) => (
          <div key={board} className="contents">
            <dt>{label}</dt>
            <dd className="text-right font-bold tabular-nums">{boards[board]}</dd>
            <dd className="text-[13px] text-muted-foreground">{notes[board]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function UnmatchedPanel({
  preview,
  choices,
  lineChoices,
  lineText,
  onFind,
  onSkip,
  onUndo,
}: {
  preview: DeckListPreview;
  choices: LineChoices;
  lineChoices: { fixes: LineFix[]; skips: number[] };
  lineText: (lineNumber: number) => string;
  onFind: (lineNumber: number, name: string) => void;
  onSkip: (lineNumber: number) => void;
  onUndo: (lineNumber: number) => void;
}) {
  const rows = new Map(
    preview.unmatched.map((row) => [
      row.lineNumber,
      { text: lineText(row.lineNumber).trim() || row.name, name: row.name, board: row.board },
    ]),
  );
  // Lines Jeff fixed or skipped are no longer unmatched; keep them listed so he can undo.
  const chosen = [...lineChoices.fixes.map((fix) => fix.lineNumber), ...lineChoices.skips];
  for (const lineNumber of chosen) {
    if (rows.has(lineNumber)) continue;
    const line = preview.lines.find((l) => l.lineNumber === lineNumber);
    if (line?.board) rows.set(lineNumber, { text: line.text, name: line.text, board: line.board });
  }
  const sorted = [...rows].sort(([a], [b]) => a - b);
  if (sorted.length === 0) return null;
  const open = sorted.filter(([lineNumber]) => !chosen.includes(lineNumber)).length;

  return (
    <Panel aria-labelledby="unmatched-title" className="flex flex-col gap-2.5 px-4 py-3.5">
      <h2 id="unmatched-title" className="font-semibold text-[15px]">
        {open === 0
          ? 'Every name matches a card'
          : open === 1
            ? '1 name didn’t match a card'
            : `${open} names didn’t match a card`}
      </h2>
      <ul className="flex flex-col gap-2.5">
        {sorted.map(([lineNumber, row]) => {
          const fixed = choices.fixes.get(lineText(lineNumber).trim());
          const skipped = lineChoices.skips.includes(lineNumber);
          return (
            <li
              key={lineNumber}
              aria-label={`Line ${lineNumber}: ${row.text}`}
              className="flex flex-wrap items-center gap-2 text-[13px]"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn('font-semibold', !fixed && !skipped && 'text-status-missing')}>
                  {row.text}
                  {fixed && <span className="text-status-in-box"> → {fixed.name}</span>}
                  {skipped && <span className="font-normal text-muted-foreground"> · skipped</span>}
                </span>
                <span className="text-muted-foreground text-xs">
                  {BOARD_WORDS[row.board]}, line {lineNumber}
                </span>
              </span>
              {fixed || skipped ? (
                <Button variant="outline" size="sm" onClick={() => onUndo(lineNumber)}>
                  Undo
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Find the card for ${row.text}`}
                    onClick={() => onFind(lineNumber, row.name)}
                  >
                    <Search aria-hidden="true" />
                    Find the card
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Skip ${row.text}`}
                    onClick={() => onSkip(lineNumber)}
                  >
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

function ChecksPanel({ checks }: { checks: DeckCheck[] }) {
  const warnings = checks.filter((check) => check.result === 'warn');
  return (
    <Panel aria-labelledby="checks-title" className="flex flex-col gap-2.5 px-4 py-3.5">
      <h2 id="checks-title" className="font-semibold text-[15px]">
        Deck checks
      </h2>
      {warnings.length > 0 && (
        <ul aria-label="Warnings" className="flex flex-col gap-2">
          {warnings.map((check) => (
            <li
              key={check.code}
              className="flex items-start gap-2 rounded-lg bg-status-other-decks-soft px-2.5 py-2 text-[13px] text-status-other-decks"
            >
              <AlertTriangle aria-hidden="true" className="mt-px size-4 shrink-0" />
              {check.message}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[13px] text-muted-foreground">
        {warnings.length === 0
          ? 'Every check passes.'
          : 'Warnings never block. The other checks pass.'}
      </p>
    </Panel>
  );
}

/** Each board as the change list names it, such as "the main deck". */
const BOARD_PLACES: Record<Board, string> = {
  legend: 'the Legend',
  champion: 'the Chosen Champion',
  main: 'the main deck',
  battlefield: 'the battlefields',
  rune: 'the rune deck',
  sideboard: 'the sideboard',
  maybe: 'the maybe board',
};

/** One slot of the change list, such as "+2 Storm Sage, into the main deck". */
function slotLabel(slot: ListedSlot, sign: '+' | '−') {
  const where = `${sign === '+' ? 'into' : 'out of'} ${BOARD_PLACES[slot.board]}`;
  return `${sign}${slot.quantity} ${slot.card.name}, ${where}`;
}

/** Updating a deck: what the new list adds, removes and changes, from the server's preview. */
function ChangesPanel({
  deckName,
  changes,
  swapsAfter,
  deckState,
}: {
  deckName: string;
  changes: DeckChanges;
  swapsAfter: boolean;
  deckState: DeckSummary['state'] | undefined;
}) {
  const none = changes.added.length + changes.removed.length + changes.changed.length === 0;
  return (
    <Panel aria-labelledby="changes-title" className="flex flex-col gap-2.5 px-4 py-3.5">
      <h2 id="changes-title" className="font-semibold text-[15px]">
        Changes to {deckName}
      </h2>
      {none ? (
        <p className="text-[13px] text-muted-foreground">
          The list is the same as the deck's. Nothing changes.
        </p>
      ) : (
        <ul aria-label="Changes" className="flex flex-col gap-1 text-[13px]">
          {changes.added.map((slot) => (
            <ChangeRow key={`+${slot.board}:${slot.card.id}`} sign="+">
              {slotLabel(slot, '+')}
            </ChangeRow>
          ))}
          {changes.removed.map((slot) => (
            <ChangeRow key={`-${slot.board}:${slot.card.id}`} sign="−">
              {slotLabel(slot, '−')}
            </ChangeRow>
          ))}
          {changes.changed.map((change) => (
            <ChangeRow key={`=${change.board}:${change.card.id}`}>
              {change.card.name} in {BOARD_PLACES[change.board]}: {change.from} → {change.to}
            </ChangeRow>
          ))}
        </ul>
      )}
      {swapsAfter && !none && (
        <p className="text-[13px] text-muted-foreground">
          {deckName} is {deckState === 'assembled' ? 'assembled' : 'partly assembled'}, so updating
          opens the swap list for the cards that change.
        </p>
      )}
    </Panel>
  );
}

function ChangeRow({ sign, children }: { sign?: '+' | '−'; children: ReactNode }) {
  const Icon = sign === '+' ? Plus : sign === '−' ? Minus : null;
  return (
    <li
      className={cn(
        'flex items-center gap-1.5',
        sign === '+' && 'text-status-in-box',
        sign === '−' && 'text-status-missing',
      )}
    >
      {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.6} />}
      <span>{children}</span>
    </li>
  );
}

function PickerDialog({
  picker,
  onClose,
  onPick,
}: {
  picker: Picker | null;
  onClose: () => void;
  onPick: (card: CardSearchResult) => void;
}) {
  const title =
    picker?.kind === 'legend'
      ? 'Choose the Legend'
      : picker?.kind === 'champion'
        ? 'Choose the Chosen Champion'
        : `Find the card for line ${picker?.lineNumber ?? ''}`;
  return (
    <Dialog open={picker !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-popover sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {picker?.kind === 'fix'
              ? `Search for the card “${picker.name}” means.`
              : picker?.kind === 'champion'
                ? 'Search the champion units.'
                : 'Search the Legends.'}
          </DialogDescription>
        </DialogHeader>
        {picker && (
          <CardSearchPicker
            label="Card name"
            autoFocus
            onPick={onPick}
            {...(picker.kind === 'legend' && { type: 'legend' as const })}
            {...(picker.kind === 'champion' && {
              type: 'unit' as const,
              supertype: 'champion',
              ...(picker.championTag && { championTag: picker.championTag }),
            })}
            {...(picker.kind === 'fix' && { initialText: picker.name })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
