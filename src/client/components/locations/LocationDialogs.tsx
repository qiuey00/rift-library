import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import {
  type ActionResult,
  ErrorBody,
  type Id,
  type LocationType,
} from '../../../shared/api/common';
import type { MoveContentsBody } from '../../../shared/api/copies';
import {
  type CreateLocationBody,
  type LocationNode,
  LocationNotEmptyError,
} from '../../../shared/api/locations';
import { api } from '../../api';
import { LocationPicker } from '../LocationPicker';
import { useUndoBar } from '../UndoBar';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { failure, plural } from './tree';

/** The query key prefix for everything the Locations screen loads; changes refresh it. */
const LOCATIONS_QUERY_KEY = ['locations'];

const newTypes: { value: Exclude<LocationType, 'inbox'>; label: string }[] = [
  { value: 'box', label: 'Box' },
  { value: 'binder', label: 'Binder' },
  { value: 'deck_box', label: 'Deck box' },
  { value: 'tray', label: 'Tray' },
];

function ErrorLine({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-status-missing">
      {error.message}
    </p>
  );
}

/** Mounts its form only while open, so each opening starts fresh. */
function FormDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && children}</DialogContent>
    </Dialog>
  );
}

/** POST /api/locations: a new box, binder, deck box or tray, at the top level or inside one. */
export function NewLocationDialog({
  open,
  onOpenChange,
  inboxId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nothing can go inside the inbox, so the parent picker leaves it out. */
  inboxId: Id | undefined;
  onCreated: (location: LocationNode) => void;
}) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange}>
      <NewLocationForm
        inboxId={inboxId}
        onCreated={(location) => {
          onCreated(location);
          onOpenChange(false);
        }}
      />
    </FormDialog>
  );
}

function NewLocationForm({
  inboxId,
  onCreated,
}: {
  inboxId: Id | undefined;
  onCreated: (location: LocationNode) => void;
}) {
  const ids = useId();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<CreateLocationBody['type']>('box');
  const [parentId, setParentId] = useState<Id | null>(null);

  const create = useMutation({
    mutationFn: async (body: CreateLocationBody): Promise<LocationNode> => {
      const res = await api.locations.$post({ json: body });
      if (!res.ok) throw await failure(res, "Couldn't add the location. Try again.");
      return res.json();
    },
    onSuccess: (location) => {
      void queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY });
      onCreated(location);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '' || create.isPending) return;
    create.mutate({ name: name.trim(), type, ...(parentId === null ? {} : { parentId }) });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New location</DialogTitle>
        <DialogDescription>
          A box, binder, deck box or tray. It goes last in its parent.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-name`} className="font-medium text-sm">
          Name
        </label>
        <Input
          id={`${ids}-name`}
          value={name}
          maxLength={100}
          required
          autoFocus
          onChange={(event) => setName(event.target.value)}
          placeholder="Such as Commons box"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-type`} className="font-medium text-sm">
          Type
        </label>
        <NativeSelect
          id={`${ids}-type`}
          value={type}
          onChange={(event) => setType(event.target.value as CreateLocationBody['type'])}
        >
          {newTypes.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-parent`} className="font-medium text-sm">
          Inside
        </label>
        <div className="flex items-center gap-2">
          <LocationPicker
            id={`${ids}-parent`}
            value={parentId}
            onChange={setParentId}
            excludeIds={inboxId === undefined ? [] : [inboxId]}
            placeholder="Top level"
          />
          {parentId !== null && (
            <Button type="button" variant="outline" onClick={() => setParentId(null)}>
              Top level
            </Button>
          )}
        </div>
      </div>
      <ErrorLine error={create.error} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={name.trim() === '' || create.isPending}>
          {create.isPending ? 'Adding…' : 'Add location'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** PATCH /api/locations/:id with a new name. */
export function RenameLocationDialog({
  location,
  onOpenChange,
}: {
  location: LocationNode | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <FormDialog open={location !== null} onOpenChange={onOpenChange}>
      {location && <RenameForm location={location} onDone={() => onOpenChange(false)} />}
    </FormDialog>
  );
}

function RenameForm({ location, onDone }: { location: LocationNode; onDone: () => void }) {
  const id = useId();
  const [name, setName] = useState(location.name);
  const update = useUpdateLocation();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === '' || update.isPending) return;
    update.mutate({ id: location.id, body: { name: name.trim() } }, { onSuccess: onDone });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Rename {location.name}</DialogTitle>
        <DialogDescription>{location.path}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="font-medium text-sm">
          Name
        </label>
        <Input
          id={id}
          value={name}
          maxLength={100}
          required
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <ErrorLine error={update.error} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={name.trim() === '' || update.isPending}>
          {update.isPending ? 'Saving…' : 'Rename'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** PATCH /api/locations/:id: a new name, color or position. */
export function useUpdateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: Id;
      body: { name?: string; color?: string | null; position?: number; forTrade?: boolean };
    }): Promise<LocationNode> => {
      const res = await api.locations[':id'].$patch({ param: { id: String(id) }, json: body });
      if (!res.ok) throw await failure(res, "Couldn't change the location. Try again.");
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY }),
  });
}

async function postMoveContents(id: Id, body: MoveContentsBody): Promise<ActionResult> {
  const res = await api.locations[':id']['move-contents'].$post({
    param: { id: String(id) },
    json: body,
  });
  if (!res.ok) throw await failure(res, "Couldn't move the cards. Try again.");
  return res.json();
}

/** POST /api/locations/:id/move-contents with its children, to a picked location. */
export function MoveContentsDialog({
  location,
  excludeIds,
  onOpenChange,
}: {
  location: LocationNode | null;
  /** The location itself and everything inside it. */
  excludeIds: Id[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <FormDialog open={location !== null} onOpenChange={onOpenChange}>
      {location && (
        <MoveContentsForm
          location={location}
          excludeIds={excludeIds}
          onDone={() => onOpenChange(false)}
        />
      )}
    </FormDialog>
  );
}

function MoveContentsForm({
  location,
  excludeIds,
  onDone,
}: {
  location: LocationNode;
  excludeIds: Id[];
  onDone: () => void;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const [destination, setDestination] = useState<Id | null>(null);
  const move = useMutation({
    mutationFn: (toLocationId: Id) =>
      postMoveContents(location.id, { toLocationId, includeChildren: true }),
    onSuccess: (result) => {
      undoBar.show({ message: result.message, batchId: result.batchId });
      // Copies moved, so every screen's counts and lists may be out of date.
      void queryClient.invalidateQueries();
      onDone();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (destination === null || move.isPending) return;
    move.mutate(destination);
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Move contents</DialogTitle>
        <DialogDescription>
          {`Moves all ${plural(location.totalCount, 'card')} in ${location.path}`}
          {location.totalCount !== location.cardCount ? ', its child locations included.' : '.'}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="font-medium text-sm">
          Destination
        </label>
        <LocationPicker
          id={id}
          value={destination}
          onChange={setDestination}
          excludeIds={excludeIds}
          placeholder="Pick where they go"
        />
      </div>
      <ErrorLine error={move.error} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={destination === null || move.isPending}>
          {move.isPending ? 'Moving…' : 'Move'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Deletes a location. An empty one goes after one confirmation; one that holds copies (or
 * that the server says does) offers to send them all to the inbox first, then deletes it.
 */
export function DeleteLocationDialog({
  location,
  inbox,
  onOpenChange,
  onDeleted,
}: {
  location: LocationNode | null;
  inbox: LocationNode | undefined;
  onOpenChange: (open: boolean) => void;
  onDeleted: (location: LocationNode) => void;
}) {
  return (
    <FormDialog open={location !== null} onOpenChange={onOpenChange}>
      {location && (
        <DeleteForm
          location={location}
          inbox={inbox}
          onDeleted={() => {
            onDeleted(location);
            onOpenChange(false);
          }}
        />
      )}
    </FormDialog>
  );
}

/** The answer of DELETE /api/locations/:id: deleted, or still holding this many cards. */
type DeleteOutcome = { deleted: true } | { deleted: false; cardCount: number };

async function deleteLocation(id: Id): Promise<DeleteOutcome> {
  const res = await api.locations[':id'].$delete({ param: { id: String(id) } });
  if (res.ok) return { deleted: true };
  const body: unknown = await res.json().catch(() => null);
  const notEmpty = LocationNotEmptyError.safeParse(body);
  if (notEmpty.success) return { deleted: false, cardCount: notEmpty.data.error.cardCount };
  const error = ErrorBody.safeParse(body);
  throw new Error(error.success ? error.data.error.message : "Couldn't delete the location.");
}

function DeleteForm({
  location,
  inbox,
  onDeleted,
}: {
  location: LocationNode;
  inbox: LocationNode | undefined;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const [cardCount, setCardCount] = useState(location.totalCount);
  const inboxName = inbox?.name ?? 'To sort';

  const finish = (message: string) => {
    // The copies' moves can't be undone into a location that's gone, so no Undo here.
    undoBar.show({ message, batchId: null });
    void queryClient.invalidateQueries();
    onDeleted();
  };

  const remove = useMutation({
    mutationFn: () => deleteLocation(location.id),
    onSuccess: (outcome) => {
      if (outcome.deleted) finish(`Deleted ${location.name}`);
      else setCardCount(outcome.cardCount);
    },
  });

  const sendAndRemove = useMutation({
    mutationFn: async () => {
      if (!inbox) throw new Error(`Couldn't find ${inboxName}. Reload and try again.`);
      const moved = await postMoveContents(location.id, {
        toLocationId: inbox.id,
        includeChildren: true,
      });
      const outcome = await deleteLocation(location.id);
      if (!outcome.deleted) {
        throw new Error(`${location.name} still holds cards. Move them first, then delete it.`);
      }
      return moved;
    },
    onSuccess: (moved) => finish(`${moved.message}. Deleted ${location.name}`),
    // Some copies may have moved even so.
    onError: () => void queryClient.invalidateQueries(),
  });

  const busy = remove.isPending || sendAndRemove.isPending;
  const hasChildren = location.totalCount !== location.cardCount;

  if (cardCount > 0) {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>
            {location.name} still holds {plural(cardCount, 'card')}
          </DialogTitle>
          <DialogDescription>
            A location that holds copies can’t be deleted until they move. Send them all to “
            {inboxName}” to sort later, then delete it.
          </DialogDescription>
        </DialogHeader>
        <ErrorLine error={sendAndRemove.error} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => sendAndRemove.mutate()}
          >
            {sendAndRemove.isPending ? 'Sending…' : `Send all to “${inboxName}”`}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Delete {location.name}?</DialogTitle>
        <DialogDescription>
          {hasChildren
            ? 'It holds no cards. Its child locations are deleted with it.'
            : 'It holds no cards.'}
        </DialogDescription>
      </DialogHeader>
      <ErrorLine error={remove.error} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="button" variant="destructive" disabled={busy} onClick={() => remove.mutate()}>
          {remove.isPending ? 'Deleting…' : 'Delete'}
        </Button>
      </DialogFooter>
    </div>
  );
}
