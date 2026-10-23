import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpToLine,
  CircleCheck,
  CircleX,
  ClipboardPaste,
  History,
  Layers,
  LayoutGrid,
  List,
  type LucideIcon,
  MapPin,
  MoreHorizontal,
  Package,
  PackageOpen,
  Pencil,
  Images as PrintingsIcon,
  RefreshCw,
  ShoppingCart,
  SquareCheckBig,
  Tag,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import {
  type ComponentProps,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useParams } from 'react-router';
import type { CardSearchResult } from '../../shared/api/cards';
import { type Board, type CardSummary, ErrorBody, type Id } from '../../shared/api/common';
import type { DeckChecks } from '../../shared/api/deck-checks';
import type { CardDrop, DeckSummary, DeckView, SlotChange, SlotRow } from '../../shared/api/decks';
import { api } from '../api';
import { AddToBuyListDialog } from '../components/AddToBuyListDialog';
import { CardSearchPicker } from '../components/CardSearchPicker';
import { ChangePrintingDialog } from '../components/ChangePrintingDialog';
import { DeleteDeckDialog } from '../components/DeleteDeckDialog';
import { LocationTile } from '../components/LocationTile';
import { ManaCost } from '../components/ManaCost';
import { MoxfieldExportDialog } from '../components/MoxfieldExportDialog';
import { Panel } from '../components/Panel';
import { ProxyTag } from '../components/ProxyTag';
import { StatePill } from '../components/StatePill';
import { StatusBadge } from '../components/StatusBadge';
import { SwapBanner } from '../components/SwapBanner';
import { useUndoBar } from '../components/UndoBar';
import { Button } from '../components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../components/ui/context-menu';
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
import { Input } from '../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select';
import {
  deckTags,
  type GroupBy,
  groupSlots,
  missingQuantity,
  type SlotGroup,
  type SortBy,
  type TagFilter,
  tagKey,
} from '../lib/deck-groups';
import { cn } from '../lib/utils';

/** The error message a failed answer carries, written for Jeff. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = ErrorBody.safeParse(await res.json().catch(() => null));
  return new Error(body.success ? body.data.error.message : fallback);
}

function useDeck(deckId: Id) {
  return useQuery({
    queryKey: ['decks', deckId],
    queryFn: async (): Promise<DeckView> => {
      const res = await api.decks[':id'].$get({ param: { id: String(deckId) } });
      if (!res.ok) throw await failure(res, "Couldn't load this deck.");
      return res.json();
    },
  });
}

function useDeckChecks(deckId: Id) {
  return useQuery({
    queryKey: ['decks', deckId, 'checks'],
    queryFn: async (): Promise<DeckChecks> => {
      const res = await api.decks[':id'].checks.$get({ param: { id: String(deckId) } });
      if (!res.ok) throw await failure(res, "Couldn't check this deck.");
      return res.json();
    },
  });
}

/** One deck: its decklist and where each slot's card is (`/decks/:id`). */
export function Deck() {
  const deckId = Number(useParams().id);
  const deck = useDeck(deckId);
  const checks = useDeckChecks(deckId);

  if (!deck.data) {
    return (
      <div className="mx-auto flex max-w-[1392px] flex-col gap-5 px-6 pt-8 pb-12">
        <h1 className="font-serif text-[44px] leading-[1.05]">Deck</h1>
        <Panel className="p-5 text-muted-foreground" role={deck.isError ? 'alert' : 'status'}>
          {deck.isError ? deck.error.message : 'Loading the deck…'}
        </Panel>
      </div>
    );
  }

  return <DeckScreen view={deck.data} checks={checks.data} />;
}

function DeckScreen({ view, checks }: { view: DeckView; checks: DeckChecks | undefined }) {
  const { deck, slots } = view;
  const [listView, setListView] = useRememberedListView();
  const [groupBy, setGroupBy] = useState<GroupBy>('type');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [showStatus, setShowStatus] = useRememberedShowStatus();
  const tags = useMemo(() => deckTags(slots), [slots]);
  const [chosenFilter, setTagFilter] = useState<TagFilter>({ kind: 'any' });
  // A filtered tag no card has any more shows every card again.
  const tagFilter: TagFilter =
    chosenFilter.kind === 'tag' && !tags.some((tag) => tag.key === chosenFilter.key)
      ? { kind: 'any' }
      : chosenFilter;
  const groups = useMemo(
    () => groupSlots(slots, groupBy, sortBy, tagFilter),
    [slots, groupBy, sortBy, tagFilter],
  );
  const maybeCount = groups.maybe.reduce((sum, group) => sum + group.count, 0);
  const [hoveredId, setHoveredId] = useState<Id | null>(null);
  const [buying, setBuying] = useState<{ oracleId: string; quantity: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const edits = useDeckEdits(deck.id);
  const [changingQuantity, setChangingQuantity] = useState<SlotRow | null>(null);
  const [changingPrinting, setChangingPrinting] = useState<SlotRow | null>(null);
  const [editingTags, setEditingTags] = useState<SlotRow | null>(null);
  const [commanderDialog, setCommanderDialog] = useState<CommanderDialogMode | null>(null);
  const dragging = useOutsideDrag();
  const dropCard = useCardDrop(deck.id);

  const previewed =
    slots.find((slot) => slot.id === hoveredId) ?? groups.decklist[0]?.slots[0] ?? slots[0] ?? null;

  const rowProps = (slot: SlotRow): RowProps => ({
    slot,
    hovered: slot.id === previewed?.id,
    showStatus,
    onHover: () => setHoveredId(slot.id),
    onBuy: (quantity) => setBuying({ oracleId: slot.card.oracleId, quantity }),
    onChangePrinting: () => setChangingPrinting(slot),
    onEditTags: () => setEditingTags(slot),
    onMove: (board) => edits.mutate({ kind: 'change', slot, change: { board } }),
    busy: edits.isPending,
    menu: editing ? (
      <SlotMenu
        slot={slot}
        commanders={deck.commanders}
        busy={edits.isPending}
        onChangeQuantity={() => setChangingQuantity(slot)}
        onCommanderDialog={setCommanderDialog}
        onEdit={edits.mutate}
      />
    ) : undefined,
  });

  return (
    <>
      <DeckHeader deck={deck} editing={editing} onEditingChange={setEditing} />
      <div className="relative mx-auto -mt-10 flex max-w-[1392px] flex-col gap-[18px] px-6 pb-12">
        <SwapBanner deckId={deck.id} />
        <AvailabilityPanel deck={deck} slots={slots} />
        {editing && <EditPanel deck={deck} edits={edits} onDone={() => setEditing(false)} />}
        {!editing && slots.every((slot) => slot.board === 'commander') && (
          <EmptyDeck deckId={deck.id} onEdit={() => setEditing(true)} />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Toggle
            label="View"
            value={listView}
            onChange={setListView}
            options={[
              { value: 'rows', label: 'Rows', icon: List },
              { value: 'images', label: 'Images', icon: LayoutGrid },
            ]}
          />
          <Toggle
            label="Group by"
            showLabel
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: 'type', label: 'Type' },
              { value: 'where', label: 'Where it is' },
              { value: 'tag', label: 'Tag' },
            ]}
          />
          <Toggle
            label="Sort by"
            showLabel
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: 'name', label: 'Name' },
              { value: 'mana_value', label: 'Mana value' },
            ]}
          />
          <TagFilterSelect tags={tags} value={tagFilter} onChange={setTagFilter} />
          <button
            type="button"
            aria-pressed={showStatus}
            onClick={() => setShowStatus(!showStatus)}
            className={cn(
              'flex h-[34px] items-center gap-1.5 rounded-lg border border-input px-3 focus-visible:outline-2 focus-visible:outline-ring',
              showStatus
                ? 'bg-[#e8eefc] font-semibold text-[#1b3f9c]'
                : 'bg-card font-medium text-muted-foreground hover:bg-[#f4f6fa]',
            )}
          >
            <CircleCheck aria-hidden="true" className="size-[15px]" />
            Show status
          </button>
        </div>

        {/* An empty last line stretches the row down over this screen's and the frame's bottom
            padding to the end of the page, so the sticky side pane is never pushed up when the
            decklist ends. */}
        <div className="flex flex-wrap items-start gap-6 lg:-mb-36 lg:after:h-30 lg:after:basis-full">
          <SidePane slot={previewed} checks={checks} />
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-[18px]">
            <DropTarget
              board="main"
              dragging={dragging}
              onCardDrop={dropCard}
              role="region"
              aria-label="Decklist"
              className="px-4 py-[18px]"
            >
              <SlotGroups groups={groups.decklist} listView={listView} rowProps={rowProps} />
            </DropTarget>
            {maybeCount === 0 && dragging && (
              <DropTarget
                board="maybe"
                dragging={dragging}
                onCardDrop={dropCard}
                role="region"
                aria-label="Maybe board"
                className="flex min-h-[140px] items-center justify-center px-4 py-[18px]"
              >
                <h2 className="font-serif text-[26px] text-muted-foreground leading-none">
                  Maybe board
                </h2>
              </DropTarget>
            )}
            {maybeCount > 0 && (
              <DropTarget
                board="maybe"
                dragging={dragging}
                onCardDrop={dropCard}
                role="region"
                aria-label="Maybe board"
                className="flex flex-col gap-4 px-4 py-[18px]"
              >
                <div className="flex items-baseline justify-between gap-4 px-2">
                  <h2 className="font-serif text-[26px] leading-none">
                    Maybe board
                    <span className="ml-2.5 font-sans font-semibold text-[15px] text-status-basic tabular-nums">
                      {maybeCount} {maybeCount === 1 ? 'card' : 'cards'}
                    </span>
                  </h2>
                  <p className="text-[13px] text-muted-foreground">
                    Not counted, picked or checked with the deck.
                  </p>
                </div>
                <SlotGroups
                  groups={groups.maybe}
                  listView={listView}
                  rowProps={rowProps}
                  level={3}
                />
              </DropTarget>
            )}
          </div>
        </div>
      </div>

      {buying && (
        <AddToBuyListDialog
          open
          onOpenChange={(open) => !open && setBuying(null)}
          oracleId={buying.oracleId}
          quantity={buying.quantity}
        />
      )}
      {changingQuantity && (
        <QuantityDialog
          slot={changingQuantity}
          onSave={(quantity) =>
            edits.mutateAsync({ kind: 'change', slot: changingQuantity, change: { quantity } })
          }
          onClose={() => setChangingQuantity(null)}
        />
      )}
      {changingPrinting && (
        <ChangePrintingDialog
          slot={changingPrinting}
          onSave={(printing) =>
            edits.mutateAsync({ kind: 'change', slot: changingPrinting, change: { printing } })
          }
          onClose={() => setChangingPrinting(null)}
        />
      )}
      {editingTags && (
        <EditTagsDialog
          deckId={deck.id}
          slot={editingTags}
          deckTags={tags.map((tag) => tag.name)}
          onClose={() => setEditingTags(null)}
        />
      )}
      {commanderDialog && (
        <CommanderDialog
          mode={commanderDialog}
          commanders={deck.commanders}
          onSave={(oracleIds) => edits.mutateAsync({ kind: 'commanders', oracleIds })}
          onClose={() => setCommanderDialog(null)}
        />
      )}
    </>
  );
}

/** Whether a drag from outside the app (another site's card) is over the window. */
function useOutsideDrag() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    // Drags that start in the app, such as a card image in the deck, are not drops to add.
    let inside = false;
    // dragenter and dragleave fire for every element crossed; count them to know when the
    // drag has left the window.
    let depth = 0;
    const onStart = () => {
      inside = true;
    };
    const onEnd = () => {
      inside = false;
    };
    const onEnter = (event: globalThis.DragEvent) => {
      if (inside || !carriesCard(event.dataTransfer)) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = () => {
      if (inside || depth === 0) return;
      depth -= 1;
      if (depth === 0) setDragging(false);
    };
    const onDrop = () => {
      depth = 0;
      setDragging(false);
    };
    document.addEventListener('dragstart', onStart);
    document.addEventListener('dragend', onEnd);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragstart', onStart);
      document.removeEventListener('dragend', onEnd);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return dragging;
}

/** Whether a drag carries a link, page or text that may name a card (not only files). */
function carriesCard(data: DataTransfer | null) {
  const types = [...(data?.types ?? [])];
  return ['text/uri-list', 'text/html', 'text/plain'].some((type) => types.includes(type));
}

/** Sends a card dropped from another site to the deck, and tells Jeff what happened. */
function useCardDrop(deckId: Id) {
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const drop = useMutation({
    mutationFn: async (json: CardDrop): Promise<SlotRow> => {
      const res = await api.decks[':id'].slots.drop.$post({ param: { id: String(deckId) }, json });
      if (!res.ok) throw await failure(res, "Couldn't add the card to the deck.");
      return res.json();
    },
    onSuccess: (slot) => {
      const board = slot.board === 'maybe' ? 'maybe board' : 'main board';
      undoBar.show({ message: `Added ${slot.card.name} to the ${board}.`, batchId: null });
      return queryClient.invalidateQueries({ queryKey: ['decks'] });
    },
    onError: (error) => undoBar.show({ message: error.message, batchId: null, failed: true }),
  });
  return (board: CardDrop['board'], data: DataTransfer) =>
    drop.mutate({
      board,
      uriList: data.getData('text/uri-list') || undefined,
      html: data.getData('text/html') || undefined,
      text: data.getData('text/plain') || undefined,
    });
}

/** A panel that takes a card dragged in from another site while one is over the window. */
function DropTarget({
  board,
  dragging,
  onCardDrop,
  className,
  children,
  ...props
}: {
  board: CardDrop['board'];
  dragging: boolean;
  onCardDrop: (board: CardDrop['board'], data: DataTransfer) => void;
} & ComponentProps<typeof Panel>) {
  const [over, setOver] = useState(false);
  const accept = (event: DragEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };
  return (
    <Panel
      {...props}
      onDragEnter={accept}
      onDragOver={accept}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        if (!dragging) return;
        event.preventDefault();
        setOver(false);
        onCardDrop(board, event.dataTransfer);
      }}
      className={cn(
        'relative',
        className,
        dragging && 'border-[#9fb5ec] border-dashed outline-2 outline-[#9fb5ec] outline-dashed',
        over && 'border-primary bg-[#f3f6fe] outline-primary',
      )}
    >
      {dragging && (
        <span
          data-slot="drop-label"
          className={cn(
            'pointer-events-none absolute top-0 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-3.5 py-1 font-semibold text-[13px] shadow-[0_2px_8px_rgba(0,0,0,0.12)]',
            over ? 'bg-primary text-white' : 'bg-[#e8eefc] text-[#1b3f9c]',
          )}
        >
          Drop to add to the {board === 'maybe' ? 'maybe board' : 'main board'}
        </span>
      )}
      {children}
    </Panel>
  );
}

/** Shown while the deck holds only its commander: start the list from Moxfield or by hand. */
function EmptyDeck({ deckId, onEdit }: { deckId: Id; onEdit: () => void }) {
  return (
    <Panel
      role="region"
      aria-label="Empty deck"
      className="flex flex-col items-center gap-3 px-6 py-8 text-center"
    >
      <p className="text-[15px] text-muted-foreground">
        This deck has no cards besides its commander yet.
      </p>
      <div className="flex flex-wrap justify-center gap-2.5">
        <Button asChild>
          <Link to={`/import/moxfield?deck=${deckId}`}>
            <ClipboardPaste aria-hidden="true" />
            Paste a Moxfield list
          </Link>
        </Button>
        <Button variant="outline" onClick={onEdit}>
          <Pencil aria-hidden="true" />
          Add cards
        </Button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------
// Header

function DeckHeader({
  deck,
  editing,
  onEditingChange,
}: {
  deck: DeckSummary;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { counts } = deck;
  const cardCount = counts.inBox + counts.free + counts.otherDecks + counts.missing + counts.basics;
  const lightButton =
    'h-[42px] border border-white/35 bg-transparent px-4 text-white hover:bg-white/15 hover:text-white';

  return (
    <section
      aria-label="Deck header"
      className="bg-[#261e1b] bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.028)_0_14px,rgba(255,255,255,0)_14px_28px)] text-white"
    >
      <div className="mx-auto flex max-w-[1392px] flex-wrap items-end justify-between gap-6 px-6 pt-[26px] pb-16">
        <div className="flex min-w-0 flex-col gap-2.5">
          <Link to="/" className="text-[#c9ced8] text-[13px] hover:text-white hover:underline">
            Decks ›
          </Link>
          <h1 className="font-serif text-[52px] leading-none">{deck.name}</h1>
          <div className="flex flex-wrap items-center gap-3.5 text-[#d9dde5]">
            <ColorPips colors={deck.colorIdentity} />
            <span>{deck.commanders.map((card) => card.name).join(' & ')}</span>
            <span aria-hidden="true" className="text-[#7c8291]">
              ·
            </span>
            <span>{cardCount} cards</span>
            <StatePill state={deck.state} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {deck.state !== 'assembled' && (
            <Button asChild className="h-[42px] px-[18px]">
              <Link to={`/decks/${deck.id}/assemble`}>
                <SquareCheckBig aria-hidden="true" />
                Assemble
              </Link>
            </Button>
          )}
          {deck.boxCopyCount > 0 && (
            <Button asChild variant="ghost" className={lightButton}>
              <Link to={`/decks/${deck.id}/take-apart`}>
                <PackageOpen aria-hidden="true" />
                Take apart
              </Link>
            </Button>
          )}
          <Button variant="ghost" className={lightButton} onClick={() => setExporting(true)}>
            <Upload aria-hidden="true" />
            Export to Moxfield
          </Button>
          <Button asChild variant="ghost" className={lightButton}>
            <Link to={`/import/moxfield?deck=${deck.id}`}>
              <RefreshCw aria-hidden="true" />
              Update from Moxfield
            </Link>
          </Button>
          <Button
            variant="ghost"
            aria-pressed={editing}
            onClick={() => onEditingChange(!editing)}
            className={cn(
              lightButton,
              editing && 'bg-white text-[#261e1b] hover:bg-white/90 hover:text-[#261e1b]',
            )}
          >
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <Button asChild variant="ghost" className={lightButton}>
            <Link to={`/history?deck=${deck.id}`}>
              <History aria-hidden="true" />
              History
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" aria-label="More actions" className={cn(lightButton, 'w-11')}>
                <MoreHorizontal aria-hidden="true" className="size-[18px]" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                Delete deck
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {renaming && <RenameDialog deck={deck} onClose={() => setRenaming(false)} />}
      <DeleteDeckDialog
        open={deleting}
        onOpenChange={setDeleting}
        deckId={deck.id}
        deckName={deck.name}
      />
      {exporting && (
        <MoxfieldExportDialog
          open
          onOpenChange={setExporting}
          source={{ kind: 'deck', deckId: deck.id, deckName: deck.name }}
        />
      )}
    </section>
  );
}

const colorWords: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
};

function ColorPips({ colors }: { colors: string }) {
  const letters = colors === '' ? ['C'] : [...colors];
  const words = colors === '' ? 'colorless' : letters.map((c) => colorWords[c] ?? c).join(', ');
  return (
    <span className="flex gap-[3px] text-base">
      {letters.map((letter) => (
        <i key={letter} aria-hidden="true" className={`ms ms-cost ms-${letter.toLowerCase()}`} />
      ))}
      <span className="sr-only">Colors: {words}</span>
    </span>
  );
}

function RenameDialog({ deck, onClose }: { deck: DeckSummary; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(deck.name);
  const fieldId = useId();
  const rename = useMutation({
    mutationFn: async (newName: string) => {
      const res = await api.decks[':id'].$patch({
        param: { id: String(deck.id) },
        json: { name: newName },
      });
      if (!res.ok) throw await failure(res, "Couldn't rename the deck.");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['decks'] });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    rename.mutate(name);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename deck</DialogTitle>
            <DialogDescription>
              The name shows on the Decks screen and its deck box.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={fieldId} className="font-semibold">
              Deck name
            </label>
            <Input
              id={fieldId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={rename.isError || undefined}
              autoFocus
            />
            {rename.isError && (
              <p role="alert" className="text-destructive text-sm">
                {rename.error.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={rename.isPending}>
              {rename.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------
// Availability

const availability = [
  {
    key: 'inBox',
    word: 'in deck box',
    icon: CircleCheck,
    text: 'text-status-in-box',
    fill: 'bg-status-in-box-fill',
  },
  {
    key: 'free',
    word: 'free',
    icon: MapPin,
    text: 'text-status-free',
    fill: 'bg-status-free-fill',
  },
  {
    key: 'otherDecks',
    word: 'in other decks',
    icon: Package,
    text: 'text-status-other-decks',
    fill: 'bg-status-other-decks-fill',
  },
  {
    key: 'missing',
    word: 'missing',
    icon: CircleX,
    text: 'text-status-missing',
    fill: 'bg-status-missing-fill',
  },
  {
    key: 'basics',
    word: 'basic lands',
    icon: Layers,
    text: 'text-status-basic',
    fill: 'bg-status-basic-fill',
  },
] as const;

function AvailabilityPanel({ deck, slots }: { deck: DeckSummary; slots: SlotRow[] }) {
  const [confirming, setConfirming] = useState(false);
  const parts = availability.map((part) => ({ ...part, count: deck.counts[part.key] }));
  const summary = parts.map((part) => `${part.count} ${part.word}`).join(', ');
  const toBuy = slots
    .filter((slot) => slot.board !== 'maybe')
    .map((slot) => ({ slot, quantity: missingQuantity(slot) }))
    .filter(({ quantity }) => quantity > 0);

  return (
    <Panel
      role="region"
      aria-label="Where the cards are"
      className="flex flex-col gap-3.5 px-5 py-[18px] shadow-[0_4px_14px_rgba(23,26,33,0.06)]"
    >
      <div role="img" aria-label={summary} className="flex h-3 gap-0.5 overflow-hidden rounded-md">
        {parts
          .filter((part) => part.count > 0)
          .map((part) => (
            <div key={part.key} className={part.fill} style={{ flex: `${part.count} 1 0` }} />
          ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ul aria-label="Counts" className="flex flex-wrap gap-x-[30px] gap-y-2.5">
          {parts.map(({ key, word, icon: Icon, text, fill, count }) => (
            <li key={key} data-count={key} className="flex items-center gap-2">
              <span aria-hidden="true" className={cn('size-2.5 rounded-full', fill)} />
              <Icon aria-hidden="true" className={cn('size-[18px]', text)} strokeWidth={2.2} />
              <span className="font-bold text-[22px] tabular-nums">{count}</span>
              <span className="text-muted-foreground">{word}</span>
            </li>
          ))}
        </ul>
        {toBuy.length > 0 && (
          <Button variant="outline" onClick={() => setConfirming(true)}>
            <ShoppingCart aria-hidden="true" />
            Add missing to buy list
          </Button>
        )}
      </div>
      {confirming && <AddMissingDialog toBuy={toBuy} onClose={() => setConfirming(false)} />}
    </Panel>
  );
}

function AddMissingDialog({
  toBuy,
  onClose,
}: {
  toBuy: { slot: SlotRow; quantity: number }[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const total = toBuy.reduce((sum, { quantity }) => sum + quantity, 0);
  const add = useMutation({
    mutationFn: async () => {
      const res = await api['buy-list'].bulk.$post({
        json: {
          items: toBuy.map(({ slot, quantity }) => ({ oracleId: slot.card.oracleId, quantity })),
        },
      });
      if (!res.ok) throw await failure(res, "Couldn't add the cards to the buy list.");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buy-list'] });
      undoBar.show({
        message: `Added ${total} ${total === 1 ? 'card' : 'cards'} to the buy list`,
        batchId: null,
      });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add missing cards to the buy list?</DialogTitle>
          <DialogDescription>
            {total} {total === 1 ? 'card' : 'cards'} this deck has no copy of. Any printing will do.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {toBuy.map(({ slot, quantity }) => (
            <li key={slot.id} className="flex gap-2">
              <span className="w-6 text-muted-foreground tabular-nums">{quantity}</span>
              {slot.card.name}
            </li>
          ))}
        </ul>
        {add.isError && (
          <p role="alert" className="text-destructive text-sm">
            {add.error.message}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={() => add.mutate()} disabled={add.isPending}>
            {add.isPending ? 'Adding…' : `Add ${total} to buy list`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------
// Toolbar

type ListView = 'rows' | 'images';

/** The rows / images switch, remembered across visits; each screen keeps its own choice. */
const LIST_VIEW_KEY = 'deck-view';

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

/** Show status, off unless turned on, remembered across visits. */
const SHOW_STATUS_KEY = 'deck-view-status';

function useRememberedShowStatus(): [boolean, (show: boolean) => void] {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(SHOW_STATUS_KEY) === 'on';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SHOW_STATUS_KEY, show ? 'on' : 'off');
    } catch {
      // Not remembered this time; the switch still works.
    }
  }, [show]);
  return [show, setShow];
}

function Toggle<T extends string>({
  label,
  showLabel = false,
  value,
  onChange,
  options,
}: {
  label: string;
  showLabel?: boolean;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
}) {
  return (
    <fieldset aria-label={label} className="flex items-center gap-1.5">
      {showLabel && (
        <span aria-hidden="true" className="text-[13px] text-muted-foreground">
          {label}
        </span>
      )}
      <div className="flex overflow-hidden rounded-lg border border-input bg-card">
        {options.map(({ value: option, label: optionLabel, icon: Icon }) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={cn(
              'flex h-[34px] items-center gap-1.5 px-3 focus-visible:outline-2 focus-visible:outline-ring',
              value === option
                ? 'bg-[#e8eefc] font-semibold text-[#1b3f9c]'
                : 'font-medium text-muted-foreground hover:bg-[#f4f6fa]',
            )}
          >
            {Icon && <Icon aria-hidden="true" className="size-[15px]" />}
            {optionLabel}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Any tag, each tag in the deck, or Untagged; it filters both boards under every grouping. */
function TagFilterSelect({
  tags,
  value,
  onChange,
}: {
  tags: { key: string; name: string }[];
  value: TagFilter;
  onChange: (filter: TagFilter) => void;
}) {
  const selectId = useId();
  const current = value.kind === 'tag' ? `tag:${value.key}` : value.kind;
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={selectId} className="text-[13px] text-muted-foreground">
        Tag
      </label>
      <NativeSelect
        id={selectId}
        size="sm"
        value={current}
        onChange={(event) => {
          const picked = event.target.value;
          onChange(
            picked === 'any' || picked === 'untagged'
              ? { kind: picked }
              : { kind: 'tag', key: picked.slice('tag:'.length) },
          );
        }}
        className="h-[34px] font-medium"
      >
        <NativeSelectOption value="any">Any tag</NativeSelectOption>
        {tags.map((tag) => (
          <NativeSelectOption key={tag.key} value={`tag:${tag.key}`}>
            {tag.name}
          </NativeSelectOption>
        ))}
        <NativeSelectOption value="untagged">Untagged</NativeSelectOption>
      </NativeSelect>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Decklist

function GroupHeading({
  title,
  count,
  level = 2,
}: {
  title: string;
  count: number;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <Heading className="flex justify-between gap-2.5 break-after-avoid border-border border-b px-2 pb-1.5 font-bold text-[#2b303b] text-xs uppercase tracking-[0.06em]">
      {title}
      <span className="font-semibold text-status-basic">{count}</span>
    </Heading>
  );
}

/** Groups in the type-grouped columns (Rows) or as tile grids (Images). */
function SlotGroups({
  groups,
  listView,
  rowProps,
  level,
}: {
  groups: SlotGroup[];
  listView: ListView;
  rowProps: (slot: SlotRow) => RowProps;
  level?: 2 | 3;
}) {
  if (listView === 'rows') {
    return (
      <div className="[column-gap:26px] [columns:3_290px]">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.title} className="mb-[18px]">
            <GroupHeading title={group.title} count={group.count} level={level} />
            <ul>
              {group.slots.map((slot) => (
                <SlotListRow key={slot.id} {...rowProps(slot)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[22px]">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.title}>
          <GroupHeading title={group.title} count={group.count} level={level} />
          <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3.5 gap-y-[18px]">
            {group.slots.map((slot) => (
              <SlotImage key={slot.id} {...rowProps(slot)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

type RowProps = {
  slot: SlotRow;
  hovered: boolean;
  /** Show status is on: the status badge, where the card is and the proxy tag. */
  showStatus: boolean;
  onHover: () => void;
  /** Opens Add to buy list, from the card's right-click menu. */
  onBuy: (quantity: number) => void;
  /** Opens Change printing, from the card's right-click menu. */
  onChangePrinting: () => void;
  /** Opens Edit tags, from the card's right-click menu. */
  onEditTags: () => void;
  /** Moves the card to the other board, from the card's right-click menu. */
  onMove: (board: Board) => void;
  /** A change to the deck is saving. */
  busy: boolean;
  /** The slot's edit menu, while editing. */
  menu?: ReactNode;
};

function SlotListRow({ slot, hovered, showStatus, onHover, menu, ...actions }: RowProps) {
  return (
    <SlotContextMenu slot={slot} {...actions}>
      <li
        data-slot-id={slot.id}
        onMouseEnter={onHover}
        onFocus={onHover}
        className={cn(
          'grid break-inside-avoid items-start gap-x-[7px] rounded-md px-2 py-[5px]',
          menu ? 'grid-cols-[20px_minmax(0,1fr)_auto_auto]' : 'grid-cols-[20px_minmax(0,1fr)_auto]',
          hovered ? 'bg-[#e9effc]' : 'hover:bg-[#f3f6fb]',
        )}
      >
        <span className="text-muted-foreground tabular-nums">{slot.quantity}</span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <Link
              to={`/cards/${slot.card.oracleId}`}
              className="truncate font-medium hover:text-primary hover:underline"
            >
              {slot.card.name}
            </Link>
            <TagChips tags={slot.tags} />
            {showStatus && slot.inBoxProxy && <ProxyTag />}
          </span>
          {showStatus && <SlotWhereLine slot={slot} />}
        </span>
        <ManaCost cost={slot.card.manaCost} frontOnly className="mt-[3px] text-xs" />
        {menu}
      </li>
    </SlotContextMenu>
  );
}

/** A card's tags as small grey chips. */
function TagChips({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label="Tags" className={cn('flex min-w-0 shrink flex-wrap gap-1', className)}>
      {tags.map((tag) => (
        <li
          key={tag}
          className="truncate rounded bg-muted px-1.5 py-px font-medium text-[11px] text-muted-foreground leading-4"
        >
          {tag}
        </li>
      ))}
    </ul>
  );
}

/**
 * Right-clicking a card, or the Menu key or Shift+F10 while it has focus, offers Change
 * printing, a move between the main and maybe boards (not for commanders), Edit tags and Add
 * to buy list. The buy list quantity starts at how many copies are missing, or 1.
 */
function SlotContextMenu({
  slot,
  onBuy,
  onChangePrinting,
  onEditTags,
  onMove,
  busy,
  children,
}: Pick<RowProps, 'slot' | 'onBuy' | 'onChangePrinting' | 'onEditTags' | 'onMove' | 'busy'> & {
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onKeyDown={openFromKeyboard}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        <ContextMenuItem onSelect={onChangePrinting}>
          <PrintingsIcon aria-hidden="true" />
          Change printing…
        </ContextMenuItem>
        {slot.board === 'main' && (
          <ContextMenuItem disabled={busy} onSelect={() => onMove('maybe')}>
            <ArrowDownToLine aria-hidden="true" />
            Move to maybe board
          </ContextMenuItem>
        )}
        {slot.board === 'maybe' && (
          <ContextMenuItem disabled={busy} onSelect={() => onMove('main')}>
            <ArrowUpToLine aria-hidden="true" />
            Move to main board
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onEditTags}>
          <Tag aria-hidden="true" />
          Edit tags…
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onBuy(Math.max(missingQuantity(slot), 1))}>
          <ShoppingCart aria-hidden="true" />
          Add to buy list
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Browsers don't all fire contextmenu for the Menu key or Shift+F10, so fire it here. */
function openFromKeyboard(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  event.preventDefault();
  const target = event.target as HTMLElement;
  const box = target.getBoundingClientRect();
  target.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: box.left,
      clientY: box.bottom,
    }),
  );
}

/** The status badge and where the card is: the best location, or the other decks holding it. */
function SlotWhereLine({ slot }: { slot: SlotRow }) {
  if (slot.status === null) return null;
  let where: ReactNode = null;
  if (slot.status === 'free') {
    const [first, ...rest] = slot.where.locations;
    if (first) {
      where = (
        <span className="flex min-w-0 items-center gap-1.5 text-status-free">
          <LocationTile type={first.type} color={first.color} size="sm" />
          <span className="truncate">{first.path}</span>
          {rest.length > 0 && (
            <span className="shrink-0 text-muted-foreground">+{rest.length} more</span>
          )}
        </span>
      );
    }
  } else if (slot.status === 'other_decks') {
    where = (
      <span className="truncate text-status-other-decks">
        {slot.where.otherDecks.map((deck) => deck.name).join(', ')}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <StatusBadge status={slot.status} />
      {where}
    </span>
  );
}

function cardImage(slot: SlotRow) {
  return slot.printing?.imageNormal ?? slot.card.imageNormal;
}

function SlotImage({ slot, hovered, showStatus, onHover, menu, ...actions }: RowProps) {
  const image = cardImage(slot);
  return (
    <SlotContextMenu slot={slot} {...actions}>
      <li
        data-slot-id={slot.id}
        onMouseEnter={onHover}
        onFocus={onHover}
        className="relative flex flex-col gap-1.5"
      >
        <Link
          to={`/cards/${slot.card.oracleId}`}
          className={cn(
            'block aspect-[488/680] overflow-hidden rounded-[4.75%/3.5%] bg-[#15161a]',
            hovered && 'ring-2 ring-primary',
          )}
        >
          {image ? (
            <img
              src={image}
              alt={slot.card.name}
              loading="lazy"
              className="size-full object-contain"
            />
          ) : (
            <span className="flex size-full items-center justify-center p-3 text-center text-white">
              {slot.card.name}
            </span>
          )}
        </Link>
        {slot.quantity > 1 && (
          <span className="absolute top-2 right-2 rounded-full bg-foreground px-[7px] py-0.5 font-bold text-white text-xs">
            ×{slot.quantity}
          </span>
        )}
        {menu && <span className="absolute top-2 left-2 rounded-md bg-card shadow">{menu}</span>}
        <TagChips tags={slot.tags} />
        {showStatus && slot.inBoxProxy && <ProxyTag className="self-start" />}
        {showStatus && <SlotWhereLine slot={slot} />}
      </li>
    </SlotContextMenu>
  );
}

// ---------------------------------------------------------------------------------------
// Editing

type DeckEdit =
  | { kind: 'add'; card: CardSearchResult }
  | { kind: 'change'; slot: SlotRow; change: SlotChange }
  | { kind: 'remove'; slot: SlotRow }
  | { kind: 'commanders'; oracleIds: string[] };

/** Saves one change to the deck's slots or commanders, then reloads the deck and its checks. */
function useDeckEdits(deckId: Id) {
  const queryClient = useQueryClient();
  const id = String(deckId);
  return useMutation({
    mutationFn: async (edit: DeckEdit): Promise<void> => {
      let res: Response;
      if (edit.kind === 'add') {
        res = await api.decks[':id'].slots.$post({
          param: { id },
          json: { oracleId: edit.card.oracleId, board: 'main', quantity: 1 },
        });
      } else if (edit.kind === 'change') {
        res = await api.decks[':id'].slots[':slotId'].$patch({
          param: { id, slotId: String(edit.slot.id) },
          json: edit.change,
        });
      } else if (edit.kind === 'remove') {
        res = await api.decks[':id'].slots[':slotId'].$delete({
          param: { id, slotId: String(edit.slot.id) },
        });
      } else {
        res = await api.decks[':id'].commanders.$put({
          param: { id },
          json: { oracleIds: edit.oracleIds },
        });
      }
      if (!res.ok) throw await failure(res, "Couldn't save the change to the deck.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['decks'] }),
  });
}

type DeckEdits = ReturnType<typeof useDeckEdits>;

/** The Add card search, shown while editing. */
function EditPanel({
  deck,
  edits,
  onDone,
}: {
  deck: DeckSummary;
  edits: DeckEdits;
  onDone: () => void;
}) {
  const [added, setAdded] = useState<string | null>(null);
  const add = (card: CardSearchResult) => {
    setAdded(null);
    edits.mutate(
      { kind: 'add', card },
      { onSuccess: () => setAdded(`Added ${card.name} to the main board.`) },
    );
  };

  return (
    <Panel role="region" aria-label="Edit deck" className="flex flex-col gap-3 px-5 py-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-semibold text-[17px]">Edit the decklist</h2>
          <p className="text-[13px] text-muted-foreground">
            Search shows only cards in the commanders' colors. Each card's menu changes its
            quantity, board or commander.
          </p>
        </div>
        <Button variant="outline" onClick={onDone}>
          Done editing
        </Button>
      </div>
      <div className="max-w-[560px]">
        <CardSearchPicker
          label="Add card"
          identity={deck.colorIdentity}
          busy={edits.isPending}
          onPick={add}
          autoFocus
        />
      </div>
      {edits.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {edits.error.message}
        </p>
      ) : (
        added && (
          <p role="status" className="text-[13px] text-status-in-box">
            {added}
          </p>
        )
      )}
    </Panel>
  );
}

type CommanderDialogMode = { kind: 'change'; oracleId: string } | { kind: 'partner' };

/** The edit menu on one slot: board and quantity for cards, commander changes on the commander board. */
function SlotMenu({
  slot,
  commanders,
  busy,
  onChangeQuantity,
  onCommanderDialog,
  onEdit,
}: {
  slot: SlotRow;
  commanders: CardSummary[];
  busy: boolean;
  onChangeQuantity: () => void;
  onCommanderDialog: (mode: CommanderDialogMode) => void;
  onEdit: (edit: DeckEdit) => void;
}) {
  const oracleId = slot.card.oracleId;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={busy}
          aria-label={`Edit ${slot.card.name}`}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {slot.board === 'commander' ? (
          <>
            <DropdownMenuItem onSelect={() => onCommanderDialog({ kind: 'change', oracleId })}>
              Change commander
            </DropdownMenuItem>
            {commanders.length < 2 ? (
              <DropdownMenuItem onSelect={() => onCommanderDialog({ kind: 'partner' })}>
                Add a partner
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() =>
                  onEdit({
                    kind: 'commanders',
                    oracleIds: commanders
                      .map((card) => card.oracleId)
                      .filter((id) => id !== oracleId),
                  })
                }
              >
                Remove this partner
              </DropdownMenuItem>
            )}
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={onChangeQuantity}>Change quantity</DropdownMenuItem>
            {slot.board === 'main' ? (
              <DropdownMenuItem
                onSelect={() => onEdit({ kind: 'change', slot, change: { board: 'maybe' } })}
              >
                Move to maybe board
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => onEdit({ kind: 'change', slot, change: { board: 'main' } })}
              >
                Move to main board
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onEdit({ kind: 'remove', slot })}
            >
              Remove
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QuantityDialog({
  slot,
  onSave,
  onClose,
}: {
  slot: SlotRow;
  onSave: (quantity: number) => Promise<void>;
  onClose: () => void;
}) {
  const fieldId = useId();
  const [text, setText] = useState(String(slot.quantity));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const quantity = Number(text);
  const valid = Number.isInteger(quantity) && quantity >= 1;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(quantity);
      onClose();
    } catch (failed) {
      setError(failed instanceof Error ? failed.message : "Couldn't save the quantity.");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Change quantity</DialogTitle>
            <DialogDescription>How many {slot.card.name} the deck runs.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={fieldId} className="font-semibold">
              Quantity
            </label>
            <Input
              id={fieldId}
              type="number"
              min={1}
              step={1}
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-invalid={!valid || error !== null || undefined}
              autoFocus
            />
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!valid || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Splits typed text at commas into tags, dropping empty ones. */
function typedTags(text: string): string[] {
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

/**
 * The card's tags as removable chips and a field that adds a tag on Enter or comma, offering
 * the deck's other tags as Jeff types. Save replaces the slot's tags and puts the answer in
 * the deck view.
 */
function EditTagsDialog({
  deckId,
  slot,
  deckTags,
  onClose,
}: {
  deckId: Id;
  slot: SlotRow;
  deckTags: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState(slot.tags);
  const [text, setText] = useState('');
  const save = useMutation({
    mutationFn: async (newTags: string[]): Promise<SlotRow> => {
      const res = await api.decks[':id'].slots[':slotId'].tags.$put({
        param: { id: String(deckId), slotId: String(slot.id) },
        json: { tags: newTags },
      });
      if (!res.ok) throw await failure(res, "Couldn't save the tags.");
      return res.json();
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<DeckView>(['decks', deckId], (view) =>
        view
          ? { ...view, slots: view.slots.map((row) => (row.id === saved.id ? saved : row)) }
          : view,
      );
      onClose();
    },
  });

  const add = (more: string[]) => {
    setTags((current) => {
      const next = [...current];
      for (const tag of more) {
        if (!next.some((have) => tagKey(have) === tagKey(tag))) next.push(tag);
      }
      return next;
    });
  };
  const addTyped = () => {
    add(typedTags(text));
    setText('');
  };

  const typed = tagKey(text);
  const suggestions =
    typed === ''
      ? []
      : deckTags.filter(
          (tag) =>
            tagKey(tag).includes(typed) && !tags.some((have) => tagKey(have) === tagKey(tag)),
        );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const all = [...tags];
    for (const tag of typedTags(text)) {
      if (!all.some((have) => tagKey(have) === tagKey(tag))) all.push(tag);
    }
    save.mutate(all);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{slot.card.name}</DialogTitle>
            <DialogDescription>
              Tags group and filter the deck view, and go to Moxfield with the deck.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label htmlFor={fieldId} className="font-semibold">
              Tags
            </label>
            {tags.length > 0 ? (
              <ul aria-label="Card tags" className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <li
                    key={tag}
                    className="flex items-center gap-1 rounded-md bg-muted py-0.5 pr-1 pl-2 font-medium text-[13px] text-muted-foreground"
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      onClick={() => setTags(tags.filter((have) => have !== tag))}
                      className="rounded p-0.5 hover:bg-[#e2e4e9] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">No tags yet.</p>
            )}
            <Input
              ref={field}
              id={fieldId}
              value={text}
              placeholder="Add a tag"
              autoComplete="off"
              onChange={(event) => {
                const value = event.target.value;
                // A comma ends a tag, typed or pasted.
                if (value.includes(',')) {
                  const parts = value.split(',');
                  add(typedTags(parts.slice(0, -1).join(',')));
                  setText(parts.at(-1) ?? '');
                } else {
                  setText(value);
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                // Enter adds the tag being typed; on an empty field it saves.
                if (text.trim() === '') return;
                event.preventDefault();
                addTyped();
              }}
              aria-invalid={save.isError || undefined}
              autoFocus
            />
            {suggestions.length > 0 && (
              <ul aria-label="Suggested tags" className="flex flex-wrap gap-1.5">
                {suggestions.map((tag) => (
                  <li key={tag}>
                    <button
                      type="button"
                      onClick={() => {
                        add([tag]);
                        setText('');
                        field.current?.focus();
                      }}
                      className="rounded-md border border-input bg-card px-2 py-0.5 font-medium text-[13px] hover:bg-[#f4f6fa] focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {tag}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {save.isError && (
              <p role="alert" className="text-destructive text-sm">
                {save.error.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Picks a new commander, or a partner, from a search limited to cards that can be commanders. */
function CommanderDialog({
  mode,
  commanders,
  onSave,
  onClose,
}: {
  mode: CommanderDialogMode;
  commanders: CardSummary[];
  onSave: (oracleIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = commanders.map((card) => card.oracleId);
  const replaced =
    mode.kind === 'change' ? commanders.find((c) => c.oracleId === mode.oracleId) : null;

  const pick = async (card: CardSearchResult) => {
    const oracleIds =
      mode.kind === 'change'
        ? current.map((id) => (id === mode.oracleId ? card.oracleId : id))
        : [...current, card.oracleId];
    setSaving(true);
    setError(null);
    try {
      await onSave(oracleIds);
      onClose();
    } catch (failed) {
      setError(failed instanceof Error ? failed.message : "Couldn't save the commanders.");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode.kind === 'change' ? 'Change commander' : 'Add a partner'}</DialogTitle>
          <DialogDescription>
            {replaced
              ? `Pick the commander that replaces ${replaced.name}. Cards outside the new colors show as warnings in the deck checks.`
              : 'Pick a second commander. The deck checks say whether the two can partner.'}
          </DialogDescription>
        </DialogHeader>
        <CardSearchPicker label="Commander" commander busy={saving} onPick={pick} autoFocus />
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------
// Side pane

// On wide screens the pane stays in view while the decklist scrolls with the page. The card
// preview stays pinned at its top; only the deck checks below it scroll when they run past
// the bottom of the window.
function SidePane({ slot, checks }: { slot: SlotRow | null; checks: DeckChecks | undefined }) {
  return (
    <aside
      aria-label="Card preview and deck checks"
      className="flex min-w-0 flex-[0_0_300px] flex-col gap-3.5 lg:sticky lg:top-3 lg:-m-1 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-hidden lg:p-1"
    >
      {slot && <CardPreview slot={slot} />}
      <Panel
        data-testid="deck-checks-panel"
        className="flex flex-col gap-2.5 px-4 py-3.5 lg:min-h-0 lg:overflow-y-auto"
      >
        <h2 className="font-bold text-[#2b303b] text-[13px] uppercase tracking-[0.05em]">
          Deck checks
        </h2>
        {!checks ? (
          <p className="text-[13px] text-muted-foreground">Checking the deck…</p>
        ) : checks.warnings.length === 0 ? (
          <p className="flex items-center gap-2 text-[13px] text-status-in-box">
            <CircleCheck aria-hidden="true" className="size-4" />
            No Commander rule problems.
          </p>
        ) : (
          <ul aria-label="Deck checks" className="flex flex-col gap-2 text-[13px]">
            {checks.warnings.map((warning) => (
              <li key={`${warning.kind}-${warning.message}`} className="flex items-start gap-2">
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-px size-4 shrink-0 text-status-other-decks"
                  strokeWidth={2.2}
                />
                {warning.message}
              </li>
            ))}
          </ul>
        )}
        {checks && checks.warnings.length > 0 && (
          <p className="text-[12px] text-muted-foreground">Warnings never block assembling.</p>
        )}
        {checks && checks.demand.length > 0 && (
          <>
            <h2 className="mt-1.5 font-bold text-[#2b303b] text-[13px] uppercase tracking-[0.05em]">
              Wanted by more decks than you own
            </h2>
            <ul aria-label="Demand warnings" className="flex flex-col gap-1.5 text-[13px]">
              {checks.demand.map((warning) => (
                <li key={warning.card.oracleId} className="flex flex-col">
                  <Link
                    to={`/cards/${warning.card.oracleId}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {warning.card.name}
                  </Link>
                  <span className="text-status-other-decks">{warning.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </aside>
  );
}

function CardPreview({ slot }: { slot: SlotRow }) {
  const image = cardImage(slot);
  return (
    <Panel
      role="region"
      aria-label="Card preview"
      className="flex shrink-0 flex-col gap-2.5 p-2.5 pb-3.5"
    >
      <div className="aspect-[488/680] overflow-hidden rounded-[4.75%/3.5%] bg-[#15161a]">
        {image ? (
          <img src={image} alt={slot.card.name} className="size-full object-contain" />
        ) : (
          <span className="flex size-full items-center justify-center p-4 text-center text-white">
            {slot.card.name}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 px-1.5">
        <span className="font-semibold">{slot.card.name}</span>
        <span className="text-[13px] text-muted-foreground">{slot.card.typeLine}</span>
        <Link
          to={`/cards/${slot.card.oracleId}`}
          className="flex items-center gap-1 font-semibold text-[13px] text-primary hover:underline"
        >
          Open card page
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
    </Panel>
  );
}
