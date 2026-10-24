import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { CardSearchResponse, CardSearchResult } from '../../shared/api/cards';
import { type CardType, type Domain, ErrorBody } from '../../shared/api/common';
import { api } from '../api';
import { TYPE_WORDS, typeLine } from '../lib/card-text';
import { DomainIcons } from './DomainIcon';

export type CardSearchPickerProps = {
  /** The field's label, such as "Legend". */
  label: string;
  placeholder?: string;
  /** Only cards of this type. */
  type?: CardType;
  /** Only cards whose domains all fit inside these; cards with no domain always fit. */
  domains?: Domain[];
  /** Called with the card Jeff picks; the field clears for the next search. */
  onPick: (card: CardSearchResult) => void;
  /** Disables the results while the pick is being saved. */
  busy?: boolean;
  autoFocus?: boolean;
};

/** How long typing must pause before the search runs. */
const DEBOUNCE_MS = 200;

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

/** A card search field with its results listed below it: picking a result calls `onPick`. */
export function CardSearchPicker({
  label,
  placeholder = 'Search by card name',
  type,
  domains,
  onPick,
  busy = false,
  autoFocus,
}: CardSearchPickerProps) {
  const fieldId = useId();
  const resultsId = useId();
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());

  const search = useQuery({
    queryKey: ['cards', 'search', { q, type, domains }],
    enabled: q !== '',
    queryFn: async (): Promise<CardSearchResponse> => {
      const res = await api.cards.$get({
        query: {
          q,
          ...(type ? { type } : {}),
          ...(domains !== undefined ? { domains: domains.join(',') } : {}),
        },
      });
      if (!res.ok) {
        const body = ErrorBody.safeParse(await res.json().catch(() => null));
        throw new Error(body.success ? body.data.error.message : "Couldn't search the cards.");
      }
      return res.json();
    },
  });

  const pick = (card: CardSearchResult) => {
    onPick(card);
    setText('');
  };

  let message: string | null = null;
  if (q !== '') {
    if (search.isError) message = search.error.message;
    else if (!search.data) message = 'Searching…';
    else if (search.data.results.length === 0)
      message = type ? `No ${TYPE_WORDS[type].toLowerCase()}s match.` : 'No cards match.';
  }
  const results = q !== '' ? (search.data?.results ?? []) : [];

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="font-semibold">
        {label}
      </label>
      <div className="flex h-10 items-center gap-2 rounded-lg border border-input bg-card px-3 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <input
          id={fieldId}
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={placeholder}
          aria-controls={resultsId}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: opened on purpose to search right away
          autoFocus={autoFocus}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {message && (
        <p role="status" className="px-1 text-[13px] text-muted-foreground">
          {message}
        </p>
      )}
      {results.length > 0 && (
        <ul
          id={resultsId}
          aria-label={`${label} results`}
          className="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-[0_8px_24px_rgba(23,26,33,0.12)]"
        >
          {results.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => pick(card)}
                aria-label={card.name}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2.5 py-1.5 text-left hover:bg-[#f3f6fb] focus-visible:bg-[#f3f6fb] focus-visible:outline-none disabled:opacity-50"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{card.name}</span>
                  <span className="truncate text-[12px] text-muted-foreground">
                    {typeLine(card)} · {card.owned} owned, {card.free} free
                  </span>
                </span>
                <DomainIcons domains={card.domains} className="text-xs" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
