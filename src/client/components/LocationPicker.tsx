import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { ErrorBody, type Id } from '../../shared/api/common';
import type { LocationNode, LocationTree } from '../../shared/api/locations';
import { api } from '../api';
import { cn } from '../lib/utils';
import { LocationTile } from './LocationTile';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from './ui/command';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

/** The query key for GET /api/locations/tree; anything that changes locations refreshes it. */
export const LOCATION_TREE_QUERY_KEY = ['locations', 'tree'];

/** The location tree, shared by every screen and picker that shows locations. */
export function useLocationTree() {
  return useQuery({
    queryKey: LOCATION_TREE_QUERY_KEY,
    queryFn: async (): Promise<LocationTree> => {
      const res = await api.locations.tree.$get();
      if (!res.ok) {
        const body = ErrorBody.safeParse(await res.json().catch(() => null));
        throw new Error(body.success ? body.data.error.message : "Couldn't load the locations.");
      }
      return res.json();
    },
  });
}

export type LocationPickerProps = {
  /** The picked location, or null for none yet. */
  value: Id | null;
  onChange: (locationId: Id) => void;
  /** Leave out deck boxes, such as when picking where copies go back to. */
  excludeDeckBoxes?: boolean;
  /** Locations that can't be picked, such as where the copies already are. */
  excludeIds?: Id[];
  placeholder?: string;
  /** For a `<label htmlFor>` naming the picker. */
  id?: string;
  disabled?: boolean;
};

/** Matches the typed text against a location's name and path, ignoring case. */
function matches(node: LocationNode, search: string) {
  const text = search.trim().toLowerCase();
  return node.name.toLowerCase().includes(text) || node.path.toLowerCase().includes(text);
}

/**
 * Picks a location from the tree in a popover: each row shows the location's tile, its name
 * and its depth, and typing narrows the rows to locations whose name or path matches.
 */
export function LocationPicker({
  value,
  onChange,
  excludeDeckBoxes = false,
  excludeIds = [],
  placeholder = 'Pick a location',
  id,
  disabled,
}: LocationPickerProps) {
  const tree = useLocationTree();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const nodes = tree.data?.nodes ?? [];
  const selected = nodes.find((node) => node.id === value);
  const choices = nodes.filter(
    (node) =>
      !(excludeDeckBoxes && node.type === 'deck_box') &&
      !excludeIds.includes(node.id) &&
      (search.trim() === '' || matches(node, search)),
  );
  const searching = search.trim() !== '';

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSearch('');
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selected ? (
            <>
              <LocationTile type={selected.type} color={selected.effectiveColor} size="sm" />
              <span className="truncate">{selected.path}</span>
            </>
          ) : (
            <span className="truncate text-muted-foreground">
              {value !== null && tree.isPending ? 'Loading…' : placeholder}
            </span>
          )}
          <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-[280px] overflow-hidden p-0"
      >
        {/* The rows keep tree order, so the picker filters them itself rather than cmdk. */}
        <Command label="Search locations" shouldFilter={false} className="bg-popover">
          <CommandInput value={search} onValueChange={setSearch} placeholder="Search locations" />
          <CommandList aria-label="Locations">
            {tree.isPending ? (
              <p className="py-6 text-center text-muted-foreground text-sm">Loading locations…</p>
            ) : tree.isError ? (
              <p role="alert" className="px-3 py-6 text-center text-sm text-status-missing">
                {tree.error.message}
              </p>
            ) : (
              <>
                <CommandEmpty>No location matches “{search.trim()}”.</CommandEmpty>
                {choices.map((node) => (
                  <CommandItem
                    key={node.id}
                    value={String(node.id)}
                    data-location-id={node.id}
                    onSelect={() => {
                      onChange(node.id);
                      setOpen(false);
                      setSearch('');
                    }}
                    // Indented by depth in the tree; flat while searching, where the path shows.
                    style={{ paddingLeft: 8 + (searching ? 0 : node.depth * 18) }}
                    className="m-1 min-h-9 rounded-md"
                  >
                    <LocationTile type={node.type} color={node.effectiveColor} size="sm" />
                    <span className="truncate">{searching ? node.path : node.name}</span>
                    <Check
                      aria-hidden="true"
                      className={cn(
                        'ml-auto size-4 text-primary',
                        node.id === value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
