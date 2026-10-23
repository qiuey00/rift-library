import { Check, ChevronRight, MoreHorizontal } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Link } from 'react-router';
import type { Id } from '../../../shared/api/common';
import type { DeckSummary } from '../../../shared/api/decks';
import type { LocationNode } from '../../../shared/api/locations';
import { formatCents } from '../../lib/money';
import { cn } from '../../lib/utils';
import { LocationTile } from '../LocationTile';
import { Panel } from '../Panel';
import { StatePill } from '../StatePill';
import { TradeTag } from '../TradeTag';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Switch } from '../ui/switch';
import {
  locationColors,
  neighbours,
  sectionTitles,
  type TreeGroups,
  type TreeSection,
} from './tree';

/** What a location's ⋯ menu asks the screen to do. */
export type LocationMenuAction =
  | { kind: 'rename' | 'move-contents' | 'delete' | 'export'; location: LocationNode }
  | { kind: 'color'; location: LocationNode; color: string | null }
  | { kind: 'for-trade'; location: LocationNode; forTrade: boolean }
  | { kind: 'move'; location: LocationNode; position: number };

/**
 * The left pane of the Locations screen: the "To sort" inbox pinned on top, then the Storage,
 * Trade binders and Deck boxes sections, each collapsible, with locations indented by depth.
 */
export function LocationTreePanel({
  groups,
  decks,
  selectedId,
  onSelect,
  onAction,
}: {
  groups: TreeGroups;
  decks: DeckSummary[];
  selectedId: Id | undefined;
  onSelect: (id: Id) => void;
  onAction: (action: LocationMenuAction) => void;
}) {
  const row = (node: LocationNode, group: LocationNode[], section: TreeSection | 'inbox') => (
    <TreeRow
      key={node.id}
      node={node}
      group={group}
      section={section}
      // Matched by the box's own deck, so only a deck's box shows a deck's name and state.
      deck={node.deck ? decks.find((deck) => deck.id === node.deck?.id) : undefined}
      selected={node.id === selectedId}
      onSelect={onSelect}
      onAction={onAction}
    />
  );

  return (
    <Panel className="flex flex-col gap-1 p-2">
      {groups.inbox && <ul aria-label="Inbox">{row(groups.inbox, [], 'inbox')}</ul>}
      <div className="mx-2 my-1 border-border border-t" />
      <TreeSectionList section="storage">
        {groups.storage.map((node) => row(node, groups.storage, 'storage'))}
        {groups.storage.length === 0 && (
          <li className="px-3 py-2 text-muted-foreground text-sm">
            No locations yet. Add a box, binder or tray.
          </li>
        )}
      </TreeSectionList>
      {groups.trade.length > 0 && (
        <TreeSectionList section="trade">
          {groups.trade.map((node) => row(node, groups.trade, 'trade'))}
        </TreeSectionList>
      )}
      {groups.deckBoxes.length > 0 && (
        <TreeSectionList section="deckBoxes">
          {groups.deckBoxes.map((node) => row(node, groups.deckBoxes, 'deckBoxes'))}
        </TreeSectionList>
      )}
    </Panel>
  );
}

const sectionKey = (section: TreeSection) => `locations-section-${section}`;

function readOpen(section: TreeSection): boolean {
  try {
    return localStorage.getItem(sectionKey(section)) !== 'closed';
  } catch {
    return true;
  }
}

function writeOpen(section: TreeSection, open: boolean) {
  try {
    localStorage.setItem(sectionKey(section), open ? 'open' : 'closed');
  } catch {
    // Storage can be blocked; the section still opens and closes for this visit.
  }
}

/** A section of the tree under a header button that opens and closes it, remembered per viewer. */
function TreeSectionList({ section, children }: { section: TreeSection; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(() => readOpen(section));
  const toggle = () => {
    setOpen(!open);
    writeOpen(section, !open);
  };
  return (
    <div className="mt-2 flex flex-col first-of-type:mt-0">
      <h2 id={`${id}-heading`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          onClick={toggle}
          className="flex w-full items-center gap-1 rounded-lg px-2 py-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn('size-3.5 transition-transform', open && 'rotate-90')}
          />
          {sectionTitles[section]}
        </button>
      </h2>
      {open && (
        <ul id={`${id}-list`} aria-labelledby={`${id}-heading`}>
          {children}
        </ul>
      )}
    </div>
  );
}

function TreeRow({
  node,
  group,
  section,
  deck,
  selected,
  onSelect,
  onAction,
}: {
  node: LocationNode;
  group: LocationNode[];
  section: TreeSection | 'inbox';
  deck: DeckSummary | undefined;
  selected: boolean;
  onSelect: (id: Id) => void;
  onAction: (action: LocationMenuAction) => void;
}) {
  // A deck's box is labelled with the deck's name.
  const label = deck?.name ?? node.deck?.name ?? node.name;
  return (
    <li
      data-location-id={node.id}
      className={cn(
        'flex items-center gap-1 rounded-lg pr-1',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(node.id)}
        className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pr-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        style={{ paddingLeft: 10 + node.depth * 18 }}
      >
        <LocationTile type={node.type} color={node.effectiveColor} size="sm" />
        <span className={cn('truncate', selected && 'font-semibold')}>{label}</span>
        {deck && <StatePill state={deck.state} />}
        {/* Trade locations under Storage are tagged; the Trade binders section says it already. */}
        {section === 'storage' && node.forTrade && <TradeTag className="shrink-0" />}
        <span
          data-testid="location-count"
          className="ml-auto pl-2 text-muted-foreground text-sm tabular-nums"
        >
          {node.totalCount.toLocaleString('en-US')}
        </span>
        <span
          data-testid="location-value"
          className="shrink-0 text-muted-foreground text-xs tabular-nums"
        >
          {formatCents(node.value)}
        </span>
      </button>
      <LocationMenu node={node} group={group} section={section} onAction={onAction} />
    </li>
  );
}

function LocationMenu({
  node,
  group,
  section,
  onAction,
}: {
  node: LocationNode;
  group: LocationNode[];
  section: TreeSection | 'inbox';
  onAction: (action: LocationMenuAction) => void;
}) {
  const inbox = node.type === 'inbox';
  // Binders, boxes and trays can be for trade and exported; the inbox and deck boxes can't.
  const tradeable = section === 'storage' || section === 'trade';
  // A deck's own box goes when the deck is deleted, so it has no Delete here.
  const deletable = !inbox && node.deck === null;
  const { before, after } = neighbours(group, node);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More for ${node.name}`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {!inbox && (
          <>
            <DropdownMenuItem onSelect={() => onAction({ kind: 'rename', location: node })}>
              Rename
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Color</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-40">
                {locationColors.map((color) => (
                  <DropdownMenuItem
                    key={color.value}
                    onSelect={() => onAction({ kind: 'color', location: node, color: color.value })}
                  >
                    <span
                      aria-hidden="true"
                      className="size-4 rounded-[4px]"
                      style={{ backgroundColor: color.value }}
                    />
                    {color.name}
                    {node.color === color.value && <Check className="ml-auto" aria-hidden="true" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => onAction({ kind: 'color', location: node, color: null })}
                >
                  <span
                    aria-hidden="true"
                    className="size-4 rounded-[4px] border border-border bg-location-none"
                  />
                  None
                  {node.color === null && <Check className="ml-auto" aria-hidden="true" />}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {tradeable && (
              <DropdownMenuCheckboxItem
                checked={node.markedForTrade}
                onCheckedChange={(forTrade) =>
                  onAction({ kind: 'for-trade', location: node, forTrade })
                }
                className="pl-2 [&>span:first-child]:hidden"
              >
                For trade
                <Switch
                  aria-hidden="true"
                  tabIndex={-1}
                  checked={node.markedForTrade}
                  className="pointer-events-none ml-auto"
                />
              </DropdownMenuCheckboxItem>
            )}
            <DropdownMenuItem
              disabled={!before}
              onSelect={() =>
                before && onAction({ kind: 'move', location: node, position: before.position })
              }
            >
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!after}
              onSelect={() =>
                after && onAction({ kind: 'move', location: node, position: after.position })
              }
            >
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          disabled={node.totalCount === 0}
          onSelect={() => onAction({ kind: 'move-contents', location: node })}
        >
          Move contents
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`/history?location=${node.id}`}>History</Link>
        </DropdownMenuItem>
        {tradeable && (
          <DropdownMenuItem onSelect={() => onAction({ kind: 'export', location: node })}>
            Export to Moxfield
          </DropdownMenuItem>
        )}
        {deletable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onAction({ kind: 'delete', location: node })}
            >
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
