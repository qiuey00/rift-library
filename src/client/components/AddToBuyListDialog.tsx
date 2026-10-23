import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import type { NewBuyItem } from '../../shared/api/buy-list';
import type { CardDetailsResponse } from '../../shared/api/cards';
import { ErrorBody, type PrintingSummary } from '../../shared/api/common';
import { api } from '../api';
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
import { NativeSelect, NativeSelectOption } from './ui/native-select';

export type AddToBuyListDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  oracleId: string;
  /** A wanted printing; without one any printing will do. */
  scryfallId?: string;
  quantity?: number;
};

/** The query key the buy list screen reads; adding a card refreshes it. */
export const BUY_LIST_QUERY_KEY = ['buy-list'];

/** The error message a failed answer carries, written for Jeff. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = ErrorBody.safeParse(await res.json().catch(() => null));
  return new Error(body.success ? body.data.error.message : fallback);
}

/** Such as "Edge of Eternities Commander (EOC) #53". */
export function printingLabel(printing: PrintingSummary) {
  return `${printing.setName} (${printing.setCode.toUpperCase()}) #${printing.collectorNumber}`;
}

/** Adds a card to the buy list, with a quantity, an optional printing and a note. */
export function AddToBuyListDialog({
  open,
  onOpenChange,
  oracleId,
  scryfallId,
  quantity,
}: AddToBuyListDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open, so each opening starts from the props again. */}
        <AddToBuyListForm
          oracleId={oracleId}
          scryfallId={scryfallId}
          quantity={quantity}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function AddToBuyListForm({
  oracleId,
  scryfallId,
  quantity: initialQuantity,
  onDone,
}: {
  oracleId: string;
  scryfallId?: string;
  quantity?: number;
  onDone: () => void;
}) {
  const ids = useId();
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const [quantity, setQuantity] = useState(String(initialQuantity ?? 1));
  const [printingId, setPrintingId] = useState(scryfallId ?? '');
  const [note, setNote] = useState('');

  const details = useQuery({
    queryKey: ['cards', oracleId],
    queryFn: async (): Promise<CardDetailsResponse> => {
      const res = await api.cards[':oracleId'].$get({ param: { oracleId } });
      if (!res.ok) {
        throw await failure(res, "Couldn't load this card.");
      }
      return res.json();
    },
  });

  const add = useMutation({
    mutationFn: async (item: NewBuyItem) => {
      const res = await api['buy-list'].$post({ json: item });
      if (!res.ok) {
        throw await failure(res, "Couldn't add the card to the buy list. Try again.");
      }
      return res.json();
    },
    onSuccess: (_item, sent) => {
      void queryClient.invalidateQueries({ queryKey: BUY_LIST_QUERY_KEY });
      const name = details.data?.card.name ?? 'the card';
      const copies = sent.quantity === 1 ? name : `${sent.quantity} × ${name}`;
      undoBar.show({ message: `Added ${copies} to the buy list`, batchId: null });
      onDone();
    },
  });

  const count = Number(quantity);
  const quantityOk = Number.isInteger(count) && count >= 1;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!quantityOk || add.isPending) {
      return;
    }
    add.mutate({
      oracleId,
      quantity: count,
      ...(printingId ? { scryfallId: printingId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  const card = details.data?.card;
  const printings = details.data?.printings ?? [];
  const picked = printings.find((printing) => printing.scryfallId === printingId);
  // A wanted printing the card data doesn't list still shows, so it isn't dropped silently.
  const unlisted = printingId && details.isSuccess && !picked;
  const image = picked?.imageNormal ?? card?.imageNormal ?? null;

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add to buy list</DialogTitle>
        <DialogDescription>
          {card ? card.name : details.isError ? details.error.message : 'Loading the card…'}
        </DialogDescription>
      </DialogHeader>

      <div className="flex gap-4">
        <div className="aspect-[488/680] w-[132px] shrink-0 overflow-hidden rounded-[7px] bg-muted">
          {image && <img src={image} alt={card?.name ?? ''} className="size-full object-contain" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {card && <p className="text-[13px] text-muted-foreground">{card.typeLine}</p>}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-quantity`} className="font-medium text-sm">
              Quantity
            </label>
            <Input
              id={`${ids}-quantity`}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              required
              value={quantity}
              aria-invalid={!quantityOk}
              onChange={(event) => setQuantity(event.target.value)}
              className="w-24"
            />
          </div>
          <div className="flex flex-col gap-1.5 [&>[data-slot=native-select-wrapper]]:w-full">
            <label htmlFor={`${ids}-printing`} className="font-medium text-sm">
              Printing
            </label>
            <NativeSelect
              id={`${ids}-printing`}
              value={printingId}
              onChange={(event) => setPrintingId(event.target.value)}
              disabled={!details.isSuccess}
            >
              <NativeSelectOption value="">Any printing</NativeSelectOption>
              {unlisted && <NativeSelectOption value={printingId}>{printingId}</NativeSelectOption>}
              {printings.map((printing) => (
                <NativeSelectOption key={printing.scryfallId} value={printing.scryfallId}>
                  {printingLabel(printing)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-note`} className="font-medium text-sm">
          Note
        </label>
        <Input
          id={`${ids}-note`}
          value={note}
          placeholder="Such as which deck wants it"
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {add.isError && (
        <p role="alert" className="text-sm text-status-missing">
          {add.error.message}
        </p>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!quantityOk || !details.isSuccess || add.isPending}>
          {add.isPending ? 'Adding…' : 'Add'}
        </Button>
      </DialogFooter>
    </form>
  );
}
