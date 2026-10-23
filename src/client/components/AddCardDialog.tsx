import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import type { CardDetailsResponse } from '../../shared/api/cards';
import {
  type ActionResult,
  ErrorBody,
  type Finish,
  type Id,
  type PrintingSummary,
} from '../../shared/api/common';
import type { AddCopiesBody } from '../../shared/api/copies';
import { api } from '../api';
import { cn } from '../lib/utils';
import { CardSearchPicker } from './CardSearchPicker';
import { LocationPicker, useLocationTree } from './LocationPicker';
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

export type AddCardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The location the new copies go to unless Jeff picks another. */
  defaultLocationId?: Id;
  /** The card to start with, when opened from a card. */
  defaultOracleId?: string;
};

const finishWords: Record<Finish, string> = { nonfoil: 'Nonfoil', foil: 'Foil', etched: 'Etched' };

/** The conditions, best first. */
const conditions: [value: string, label: string][] = [
  ['mint', 'Mint'],
  ['near_mint', 'Near mint'],
  ['excellent', 'Excellent'],
  ['good', 'Good'],
  ['light_played', 'Light played'],
  ['played', 'Played'],
  ['poor', 'Poor'],
];

/** Language codes for paper printings. */
const languages: [code: string, label: string][] = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['ru', 'Russian'],
  ['zhs', 'Simplified Chinese'],
  ['zht', 'Traditional Chinese'],
  ['he', 'Hebrew'],
  ['la', 'Latin'],
  ['grc', 'Ancient Greek'],
  ['ar', 'Arabic'],
  ['sa', 'Sanskrit'],
  ['ph', 'Phyrexian'],
];

/** The error message a failed answer carries, written for Jeff. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = ErrorBody.safeParse(await res.json().catch(() => null));
  return new Error(body.success ? body.data.error.message : fallback);
}

/**
 * Adds copies of a card to a location: the card (found by search unless given), its printing,
 * quantity, finish, condition, language, location and whether they are proxies. The server adds
 * them to the alike stack in that location when one exists.
 */
export function AddCardDialog({
  open,
  onOpenChange,
  defaultLocationId,
  defaultOracleId,
}: AddCardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        {/* Mounted only while open, so each opening starts from the props again. */}
        <AddCardForm
          defaultLocationId={defaultLocationId}
          defaultOracleId={defaultOracleId}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function AddCardForm({
  defaultLocationId,
  defaultOracleId,
  onDone,
}: {
  defaultLocationId?: Id;
  defaultOracleId?: string;
  onDone: () => void;
}) {
  const ids = useId();
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const tree = useLocationTree();

  const [oracleId, setOracleId] = useState<string | null>(defaultOracleId ?? null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [pickedFinish, setPickedFinish] = useState<Finish | null>(null);
  const [condition, setCondition] = useState('near_mint');
  const [pickedLanguage, setPickedLanguage] = useState<string | null>(null);
  const [pickedLocation, setPickedLocation] = useState<Id | null>(null);
  const [isProxy, setIsProxy] = useState(false);
  const [misprint, setMisprint] = useState(false);
  const [altered, setAltered] = useState(false);

  const details = useQuery({
    queryKey: ['cards', oracleId],
    enabled: oracleId !== null,
    queryFn: async (): Promise<CardDetailsResponse> => {
      const res = await api.cards[':oracleId'].$get({ param: { oracleId: oracleId ?? '' } });
      if (!res.ok) {
        throw await failure(res, "Couldn't load this card.");
      }
      return res.json();
    },
  });

  const add = useMutation({
    mutationFn: async (body: AddCopiesBody): Promise<ActionResult> => {
      const res = await api.stacks.add.$post({ json: body });
      if (!res.ok) {
        throw await failure(res, "Couldn't add the card. Try again.");
      }
      return res.json();
    },
    onSuccess: (result) => {
      undoBar.show({ message: result.message, batchId: result.batchId });
      // Copies were added, so every screen's counts and lists may be out of date.
      void queryClient.invalidateQueries();
      onDone();
    },
  });

  const card = details.data?.card;
  const printings = details.data?.printings ?? [];
  // The newest printing until Jeff picks another.
  const printing = printings.find((p) => p.printingId === chosenId) ?? printings[0];
  // The finish follows the printing: a pick it doesn't come in falls back to its first finish.
  const finishes = printing?.finishes ?? [];
  const finish = pickedFinish && finishes.includes(pickedFinish) ? pickedFinish : finishes[0];
  const language = pickedLanguage ?? printing?.lang ?? 'en';
  const inboxId = tree.data?.nodes.find((node) => node.type === 'inbox')?.id ?? null;
  const locationId = pickedLocation ?? defaultLocationId ?? inboxId;

  const count = Number(quantity);
  const quantityOk = Number.isInteger(count) && count >= 1;
  const ready = printing !== undefined && finish !== undefined && locationId !== null && quantityOk;

  const pickPrinting = (next: PrintingSummary) => {
    setChosenId(next.printingId);
    // A new printing brings its own language.
    setPickedLanguage(null);
  };

  const changeCard = () => {
    setOracleId(null);
    setChosenId(null);
    setPickedFinish(null);
    setPickedLanguage(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || add.isPending) {
      return;
    }
    add.mutate({
      printingId: printing.printingId,
      quantity: count,
      finish,
      condition,
      language,
      misprint,
      altered,
      isProxy,
      locationId,
    });
  };

  const languageChoices = languages.some(([code]) => code === language)
    ? languages
    : [...languages, [language, language] as [string, string]];
  const image = printing?.imageNormal ?? card?.imageNormal ?? null;

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add a card</DialogTitle>
        <DialogDescription>
          {oracleId === null
            ? 'Search for the card, then pick its printing and where it goes.'
            : card
              ? card.name
              : details.isError
                ? details.error.message
                : 'Loading the card…'}
        </DialogDescription>
      </DialogHeader>

      {oracleId === null ? (
        <CardSearchPicker
          label="Card"
          onPick={(picked) => setOracleId(picked.oracleId)}
          autoFocus
        />
      ) : (
        <div className="flex gap-5">
          <div className="aspect-[488/680] w-[168px] shrink-0 self-start overflow-hidden rounded-[8px] bg-muted">
            {image && (
              <img
                src={image}
                alt={card ? `${card.name}, the picked printing` : ''}
                className="size-full object-contain"
              />
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {card && (
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[13px] text-muted-foreground">{card.typeLine}</p>
                {defaultOracleId === undefined && (
                  <Button type="button" variant="outline" size="sm" onClick={changeCard}>
                    Change card
                  </Button>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <span id={`${ids}-printing`} className="font-medium text-sm">
                Printing
              </span>
              <div
                role="radiogroup"
                aria-labelledby={`${ids}-printing`}
                className="flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-lg border border-input bg-card p-1"
              >
                {details.isPending && (
                  <p className="px-2 py-1.5 text-muted-foreground text-sm">Loading printings…</p>
                )}
                {details.isSuccess && printings.length === 0 && (
                  <p className="px-2 py-1.5 text-muted-foreground text-sm">
                    There are no printings of this card.
                  </p>
                )}
                {printings.map((p) => {
                  const checked = p.printingId === printing?.printingId;
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: a row with a set symbol, not a bare radio input
                    <button
                      key={p.printingId}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => pickPrinting(p)}
                      data-printing-id={p.printingId}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                        checked && 'bg-primary/10 hover:bg-primary/10',
                      )}
                    >
                      <i aria-hidden="true" className={`ss ss-fw ss-${p.setCode} ss-${p.rarity}`} />
                      <span className="truncate font-medium">{p.setName}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {p.setCode.toUpperCase()} #{p.collectorNumber}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 [&_[data-slot=native-select-wrapper]]:w-full">
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
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${ids}-finish`} className="font-medium text-sm">
                  Finish
                </label>
                <NativeSelect
                  id={`${ids}-finish`}
                  value={finish ?? ''}
                  onChange={(event) => setPickedFinish(event.target.value as Finish)}
                  disabled={finishes.length === 0}
                >
                  {finishes.map((f) => (
                    <NativeSelectOption key={f} value={f}>
                      {finishWords[f]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${ids}-condition`} className="font-medium text-sm">
                  Condition
                </label>
                <NativeSelect
                  id={`${ids}-condition`}
                  value={condition}
                  onChange={(event) => setCondition(event.target.value)}
                >
                  {conditions.map(([value, label]) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${ids}-language`} className="font-medium text-sm">
                  Language
                </label>
                <NativeSelect
                  id={`${ids}-language`}
                  value={language}
                  onChange={(event) => setPickedLanguage(event.target.value)}
                >
                  {languageChoices.map(([code, label]) => (
                    <NativeSelectOption key={code} value={code}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-location`} className="font-medium text-sm">
          Location
        </label>
        <LocationPicker
          id={`${ids}-location`}
          value={locationId}
          onChange={setPickedLocation}
          placeholder="Pick where they go"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isProxy}
            onChange={(event) => setIsProxy(event.target.checked)}
            className="size-4 accent-primary"
          />
          Proxy
        </label>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-muted-foreground">More</summary>
          <div className="mt-2 flex gap-5">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={misprint}
                onChange={(event) => setMisprint(event.target.checked)}
                className="size-4 accent-primary"
              />
              Misprint
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={altered}
                onChange={(event) => setAltered(event.target.checked)}
                className="size-4 accent-primary"
              />
              Altered
            </label>
          </div>
        </details>
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
        <Button type="submit" disabled={!ready || add.isPending}>
          {add.isPending ? 'Adding…' : 'Add'}
        </Button>
      </DialogFooter>
    </form>
  );
}
