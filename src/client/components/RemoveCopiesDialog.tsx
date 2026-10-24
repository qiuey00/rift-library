import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { type ActionResult, ErrorBody, type StackRow } from '../../shared/api/common';
import type { RemovalReason, RemoveCopiesBody } from '../../shared/api/copies';
import { api } from '../api';
import { cn } from '../lib/utils';
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

export type RemoveCopiesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stack to lower or remove; null while closed. */
  stack: StackRow | null;
};

const reasons: { value: RemovalReason; label: string }[] = [
  { value: 'sold', label: 'Sold' },
  { value: 'traded', label: 'Traded' },
  { value: 'lost', label: 'Lost' },
  { value: 'miscounted', label: 'Miscounted' },
];

/**
 * Why the Lower or remove… action can't be used on the selection, or null when it can: it
 * takes one stack at a time, and never a stack in a deck box (COL-13).
 */
export function removeBlockedReason(selected: StackRow[]): string | null {
  if (selected.length !== 1) return 'Pick one stack to lower or remove';
  if (selected[0]?.inDeck) return 'These copies are in a deck. Take them out first.';
  return null;
}

/**
 * Lowers a copy stack by a quantity, or removes all of it, with a reason (COL-13). The server
 * records the removal; this only sends it and shows the undo bar.
 */
export function RemoveCopiesDialog({ open, onOpenChange, stack }: RemoveCopiesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so each opening starts fresh. */}
        {stack && <RemoveCopiesForm stack={stack} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RemoveCopiesForm({ stack, onDone }: { stack: StackRow; onDone: () => void }) {
  const ids = useId();
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const [quantity, setQuantity] = useState(String(stack.quantity));
  const [reason, setReason] = useState<RemovalReason | null>(null);

  const remove = useMutation({
    mutationFn: async (body: RemoveCopiesBody): Promise<ActionResult> => {
      const res = await api.copies.remove.$post({ json: body });
      if (!res.ok) {
        const error = ErrorBody.safeParse(await res.json().catch(() => null));
        throw new Error(
          error.success ? error.data.error.message : "Couldn't remove the cards. Try again.",
        );
      }
      return res.json();
    },
    onSuccess: (result) => {
      undoBar.show({ message: result.message, batchId: result.batchId });
      // Copies left the collection, so every screen's counts and lists may be out of date.
      void queryClient.invalidateQueries();
      onDone();
    },
  });

  const count = Number(quantity);
  const quantityOk = Number.isInteger(count) && count >= 1 && count <= stack.quantity;
  const ready = quantityOk && reason !== null && !remove.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || reason === null) return;
    remove.mutate({ stackId: stack.stackId, quantity: count, reason });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Lower or remove</DialogTitle>
        <DialogDescription>
          {stack.quantity === 1 ? '1 copy' : `${stack.quantity} copies`} of {stack.card.name} in{' '}
          {stack.location.path}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-quantity`} className="font-medium text-sm">
          How many to remove
        </label>
        <div className="flex items-center gap-2">
          <Input
            id={`${ids}-quantity`}
            type="number"
            inputMode="numeric"
            min={1}
            max={stack.quantity}
            step={1}
            required
            value={quantity}
            aria-invalid={!quantityOk}
            onChange={(event) => setQuantity(event.target.value)}
            className="w-24"
          />
          <span className="text-muted-foreground text-sm">of {stack.quantity}</span>
        </div>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-sm">Reason</legend>
        <div className="flex flex-wrap gap-2">
          {reasons.map((option) => (
            <label
              key={option.value}
              className={cn(
                'inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                reason === option.value
                  ? 'border-primary bg-primary/10 font-semibold text-primary'
                  : 'border-input bg-card hover:bg-accent',
              )}
            >
              <input
                type="radio"
                name={`${ids}-reason`}
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {remove.isError && (
        <p role="alert" className="text-sm text-status-missing">
          {remove.error.message}
        </p>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" variant="destructive" disabled={!ready}>
          {remove.isPending ? 'Removing…' : 'Remove'}
        </Button>
      </DialogFooter>
    </form>
  );
}
