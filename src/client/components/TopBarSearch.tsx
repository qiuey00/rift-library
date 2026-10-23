import { Search } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CardSearchResult } from '../../shared/api/cards';
import { useCardDataReady } from '../lib/card-data';
import { useCardSearch } from '../lib/cards';
import { cn } from '../lib/utils';
import { ManaCost } from './ManaCost';

/** How long typing pauses before the box asks for results. */
const TYPING_PAUSE_MS = 150;

/** True when the key press happened in a field that takes text, where `/` is just a slash. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(
    target.type,
  );
}

/**
 * The card search box in the top bar, on every screen. Typing lists matching cards with
 * how many Jeff owns and how many are free; ↑/↓ move, Enter opens the card's page, Esc
 * closes the list. `/` jumps to the box from anywhere but a text field.
 */
export function TopBarSearch() {
  const navigate = useNavigate();
  const ready = useCardDataReady();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const search = useCardSearch(ready ? query : '');
  const results = search.data?.results ?? [];
  const typed = text.trim() !== '';
  const showList = open && typed;
  const settled = query === text && !search.isPlaceholderData && !search.isFetching;

  // A new list starts at its best match.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the results change
  useEffect(() => setActive(0), [search.data]);

  const openCard = (card: CardSearchResult) => {
    setOpen(false);
    setText('');
    setQuery('');
    inputRef.current?.blur();
    navigate(`/cards/${card.oracleId}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (showList) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!showList) {
        setOpen(true);
        return;
      }
      if (results.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const card = showList ? results[active] : undefined;
      if (card) openCard(card);
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;
  const listHasOptions = showList && ready && results.length > 0;

  return (
    <div className="relative w-full">
      <label className="flex h-[38px] w-full items-center gap-2 rounded-lg border border-[#353b4a] bg-top-bar-field px-2.5 focus-within:border-[#4b6fd0]">
        <Search aria-hidden="true" className="size-4 shrink-0 text-top-bar-muted" />
        <span className="sr-only">Search cards</span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          placeholder="Search cards"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={listHasOptions}
          aria-controls={listId}
          aria-activedescendant={listHasOptions ? optionId(active) : undefined}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-[#f1f2f5] text-sm outline-none placeholder:text-top-bar-muted"
        />
        <span
          aria-hidden="true"
          className="rounded border border-[#454c5c] px-1.5 text-top-bar-muted text-xs"
        >
          /
        </span>
      </label>

      {showList && (
        <div className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground text-sm shadow-[0_10px_28px_rgba(15,18,25,0.12)]">
          {!ready ? (
            <p role="status" className="px-3.5 py-3">
              Card data is loading
            </p>
          ) : search.isError ? (
            <p role="alert" className="px-3.5 py-3 text-destructive">
              {search.error.message}
            </p>
          ) : results.length === 0 ? (
            <p role="status" className="px-3.5 py-3 text-muted-foreground">
              {settled ? `No cards match “${text.trim()}”` : 'Searching…'}
            </p>
          ) : null}
          {/* Mouse down picks before the box's blur closes the list. */}
          <div
            id={listId}
            role="listbox"
            aria-label="Cards"
            hidden={!listHasOptions}
            className="max-h-[420px] overflow-y-auto py-1"
          >
            {listHasOptions &&
              results.map((card, i) => (
                <div
                  key={card.oracleId}
                  id={optionId(i)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === active}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    openCard(card);
                  }}
                  onMouseMove={() => setActive(i)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-3 py-1.5',
                    i === active && 'bg-[#eef3fe]',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold">{card.name}</span>
                      <ManaCost cost={card.manaCost} className="text-xs" />
                    </span>
                    <span className="truncate text-muted-foreground text-xs">{card.typeLine}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums">
                    <span className="block font-semibold">{card.owned} owned</span>
                    <span className="block text-muted-foreground">{card.free} free</span>
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
