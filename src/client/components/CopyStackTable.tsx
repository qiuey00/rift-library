import {
  createColumnHelper,
  type Row,
  type RowSelectionState,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { LayoutGrid, List, type LucideIcon, X } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router';
import type { Finish, StackRow } from '../../shared/api/common';
import { formatCents } from '../lib/money';
import { cn } from '../lib/utils';
import { LocationTile } from './LocationTile';
import { ManaCost } from './ManaCost';
import { Panel } from './Panel';
import { ProxyTag } from './ProxyTag';
import { TradeTag } from './TradeTag';

/** A button in the selection bar. The table only hands it the selected rows. */
export type CopyStackAction = {
  label: string;
  icon?: LucideIcon;
  onClick: (selected: StackRow[]) => void;
};

export type CopyStackView = 'rows' | 'images';

/** Text rows are this tall, so the virtual list knows where each row is without measuring. */
export const ROW_HEIGHT = 44;
/** Card images are 488 × 680, scaled to the column width. */
const IMAGE_MIN_WIDTH = 200;
const IMAGE_RATIO = 680 / 488;
const GRID_GAP = 16;
const IMAGE_CAPTION = 60;
/** How close to the end (in rows) the list asks for the next page. */
const END_REACHED_ROWS = 10;

const finishWords: Record<Finish, string> = { nonfoil: 'Nonfoil', foil: 'Foil', etched: 'Etched' };

const conditionWords: Record<string, [short: string, long: string]> = {
  mint: ['M', 'Mint'],
  near_mint: ['NM', 'Near mint'],
  excellent: ['EX', 'Excellent'],
  good: ['GD', 'Good'],
  lightly_played: ['LP', 'Lightly played'],
  moderately_played: ['MP', 'Moderately played'],
  played: ['PL', 'Played'],
  heavily_played: ['HP', 'Heavily played'],
  damaged: ['DMG', 'Damaged'],
  poor: ['PR', 'Poor'],
};

function conditionLabel(condition: string): [short: string, long: string] {
  const known = conditionWords[condition];
  if (known) return known;
  const words = condition.replaceAll('_', ' ');
  const long = words.charAt(0).toUpperCase() + words.slice(1);
  return [long, long];
}

const features = tableFeatures({ rowSelectionFeature });
type StackTableRow = Row<typeof features, StackRow>;
const helper = createColumnHelper<typeof features, StackRow>();

/** Each column's width and alignment. The table is fixed-layout so virtual rows never shift. */
const columnLook: Record<string, { width?: string; className?: string; header: ReactNode }> = {
  select: { width: '44px', header: null },
  card: { header: 'Card' },
  set: { width: '96px', header: 'Set' },
  number: { width: '72px', header: 'No.' },
  finish: { width: '84px', header: 'Finish' },
  condition: { width: '76px', header: 'Cond.' },
  language: { width: '64px', header: 'Lang.' },
  quantity: { width: '56px', className: 'text-right', header: 'Qty' },
  location: { width: '22%', header: 'Where it is' },
  value: { width: '92px', className: 'text-right', header: 'Value' },
};

function InDeckTag({ inDeck }: { inDeck: NonNullable<StackRow['inDeck']> }) {
  return (
    <Link
      to={`/decks/${inDeck.deckId}`}
      className="inline-flex max-w-40 shrink-0 items-center gap-1 truncate rounded-sm bg-status-in-box-soft px-1.5 font-bold text-[11px] text-status-in-box leading-4 hover:no-underline"
    >
      <span className="truncate">In deck · {inDeck.deckName}</span>
    </Link>
  );
}

function CardName({ row }: { row: StackRow }) {
  return (
    <Link
      to={`/cards/${row.card.oracleId}`}
      className="truncate font-semibold text-foreground hover:text-primary"
    >
      {row.card.name}
    </Link>
  );
}

function SetSymbol({ row }: { row: StackRow }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      title={row.printing.setName}
    >
      <i
        aria-hidden="true"
        className={cn(
          'ss ss-fw text-base',
          `ss-${row.printing.setCode}`,
          `ss-${row.printing.rarity}`,
        )}
      />
      {row.printing.setCode.toUpperCase()}
    </span>
  );
}

/** The location's tile and full path, opening it on the Locations screen. */
function LocationLink({ row, className }: { row: StackRow; className?: string }) {
  return (
    <Link
      to={`/locations?selected=${row.location.id}`}
      className={cn('flex min-w-0 items-center gap-2 hover:text-primary', className)}
    >
      <LocationTile type={row.location.type} color={row.location.color} size="sm" />
      <span className="truncate">{row.location.path}</span>
    </Link>
  );
}

/** quantity × price; "No price" when there is none, and empty for proxies, which have no value. */
function StackValue({ row }: { row: StackRow }) {
  if (row.isProxy) return null;
  if (row.unitPrice === null) return <span className="text-muted-foreground">No price</span>;
  return <span className="tabular-nums">{formatCents(row.value)}</span>;
}

function buildColumns(
  showLanguage: boolean,
  showLocation: boolean,
  showValue: boolean,
  showTrade: boolean,
) {
  return helper.columns([
    helper.display({ id: 'select' }),
    helper.display({
      id: 'card',
      cell: ({ row }) => {
        const stack = row.original;
        return (
          <span className="flex min-w-0 items-center gap-2">
            <CardName row={stack} />
            <ManaCost
              cost={stack.card.manaCost}
              className="min-w-0 shrink-[4] overflow-hidden text-[13px]"
            />
            {stack.isProxy && <ProxyTag className="shrink-0" />}
            {showTrade && stack.location.forTrade && <TradeTag className="shrink-0" />}
            {stack.inDeck && <InDeckTag inDeck={stack.inDeck} />}
          </span>
        );
      },
    }),
    helper.display({ id: 'set', cell: ({ row }) => <SetSymbol row={row.original} /> }),
    helper.display({
      id: 'number',
      cell: ({ row }) => (
        <span className="tabular-nums">#{row.original.printing.collectorNumber}</span>
      ),
    }),
    helper.display({ id: 'finish', cell: ({ row }) => finishWords[row.original.finish] }),
    helper.display({
      id: 'condition',
      cell: ({ row }) => {
        const [short, long] = conditionLabel(row.original.condition);
        return (
          <abbr title={long} className="no-underline">
            {short}
          </abbr>
        );
      },
    }),
    ...(showLanguage
      ? [
          helper.display({
            id: 'language',
            cell: ({ row }) =>
              row.original.language === 'en' ? null : row.original.language.toUpperCase(),
          }),
        ]
      : []),
    helper.display({
      id: 'quantity',
      cell: ({ row }) => <span className="tabular-nums">{row.original.quantity}</span>,
    }),
    ...(showValue
      ? [helper.display({ id: 'value', cell: ({ row }) => <StackValue row={row.original} /> })]
      : []),
    ...(showLocation
      ? [helper.display({ id: 'location', cell: ({ row }) => <LocationLink row={row.original} /> })]
      : []),
  ]);
}

function readView(key: string): CopyStackView {
  try {
    return localStorage.getItem(key) === 'images' ? 'images' : 'rows';
  } catch {
    return 'rows';
  }
}

function writeView(key: string, view: CopyStackView) {
  try {
    localStorage.setItem(key, view);
  } catch {
    // Storage can be blocked; the switch still works for this visit.
  }
}

/** Where the element starts on the page, for the window virtualizer's scroll margin. */
function usePageTop<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (el) setTop(el.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);
  return [ref, top] as const;
}

/** Calls `onEndReached` once per length when the last visible item is near the end. */
function useEndReached(
  lastIndex: number | undefined,
  count: number,
  threshold: number,
  onEndReached?: () => void,
) {
  const calledAt = useRef<number | null>(null);
  useEffect(() => {
    if (!onEndReached || count === 0 || lastIndex === undefined) return;
    if (lastIndex >= count - 1 - threshold && calledAt.current !== count) {
      calledAt.current = count;
      onEndReached();
    }
  }, [lastIndex, count, threshold, onEndReached]);
}

type Preview = { row: StackRow; left: number; top: number };
const PREVIEW_WIDTH = 244;
const PREVIEW_HEIGHT = Math.round(PREVIEW_WIDTH * IMAGE_RATIO);

/** The card image that follows the hovered text row. Sighted-only: the name is in the row. */
function CardPreview({ preview }: { preview: Preview | null }) {
  if (!preview?.row.printing.imageNormal) return null;
  return (
    <div
      data-slot="card-preview"
      aria-hidden="true"
      className="pointer-events-none fixed z-50 overflow-hidden rounded-[12px] shadow-[0_8px_24px_rgba(23,26,33,0.25)]"
      style={{ left: preview.left, top: preview.top, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
    >
      <img src={preview.row.printing.imageNormal} alt="" className="size-full object-contain" />
    </div>
  );
}

function previewAt(row: StackRow, anchor: DOMRect, pointerX: number | null): Preview {
  const x = pointerX ?? anchor.left + 320;
  const left = Math.max(8, Math.min(x + 24, window.innerWidth - PREVIEW_WIDTH - 8));
  const middle = anchor.top + anchor.height / 2 - PREVIEW_HEIGHT / 2;
  const top = Math.max(8, Math.min(middle, window.innerHeight - PREVIEW_HEIGHT - 8));
  return { row, left, top };
}

function SelectBox({ row, label }: { row: StackTableRow; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={`Select ${label}`}
      checked={row.getIsSelected()}
      onChange={row.getToggleSelectedHandler()}
      className="size-[17px] cursor-pointer accent-primary"
    />
  );
}

function stackLabel(row: StackRow) {
  return `${row.card.name} (${row.printing.setCode.toUpperCase()} #${row.printing.collectorNumber}, ${row.location.path})`;
}

type TableInstance = ReturnType<typeof useTable<typeof features, StackRow>>;

function RowsView({
  table,
  rows,
  selectedCount,
  onEndReached,
  onPreview,
}: {
  table: TableInstance;
  rows: StackTableRow[];
  /** Worked out once by the parent: the table's own all-selected checks walk every row. */
  selectedCount: number;
  onEndReached?: () => void;
  /** Shows the hovered row in the screen's own preview instead of the floating one. */
  onPreview?: (row: StackRow) => void;
}) {
  const [bodyRef, bodyTop] = usePageTop<HTMLTableSectionElement>();
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollMargin: bodyTop,
    getItemKey: (index) => rows[index]?.id ?? index,
  });
  const items = virtualizer.getVirtualItems();
  useEndReached(items.at(-1)?.index, rows.length, END_REACHED_ROWS, onEndReached);

  const [preview, setPreview] = useState<Preview | null>(null);
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const before = items.length > 0 ? items[0].start - virtualizer.options.scrollMargin : 0;
  const after =
    items.length > 0
      ? virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0) + virtualizer.options.scrollMargin
      : 0;

  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[860px] table-fixed border-collapse">
        <colgroup>
          {headers.map((header) => (
            <col key={header.id} style={{ width: columnLook[header.column.id]?.width }} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-left text-muted-foreground text-xs uppercase tracking-[0.04em]">
            {headers.map((header) => (
              <th
                key={header.id}
                scope="col"
                className={cn(
                  'border-border border-b px-2 py-2.5 font-semibold first:pl-3.5 last:pr-3.5',
                  columnLook[header.column.id]?.className,
                )}
              >
                {header.column.id === 'select' ? (
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                    }}
                    onChange={() => table.toggleAllRowsSelected(!allSelected)}
                    disabled={rows.length === 0}
                    className="size-[17px] cursor-pointer accent-primary"
                  />
                ) : (
                  columnLook[header.column.id]?.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={bodyRef} onMouseLeave={() => setPreview(null)}>
          {before > 0 && (
            <tr>
              <td colSpan={headers.length} style={{ height: before, padding: 0 }} />
            </tr>
          )}
          {items.map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const stack = row.original;
            return (
              <tr
                key={row.id}
                data-stack-id={stack.stackId}
                aria-selected={row.getIsSelected()}
                style={{ height: ROW_HEIGHT }}
                className={cn(
                  'hover:bg-[#f6f8fb]',
                  row.getIsSelected() && 'bg-[#eef3fe] hover:bg-[#eef3fe]',
                )}
                onMouseEnter={(event) =>
                  onPreview
                    ? onPreview(stack)
                    : setPreview(
                        previewAt(
                          stack,
                          event.currentTarget.getBoundingClientRect(),
                          event.clientX,
                        ),
                      )
                }
                onFocus={(event) =>
                  onPreview
                    ? onPreview(stack)
                    : setPreview(
                        previewAt(stack, event.currentTarget.getBoundingClientRect(), null),
                      )
                }
                onBlur={() => setPreview(null)}
              >
                {row.getAllCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn(
                      'overflow-hidden whitespace-nowrap border-[#eceef2] border-b px-2 first:pl-3.5 last:pr-3.5',
                      columnLook[cell.column.id]?.className,
                    )}
                  >
                    {cell.column.id === 'select' ? (
                      <SelectBox row={row} label={stackLabel(stack)} />
                    ) : (
                      <table.FlexRender cell={cell} />
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
          {after > 0 && (
            <tr>
              <td colSpan={headers.length} style={{ height: after, padding: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
      <CardPreview preview={preview} />
    </Panel>
  );
}

function ImageTile({ row, showTrade }: { row: StackTableRow; showTrade: boolean }) {
  const stack = row.original;
  return (
    <div
      data-stack-id={stack.stackId}
      className={cn(
        'relative flex min-w-0 flex-col gap-1.5 rounded-[14px] p-1',
        row.getIsSelected() && 'bg-[#dfe7fb]',
      )}
    >
      <div className="relative">
        {stack.printing.imageNormal ? (
          <img
            src={stack.printing.imageNormal}
            alt={stack.card.name}
            loading="lazy"
            className="block aspect-[488/680] w-full rounded-[4.75%/3.5%] bg-muted object-contain"
          />
        ) : (
          <div className="flex aspect-[488/680] w-full items-center justify-center rounded-[4.75%/3.5%] bg-muted p-4 text-center font-semibold text-muted-foreground">
            {stack.card.name}
          </div>
        )}
        <span className="absolute top-2 left-2 rounded-md bg-card/90 p-1 leading-none shadow-sm">
          <SelectBox row={row} label={stackLabel(stack)} />
        </span>
        {stack.quantity > 1 && (
          <span className="absolute top-2 right-2 rounded-full bg-foreground px-2 font-bold text-white text-xs leading-5">
            ×{stack.quantity}
          </span>
        )}
      </div>
      <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <CardName row={stack} />
        {stack.finish !== 'nonfoil' && (
          <span className="shrink-0 text-muted-foreground text-xs">
            {finishWords[stack.finish]}
          </span>
        )}
        {stack.isProxy && <ProxyTag className="shrink-0" />}
        {showTrade && stack.location.forTrade && <TradeTag className="shrink-0" />}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
        {stack.inDeck ? (
          <InDeckTag inDeck={stack.inDeck} />
        ) : (
          <LocationLink row={stack} className="gap-1.5" />
        )}
      </span>
    </div>
  );
}

/** Watches the grid's width so the image view knows how many cards fit in a row. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function ImagesView({
  rows,
  showTrade,
  onEndReached,
}: {
  rows: StackTableRow[];
  showTrade: boolean;
  onEndReached?: () => void;
}) {
  const [gridRef, width] = useWidth<HTMLDivElement>();
  const [topRef, gridTop] = usePageTop<HTMLDivElement>();
  const columns = Math.max(1, Math.floor((width + GRID_GAP) / (IMAGE_MIN_WIDTH + GRID_GAP)));
  const tileWidth = width > 0 ? (width - GRID_GAP * (columns - 1)) / columns : IMAGE_MIN_WIDTH;
  const lineHeight = Math.round(tileWidth * IMAGE_RATIO + IMAGE_CAPTION + GRID_GAP);
  const lines = Math.ceil(rows.length / columns);

  const virtualizer = useWindowVirtualizer({
    count: lines,
    estimateSize: () => lineHeight,
    overscan: 3,
    scrollMargin: gridTop,
  });
  useEffect(() => {
    // The line height follows the width; tell the virtualizer when it changes.
    if (lineHeight > 0) virtualizer.measure();
  }, [lineHeight, virtualizer]);

  const items = virtualizer.getVirtualItems();
  useEndReached(items.at(-1)?.index, lines, 2, onEndReached);

  return (
    <div ref={topRef}>
      <div ref={gridRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => (
          <div
            key={item.key}
            className="absolute inset-x-0 grid"
            style={{
              top: item.start - virtualizer.options.scrollMargin,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: GRID_GAP,
            }}
          >
            {rows.slice(item.index * columns, item.index * columns + columns).map((row) => (
              <ImageTile key={row.id} row={row} showTrade={showTrade} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The shared table of copy stacks on the Locations, Collection and card screens: text rows
 * or card images, checkboxes with shift-click ranges, and a selection bar with the screen's
 * own buttons. Both views are virtual, so 10,000 stacks scroll smoothly.
 */
export function CopyStackTable({
  rows: data,
  actions = [],
  viewKey,
  showLocation = true,
  showValue = false,
  showTradeTag = false,
  onEndReached,
  onPreview,
  emptyMessage = 'No cards here.',
  className,
}: {
  rows: StackRow[];
  /** The selection bar's buttons. Each gets the selected rows when clicked. */
  actions?: CopyStackAction[];
  /** The localStorage key that remembers rows or images for this screen, such as "collection-view". */
  viewKey: string;
  /** Hide the location column, such as inside a location that only shows its own copies. */
  showLocation?: boolean;
  /** Show each stack's value, such as on the Locations screen. */
  showValue?: boolean;
  /** Tag stacks in a location for trade with "Trade", such as on the Collection screen. */
  showTradeTag?: boolean;
  /** Called when the end of the list scrolls into view, to load the next page. */
  onEndReached?: () => void;
  /**
   * Called with the row under the pointer (or focused) in the rows view, for a screen that
   * shows its own card preview; without it the card image floats beside the row.
   */
  onPreview?: (row: StackRow) => void;
  emptyMessage?: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<CopyStackView>(() => readView(viewKey));
  const changeView = (next: CopyStackView) => {
    setView(next);
    writeView(viewKey, next);
  };

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const showLanguage = useMemo(() => data.some((row) => row.language !== 'en'), [data]);
  const columns = useMemo(
    () => buildColumns(showLanguage, showLocation, showValue, showTradeTag),
    [showLanguage, showLocation, showValue, showTradeTag],
  );
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (row) => String(row.stackId),
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
  });

  // Copies that moved away or were removed leave the selection with their rows.
  useEffect(() => {
    setRowSelection((selection) => {
      const present = new Set(data.map((row) => String(row.stackId)));
      const kept = Object.keys(selection).filter((id) => present.has(id));
      if (kept.length === Object.keys(selection).length) return selection;
      return Object.fromEntries(kept.map((id) => [id, true as const]));
    });
  }, [data]);

  const rows = table.getRowModel().rows;
  const selected = useMemo(
    () => data.filter((row) => rowSelection[String(row.stackId)]),
    [data, rowSelection],
  );
  const clearSelection = useCallback(() => setRowSelection({}), []);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-3">
        {selected.length > 0 ? (
          <div
            role="toolbar"
            aria-label="Selected cards"
            className="flex flex-wrap items-center gap-2 rounded-[10px] bg-foreground py-[5px] pr-1.5 pl-3.5 text-white"
          >
            <span className="font-semibold">{selected.length} selected</span>
            {actions.map(({ label, icon: Icon, onClick }, index) => (
              <button
                key={label}
                type="button"
                onClick={() => onClick(selected)}
                className={cn(
                  'inline-flex h-[30px] items-center gap-1.5 rounded-[7px] px-3 font-semibold text-sm',
                  index === 0
                    ? 'bg-primary hover:bg-[#1b3f9c]'
                    : 'border border-[#4a5161] hover:bg-white/10',
                )}
              >
                {Icon && <Icon size={15} aria-hidden="true" />}
                {label}
              </button>
            ))}
            <button
              type="button"
              aria-label="Clear selection"
              onClick={clearSelection}
              className="inline-flex size-[30px] items-center justify-center rounded-[7px] hover:bg-white/10"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ) : view === 'images' && rows.length > 0 ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={false}
              onChange={() => table.toggleAllRowsSelected(true)}
              className="size-[17px] cursor-pointer accent-primary"
            />
            Select all
          </label>
        ) : (
          <span />
        )}
        <fieldset className="m-0 flex min-w-0 overflow-hidden rounded-lg border border-input bg-card p-0">
          <legend className="sr-only">View</legend>
          {(
            [
              ['rows', 'Rows', List],
              ['images', 'Images', LayoutGrid],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => changeView(value)}
              className={cn(
                'inline-flex h-[34px] items-center gap-1.5 px-3 text-sm',
                view === value
                  ? 'bg-[#e8eefc] font-semibold text-[#1b3f9c]'
                  : 'font-medium text-muted-foreground hover:bg-[#f4f6fa]',
              )}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </fieldset>
      </div>
      {rows.length === 0 ? (
        <Panel className="p-6 text-center text-muted-foreground">{emptyMessage}</Panel>
      ) : view === 'rows' ? (
        <RowsView
          table={table}
          rows={rows}
          selectedCount={selected.length}
          onEndReached={onEndReached}
          onPreview={onPreview}
        />
      ) : (
        <ImagesView rows={rows} showTrade={showTradeTag} onEndReached={onEndReached} />
      )}
    </div>
  );
}
