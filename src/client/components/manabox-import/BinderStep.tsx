import { Ban, BookOpen, Box, List, Plus, X } from 'lucide-react';
import { useId } from 'react';
import type { Id } from '../../../shared/api/common';
import type { ManaBoxBinder, NewLocation } from '../../../shared/api/manabox';
import { LocationPicker } from '../LocationPicker';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { type BinderChoice, type ImportDraft, plural, type StepProps } from './draft';
import { cardsToAdd } from './PreviewStep';
import { ProxyOption } from './ProxyOption';

/** The types a new location can have here: a deck box belongs to a deck, and there's one inbox. */
const NEW_LOCATION_TYPES = [
  { value: 'binder', label: 'Binder' },
  { value: 'box', label: 'Box' },
  { value: 'tray', label: 'Tray' },
] as const satisfies { value: NewLocation['type']; label: string }[];

const KIND_LABELS = { binder: 'Binder', deck: 'Deck', list: 'List' } as const;
const KIND_ICONS = { binder: BookOpen, deck: Box, list: List } as const;

/** The binders and decks the import adds; lists hold cards Jeff doesn't own. */
function importedBinders(draft: ImportDraft): ManaBoxBinder[] {
  return (draft.preview?.binders ?? []).filter((binder) => binder.type !== 'list');
}

/** Where a binder goes: Jeff's choice on this step, else its remembered location. */
function destinationOf(draft: ImportDraft, binder: ManaBoxBinder): BinderChoice | null {
  const choice = draft.binderChoices[binder.key];
  if (choice) return choice;
  return binder.mappedLocation ? { kind: 'existing', locationId: binder.mappedLocation.id } : null;
}

/** Why the binder step can't go on: a binder or deck with no destination, or an unnamed one. */
export function binderBlocker(draft: ImportDraft): string | null {
  const binders = importedBinders(draft);
  const unmapped = binders.filter((binder) => destinationOf(draft, binder) === null);
  if (unmapped.length === 1) return `Pick where ${unmapped[0].name} goes first.`;
  if (unmapped.length > 1)
    return `Pick a location for the ${unmapped.length} binders and decks without one first.`;
  const unnamed = binders.find((binder) => {
    const choice = destinationOf(draft, binder);
    return choice?.kind === 'new' && choice.location.name.trim() === '';
  });
  return unnamed ? `Name the new location for ${unnamed.name} first.` : null;
}

/** The confirm button for a file with binders, such as "Add 1,204 cards to 6 locations". */
export function binderConfirmLabel(draft: ImportDraft): string {
  const listCards = (draft.preview?.binders ?? [])
    .filter((binder) => binder.type === 'list')
    .reduce((sum, binder) => sum + binder.cardCount, 0);
  const cards = Math.max(0, cardsToAdd(draft) - listCards);
  const choices = importedBinders(draft).map((binder) => destinationOf(draft, binder));
  const existing = new Set(choices.flatMap((c) => (c?.kind === 'existing' ? [c.locationId] : [])));
  const created = choices.filter((c) => c?.kind === 'new').length;
  return `Add ${plural(cards, 'card')} to ${plural(existing.size + created, 'location')}`;
}

/** What the apply request sends for a file with binders, in place of `targetLocationId`. */
export function binderApplyFields(draft: ImportDraft) {
  const destinations: Record<string, Id> = {};
  const newLocations: Record<string, NewLocation> = {};
  for (const binder of importedBinders(draft)) {
    const choice = destinationOf(draft, binder);
    if (choice?.kind === 'existing') destinations[binder.key] = choice.locationId;
    if (choice?.kind === 'new') {
      newLocations[binder.key] = { ...choice.location, name: choice.location.name.trim() };
    }
  }
  return { destinations, newLocations };
}

/** Step 2 for a file with a Binder Name column: where each ManaBox binder and deck goes. */
export function BinderStep({ draft, change }: StepProps) {
  const preview = draft.preview;
  if (!preview) return null;

  const choose = (binder: ManaBoxBinder, choice: BinderChoice | null) => {
    const binderChoices = { ...draft.binderChoices };
    delete binderChoices[binder.key];
    if (choice) binderChoices[binder.key] = choice;
    change({ binderChoices });
  };

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="manabox-binders-title" className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-0.5">
          <h2 id="manabox-binders-title" className="font-bold text-[15px]">
            Where should each ManaBox binder go?
          </h2>
          <p className="text-[13px] text-muted-foreground">
            This file has a Binder Name column, so each ManaBox binder and deck can land in its own
            location. The app remembers these choices for the next import.
          </p>
        </div>
        <div className="overflow-x-auto rounded-[10px] border border-border">
          <table aria-labelledby="manabox-binders-title" className="w-full border-collapse">
            <thead className="bg-[#f6f7f9] text-left text-muted-foreground text-xs uppercase tracking-[0.04em]">
              <tr>
                <th scope="col" className="px-3.5 py-2 font-semibold">
                  In ManaBox
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  Cards
                </th>
                <th scope="col" className="px-3.5 py-2 pl-2 font-semibold">
                  Goes to
                </th>
              </tr>
            </thead>
            <tbody>
              {preview.binders.map((binder) => (
                <BinderRow
                  key={binder.key}
                  binder={binder}
                  choice={destinationOf(draft, binder)}
                  onChoose={(choice) => choose(binder, choice)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {!preview.hasProxyColumn && (
        <ProxyOption
          checked={draft.allProxies}
          onChange={(allProxies) => change({ allProxies })}
          cardCount={preview.cardCount}
        />
      )}
    </div>
  );
}

function BinderRow({
  binder,
  choice,
  onChoose,
}: {
  binder: ManaBoxBinder;
  choice: BinderChoice | null;
  onChoose: (choice: BinderChoice | null) => void;
}) {
  const skipped = binder.type === 'list';
  const Icon = KIND_ICONS[binder.type];
  const kind = KIND_LABELS[binder.type];

  return (
    <tr
      aria-label={`${binder.name} (${kind})`}
      className={skipped ? 'border-[#eceef2] border-t bg-[#fafbfc]' : 'border-[#eceef2] border-t'}
    >
      <td className="px-3.5 py-2.5 align-top">
        <span className="flex min-h-10 items-center gap-2">
          <Icon
            aria-hidden="true"
            className={skipped ? 'size-4 text-[#8a909c]' : 'size-4 text-[#2b303b]'}
          />
          <span className={skipped ? 'font-semibold text-muted-foreground' : 'font-semibold'}>
            {binder.name}
          </span>
          <span className="rounded-full border border-[#c9ced6] px-[7px] text-muted-foreground text-xs">
            {kind}
          </span>
        </span>
      </td>
      <td
        className={
          skipped
            ? 'px-2 py-2.5 align-top text-muted-foreground tabular-nums'
            : 'px-2 py-2.5 align-top tabular-nums'
        }
      >
        <span className="flex min-h-10 items-center">
          {binder.cardCount.toLocaleString('en-US')}
        </span>
      </td>
      <td className="px-3.5 py-2.5 pl-2 align-top">
        {skipped ? (
          <span className="flex min-h-10 items-center gap-2 text-[13px] text-muted-foreground">
            <Ban aria-hidden="true" className="size-4" />
            Skipped: cards you don't own
          </span>
        ) : choice?.kind === 'new' ? (
          <NewLocationFields
            binder={binder}
            location={choice.location}
            onChange={(location) => onChoose({ kind: 'new', location })}
            onCancel={() => onChoose(null)}
          />
        ) : (
          <ExistingLocation
            binder={binder}
            locationId={choice?.locationId ?? null}
            onChoose={onChoose}
          />
        )}
      </td>
    </tr>
  );
}

function ExistingLocation({
  binder,
  locationId,
  onChoose,
}: {
  binder: ManaBoxBinder;
  locationId: Id | null;
  onChoose: (choice: BinderChoice) => void;
}) {
  const id = useId();
  const remembered = locationId !== null && locationId === binder.mappedLocation?.id;
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2.5">
        <label htmlFor={id} className="sr-only">
          Location for {binder.name}
        </label>
        <span className="w-[240px]">
          <LocationPicker
            id={id}
            value={locationId}
            onChange={(picked) => onChoose({ kind: 'existing', locationId: picked })}
            excludeDeckBoxes
            placeholder="Pick where they go"
          />
        </span>
        <Button
          variant="outline"
          aria-label={`New location for ${binder.name}`}
          onClick={() => onChoose({ kind: 'new', location: { name: binder.name, type: 'binder' } })}
        >
          <Plus aria-hidden="true" />
          New location
        </Button>
      </span>
      {remembered && (
        <span className="flex items-center gap-1.5 text-status-in-box text-xs">
          <span className="rounded-full bg-status-in-box-soft px-2 py-0.5 font-semibold">
            Remembered
          </span>
          from the last import
        </span>
      )}
    </span>
  );
}

function NewLocationFields({
  binder,
  location,
  onChange,
  onCancel,
}: {
  binder: ManaBoxBinder;
  location: NewLocation;
  onChange: (location: NewLocation) => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">New location for {binder.name}</legend>
      <span className="flex flex-wrap items-end gap-2.5">
        <span className="flex w-[200px] flex-col gap-1">
          <label htmlFor={`${id}-name`} className="font-medium text-muted-foreground text-xs">
            Name
          </label>
          <Input
            id={`${id}-name`}
            value={location.name}
            aria-invalid={location.name.trim() === '' || undefined}
            onChange={(event) => onChange({ ...location, name: event.target.value })}
          />
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-type`} className="font-medium text-muted-foreground text-xs">
            Type
          </label>
          <NativeSelect
            id={`${id}-type`}
            value={location.type}
            onChange={(event) =>
              onChange({ ...location, type: event.target.value as NewLocation['type'] })
            }
          >
            {NEW_LOCATION_TYPES.map((type) => (
              <NativeSelectOption key={type.value} value={type.value}>
                {type.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </span>
        <span className="whitespace-nowrap rounded-full bg-[#e8eefc] px-2 py-0.5 font-semibold text-[#1b3f9c] text-xs">
          New location
        </span>
      </span>
      <span className="flex flex-wrap items-end gap-2.5">
        <span className="flex w-[240px] flex-col gap-1">
          <label htmlFor={`${id}-parent`} className="font-medium text-muted-foreground text-xs">
            Inside (optional)
          </label>
          <LocationPicker
            id={`${id}-parent`}
            value={location.parentId ?? null}
            onChange={(parentId) => onChange({ ...location, parentId })}
            excludeDeckBoxes
            placeholder="Nothing, it's on its own"
          />
        </span>
        {location.parentId !== undefined && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Put it on its own"
            onClick={() => {
              const { parentId: _, ...rest } = location;
              onChange(rest);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        )}
        <Button
          variant="ghost"
          aria-label={`Use an existing location for ${binder.name}`}
          onClick={onCancel}
        >
          Use existing
        </Button>
      </span>
    </fieldset>
  );
}
