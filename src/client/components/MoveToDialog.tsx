import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { type ActionResult, ErrorBody, type Id, type StackRow } from '../../shared/api/common';
import type { MoveCopiesBody } from '../../shared/api/copies';
import { api } from '../api';
import { LocationPicker } from './LocationPicker';
import { useUndoBar } from './UndoBar';
import { Button } from './ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';

export type MoveToDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected copy stacks. */
  stacks: StackRow[];
  /** Called with the server's answer once the copies have moved. */
  onMoved?: (result: ActionResult) => void;
};

/**
 * Moves the selected copy stacks to another location. With one stack, a quantity moves part
 * of it. The server splits, merges and sets the came-from location; this only sends the move.
 */
export function MoveToDialog({ open, onOpenChange, stacks, onMoved }: MoveToDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so each opening starts fresh. */}
        <MoveToForm stacks={stacks} onMoved={onMoved} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function MoveToForm({
  stacks,
  onMoved,
  onDone,
}: {
  stacks: StackRow[];
  onMoved?: (result: ActionResult) => void;
  onDone: () => void;
}) {
  const ids = useId();
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const [destination, setDestination] = useState<Id | null>(null);
  const single = stacks.length === 1 ? stacks[0] : null;
  const [quantity, setQuantity] = useState(String(single?.quantity ?? 1));

  const move = useMutation({
    mutationFn: async (body: MoveCopiesBody): Promise<ActionResult> => {
      const res = await api.moves.$post({ json: body });
      if (!res.ok) {
        const error = ErrorBody.safeParse(await res.json().catch(() => null));
        throw new Error(
          error.success ? error.data.error.message : "Couldn't move the cards. Try again.",
        );
      }
      return res.json();
    },
    onSuccess: (result) => {
      undoBar.show({ message: result.message, batchId: result.batchId });
      // Copies moved, so every screen's counts and lists may be out of date.
      void queryClient.invalidateQueries();
      onMoved?.(result);
      onDone();
    },
  });

  const count = Number(quantity);
  const quantityOk = !single || (Number.isInteger(count) && count >= 1 && count <= single.quantity);
  const cards = stacks.reduce((sum, stack) => sum + stack.quantity, 0);
  // Where every copy already is can't be the destination.
  const from = new Set(stacks.map((stack) => stack.location.id));
  const excludeIds = from.size === 1 ? [...from] : [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (destination === null || !quantityOk || stacks.length === 0 || move.isPending) {
      return;
    }
    move.mutate({
      moves: stacks.map((stack) => ({
        stackId: stack.stackId,
        quantity: single ? count : stack.quantity,
      })),
      toLocationId: destination,
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Move to</DialogTitle>
        <DialogDescription>
          {single
            ? `${plural(single.quantity, 'copy', 'copies')} of ${single.card.name} in ${single.location.path}`
            : `${plural(stacks.length, 'stack')}, ${plural(cards, 'card')}`}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-destination`} className="font-medium text-sm">
          Destination
        </label>
        <LocationPicker
          id={`${ids}-destination`}
          value={destination}
          onChange={setDestination}
          excludeIds={excludeIds}
          placeholder="Pick where they go"
        />
      </div>

      {single && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-quantity`} className="font-medium text-sm">
            Quantity
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={`${ids}-quantity`}
              type="number"
              inputMode="numeric"
              min={1}
              max={single.quantity}
              step={1}
              required
              value={quantity}
              aria-invalid={!quantityOk}
              onChange={(event) => setQuantity(event.target.value)}
              className="w-24"
            />
            <span className="text-muted-foreground text-sm">of {single.quantity}</span>
          </div>
        </div>
      )}

      {move.isError && (
        <p role="alert" className="text-sm text-status-missing">
          {move.error.message}
        </p>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button
          type="submit"
          disabled={destination === null || !quantityOk || stacks.length === 0 || move.isPending}
        >
          {move.isPending ? 'Moving…' : 'Move'}
        </Button>
      </DialogFooter>
    </form>
  );
}
