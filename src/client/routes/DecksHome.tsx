import { useQuery } from '@tanstack/react-query';
import { Hammer, LayoutGrid, Library, MapPinPlus, Plus, Table2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { SlotStatus } from '../../shared/api/common';
import type { DeckCounts, DeckSummary } from '../../shared/api/decks';
import { api } from '../api';
import { DomainIcons } from '../components/DomainIcon';
import { Panel } from '../components/Panel';
import { deckStateLook, StatePill } from '../components/StatePill';
import { slotStatusLook } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

type View = 'tiles' | 'table';
const viewKey = 'decks-home-view';

/** The tiles or table choice, remembered in this browser. */
function useRememberedView() {
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(viewKey) === 'table' ? 'table' : 'tiles';
    } catch {
      return 'tiles';
    }
  });
  const choose = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(viewKey, next);
    } catch {
      // Not remembered, but the switch still works.
    }
  };
  return [view, choose] as const;
}

/**
 * The home screen: every deck (`/`), as tiles or a table, most recently opened first (the
 * server's order). With no decks it shows the ways to start.
 */
export function DecksHome() {
  const [view, setView] = useRememberedView();
  const decks = useQuery({
    queryKey: ['decks'],
    queryFn: async () => {
      const res = await api.decks.$get();
      if (!res.ok) throw new Error('The decks could not be loaded. Try again.');
      return res.json();
    },
  });
  const list = decks.data?.decks;

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-8 pt-8 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-[44px] leading-[1.05]">Decks</h1>
          {list && list.length > 0 && (
            <p className="text-[15px] text-muted-foreground">{summaryLine(list)}</p>
          )}
        </div>
        {list && list.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5">
            <ViewSwitch view={view} onChange={setView} />
            <NewDeckMenu />
          </div>
        )}
      </div>
      {decks.isPending ? (
        <p className="text-muted-foreground">Loading decks…</p>
      ) : decks.isError ? (
        <Panel role="alert" className="px-6 py-8 text-center text-status-missing">
          {decks.error.message}
        </Panel>
      ) : list && list.length > 0 ? (
        view === 'tiles' ? (
          <DeckTiles decks={list} />
        ) : (
          <DeckTable decks={list} />
        )
      ) : (
        <NoDecks />
      )}
    </div>
  );
}

function summaryLine(decks: DeckSummary[]) {
  const count = (state: DeckSummary['state']) => decks.filter((d) => d.state === state).length;
  const parts = (['assembled', 'partly_assembled', 'not_assembled'] as const)
    .filter((state) => count(state) > 0)
    .map((state) => `${count(state)} ${deckStateLook[state].word.toLowerCase()}`);
  return `${decks.length} ${decks.length === 1 ? 'deck' : 'decks'}. ${parts.join(', ')}.`;
}

function ViewSwitch({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const options: { value: View; label: string; icon: typeof LayoutGrid }[] = [
    { value: 'tiles', label: 'Tiles', icon: LayoutGrid },
    { value: 'table', label: 'Table', icon: Table2 },
  ];
  return (
    <fieldset className="flex h-10 overflow-hidden rounded-lg border border-input bg-card">
      <legend className="sr-only">View</legend>
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => onChange(value)}
          className={cn(
            'flex items-center gap-1.5 px-3 font-medium text-muted-foreground',
            view === value && 'bg-primary/10 font-semibold text-primary',
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </button>
      ))}
    </fieldset>
  );
}

function NewDeckMenu() {
  return (
    <Button asChild>
      <Link to="/decks/new">
        <Plus aria-hidden="true" />
        New deck
      </Link>
    </Button>
  );
}

/** The four parts of the availability bar, in order, with StatusBadge's words and colors. */
const barParts: { key: keyof Omit<DeckCounts, 'runes'>; status: SlotStatus; fill: string }[] = [
  { key: 'inBox', status: 'in_box', fill: 'bg-status-in-box-fill' },
  { key: 'free', status: 'free', fill: 'bg-status-free-fill' },
  { key: 'otherDecks', status: 'other_decks', fill: 'bg-status-other-decks-fill' },
  { key: 'missing', status: 'missing', fill: 'bg-status-missing-fill' },
];

function AvailabilityBar({ counts }: { counts: DeckCounts }) {
  const total = barParts.reduce((sum, part) => sum + counts[part.key], 0);
  const label = barParts
    .map((part) => `${counts[part.key]} ${slotStatusLook[part.status].word.toLowerCase()}`)
    .join(', ');
  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={label}
        className="flex h-2 overflow-hidden rounded-full bg-muted"
        data-testid="availability-bar"
      >
        {barParts.map((part) =>
          counts[part.key] > 0 ? (
            <div
              key={part.key}
              className={part.fill}
              style={{ width: `${(counts[part.key] / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
        {barParts.map((part) => (
          <li key={part.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('size-2 rounded-full', part.fill)} />
            <strong className="text-foreground">{counts[part.key]}</strong>
            {slotStatusLook[part.status].word.toLowerCase()}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Opened today", "Opened 3 days ago", or the date for older ones. */
function openedLabel(openedAt: string | null) {
  if (!openedAt) return 'Never opened';
  const opened = new Date(openedAt);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(opened)) / 86_400_000);
  if (days <= 0) return 'Opened today';
  if (days === 1) return 'Opened yesterday';
  if (days < 7) return `Opened ${days} days ago`;
  return `Opened ${opened.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function legendNames(deck: DeckSummary) {
  return [deck.legend, deck.champion].flatMap((card) => (card ? [card.name] : [])).join(' and ');
}

function DeckTiles({ decks }: { decks: DeckSummary[] }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-5">
      {decks.map((deck) => (
        <li key={deck.id}>
          <Link
            to={`/decks/${deck.id}`}
            data-testid="deck-tile"
            className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground transition-shadow hover:border-[#9fb3e6] hover:shadow-[0_6px_18px_rgba(23,26,33,0.10)]"
          >
            <div className="flex h-[260px] items-center justify-center gap-2 bg-muted p-3">
              {[deck.legend, deck.champion]
                .flatMap((card) => (card ? [card] : []))
                .map((card) =>
                  card.imageUrl ? (
                    <img
                      key={card.id}
                      src={card.imageUrl}
                      alt={card.name}
                      loading="lazy"
                      className="h-full min-w-0 rounded-[4.75%/3.5%] object-contain"
                    />
                  ) : (
                    <span
                      key={card.id}
                      className="flex aspect-[488/680] h-full items-center justify-center rounded-lg border border-border bg-card p-3 text-center font-serif text-lg"
                    >
                      {card.name}
                    </span>
                  ),
                )}
            </div>
            <div className="flex flex-1 flex-col gap-3 px-[18px] pt-3.5 pb-4">
              <div className="flex flex-col gap-0.5">
                <h2 className="font-serif text-[26px] leading-[1.1]">{deck.name}</h2>
                <p className="text-[13px] text-muted-foreground">{legendNames(deck)}</p>
              </div>
              <div className="flex items-center justify-between gap-2">
                <DomainIcons domains={deck.domains} className="text-[15px]" />
                <StatePill state={deck.state} />
              </div>
              <AvailabilityBar counts={deck.counts} />
              <p className="mt-auto border-border border-t pt-2.5 text-muted-foreground text-xs">
                {openedLabel(deck.openedAt)}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DeckTable({ decks }: { decks: DeckSummary[] }) {
  const head = 'border-border border-b px-2 py-3 font-semibold';
  const cell = 'border-border border-b px-2 py-3';
  const num = 'text-right tabular-nums';
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-collapse">
        <thead>
          <tr className="text-left text-muted-foreground text-xs uppercase tracking-[0.04em]">
            <th className={cn(head, 'pl-4')}>Name</th>
            <th className={head}>Legend</th>
            <th className={head}>Domains</th>
            <th className={head}>State</th>
            <th className={cn(head, num)}>In box</th>
            <th className={cn(head, num)}>Free</th>
            <th className={cn(head, num)}>In other decks</th>
            <th className={cn(head, num)}>Missing</th>
            <th className={cn(head, 'pr-4')}>Last opened</th>
          </tr>
        </thead>
        <tbody>
          {decks.map((deck) => (
            <tr key={deck.id} className="hover:bg-[#f6f8fb]">
              <td className={cn(cell, 'pl-4')}>
                <Link to={`/decks/${deck.id}`} className="font-semibold text-primary">
                  {deck.name}
                </Link>
              </td>
              <td className={cell}>{legendNames(deck)}</td>
              <td className={cell}>
                <DomainIcons domains={deck.domains} className="text-[15px]" />
              </td>
              <td className={cell}>
                <StatePill state={deck.state} />
              </td>
              <td className={cn(cell, num)}>{deck.counts.inBox}</td>
              <td className={cn(cell, num)}>{deck.counts.free}</td>
              <td className={cn(cell, num)}>{deck.counts.otherDecks}</td>
              <td className={cn(cell, num)}>{deck.counts.missing}</td>
              <td className={cn(cell, 'pr-4 text-muted-foreground')}>
                {openedLabel(deck.openedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** Whether any location exists, to pick the empty state. */
function useHasLocations() {
  return useQuery({
    queryKey: ['locations', 'tree'],
    queryFn: async () => {
      const res = await api.locations.tree.$get();
      if (!res.ok) throw new Error('The locations could not be loaded.');
      return res.json();
    },
    select: (tree) => tree.nodes.length > 0,
  });
}

function NoDecks() {
  const hasLocations = useHasLocations().data === true;
  return (
    <Panel className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <Library aria-hidden="true" className="size-10 text-muted-foreground" strokeWidth={1.6} />
      <div className="flex flex-col gap-1">
        <h2 className="font-bold text-lg">
          {hasLocations ? 'No decks yet' : 'Start with where your cards live'}
        </h2>
        <p className="max-w-[600px] text-[15px] text-muted-foreground">
          {hasLocations
            ? 'Build a deck in the app, or add more locations and cards first.'
            : 'Create a location for each box and binder, then add your cards to them.'}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2.5">
        {hasLocations && (
          <Button asChild>
            <Link to="/decks/new">
              <Hammer aria-hidden="true" />
              Build a deck
            </Link>
          </Button>
        )}
        <Button asChild variant={hasLocations ? 'outline' : 'default'}>
          <Link to="/locations">
            <MapPinPlus aria-hidden="true" />
            Create a location
          </Link>
        </Button>
      </div>
    </Panel>
  );
}
