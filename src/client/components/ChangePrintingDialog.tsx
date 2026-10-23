import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { CardDetailsResponse } from '../../shared/api/cards';
import { ErrorBody, type PrintingSummary } from '../../shared/api/common';
import type { SlotPrinting, SlotRow } from '../../shared/api/decks';
import { api } from '../api';
import { cn } from '../lib/utils';
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

/**
 * Picks the printing a deck's card should be, from every paper printing of the card, and
 * whether the foil. Copies already in the deck box stay; the pick list looks for the new one.
 */
export function ChangePrintingDialog({
  slot,
  onSave,
  onClose,
}: {
  slot: SlotRow;
  onSave: (printing: SlotPrinting) => Promise<void>;
  onClose: () => void;
}) {
  const foilId = useId();
  const oracleId = slot.card.oracleId;
  const details = useQuery({
    queryKey: ['cards', oracleId],
    queryFn: async (): Promise<CardDetailsResponse> => {
      const res = await api.cards[':oracleId'].$get({ param: { oracleId } });
      if (!res.ok) {
        const body = ErrorBody.safeParse(await res.json().catch(() => null));
        throw new Error(body.success ? body.data.error.message : "Couldn't load the printings.");
      }
      return res.json();
    },
  });
  const printings = details.data?.printings ?? [];
  const current = slot.printing?.scryfallId ?? null;
  const [chosenId, setChosenId] = useState<string | null>(current);
  const [foil, setFoil] = useState(slot.hint?.foil ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const chosen = printings.find((printing) => printing.scryfallId === chosenId) ?? null;
  const canFoil = chosen?.finishes.includes('foil') ?? false;
  const unchanged = chosen?.scryfallId === current && foil === (slot.hint?.foil ?? false);
  const boxNote = inBoxNote(slot, chosen);

  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ scryfallId: chosen.scryfallId, foil: canFoil && foil });
      onClose();
    } catch (failed) {
      setError(failed instanceof Error ? failed.message : "Couldn't change the printing.");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Change printing</DialogTitle>
          <DialogDescription>
            Pick the printing of {slot.card.name} this deck wants. The pick list looks for it first.
          </DialogDescription>
        </DialogHeader>

        {details.isPending ? (
          <p role="status" className="text-muted-foreground text-sm">
            Loading the printings…
          </p>
        ) : details.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {details.error.message}
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Printings"
            className="-mx-1 grid max-h-[min(460px,55vh)] grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3 overflow-y-auto p-1"
          >
            {printings.map((printing) => (
              <PrintingTile
                key={printing.scryfallId}
                printing={printing}
                name={slot.card.name}
                checked={printing.scryfallId === chosenId}
                current={printing.scryfallId === current}
                onPick={() => setChosenId(printing.scryfallId)}
              />
            ))}
          </div>
        )}

        <label
          htmlFor={foilId}
          className={cn(
            'flex items-center gap-2 text-sm',
            canFoil ? 'font-medium' : 'text-muted-foreground',
          )}
        >
          <input
            id={foilId}
            type="checkbox"
            className="size-4 accent-primary"
            checked={canFoil && foil}
            disabled={!canFoil}
            onChange={(event) => setFoil(event.target.checked)}
          />
          Foil
          {chosen && !canFoil && <span>(this printing has no foil)</span>}
        </label>

        {boxNote && <p className="text-[13px] text-muted-foreground">{boxNote}</p>}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={save} disabled={!chosen || unchanged || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrintingTile({
  printing,
  name,
  checked,
  current,
  onPick,
}: {
  printing: PrintingSummary;
  name: string;
  checked: boolean;
  current: boolean;
  onPick: () => void;
}) {
  const label = `${printing.setName}, ${printing.setCode.toUpperCase()} #${printing.collectorNumber}`;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a card image tile, not a bare radio input
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={current ? `${label} (in the deck now)` : label}
      data-scryfall-id={printing.scryfallId}
      onClick={onPick}
      className={cn(
        'flex flex-col gap-1.5 rounded-lg p-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
        checked && 'bg-primary/10 ring-2 ring-primary hover:bg-primary/10',
      )}
    >
      <span className="relative block aspect-[488/680] overflow-hidden rounded-[4.75%/3.5%] bg-[#15161a]">
        {printing.imageSmall ? (
          <img
            src={printing.imageSmall}
            alt=""
            loading="lazy"
            className="size-full object-contain"
          />
        ) : (
          <span className="flex size-full items-center justify-center p-2 text-center text-white text-xs">
            {name}
          </span>
        )}
        {current && (
          <span className="absolute top-1.5 left-1.5 rounded-full bg-foreground px-2 py-0.5 font-bold text-[11px] text-white">
            In deck
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        <i aria-hidden="true" className={`ss ss-fw ss-${printing.setCode} ss-${printing.rarity}`} />
        <span className="truncate font-medium">{printing.setName}</span>
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">
        {printing.setCode.toUpperCase()} #{printing.collectorNumber}
      </span>
    </button>
  );
}

/** Says that copies already in the deck box stay, when the box holds one of another printing. */
function inBoxNote(slot: SlotRow, chosen: PrintingSummary | null): string | null {
  if (slot.inBoxQuantity === 0 || !chosen) return null;
  const picked = slot.pickedPrinting;
  if (picked && picked.scryfallId === chosen.scryfallId) return null;
  const which = picked
    ? `the ${picked.setCode.toUpperCase()} #${picked.collectorNumber} copy`
    : slot.inBoxQuantity === 1
      ? 'a copy'
      : `${slot.inBoxQuantity} copies`;
  return `The deck box already holds ${which}. It stays there and still counts for this card.`;
}
