import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ErrorBody } from '../../shared/api/common';
import type { MoxfieldExport } from '../../shared/api/exports';
import { api } from '../api';
import { TradeTag } from './TradeTag';
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

/** What the dialog exports: a deck, or a location such as a trade binder. */
export type MoxfieldExportSource =
  | { kind: 'deck'; deckId: number; deckName: string }
  | { kind: 'location'; locationId: number; locationName: string; forTrade?: boolean };

/** The deck options, as the export routes' `tags` and `maybe` query. */
type DeckOptions = { tags: boolean; maybe: boolean };

/** The export's address (the `.txt` file when `txt`), with the deck options as its query. */
function exportPath(source: MoxfieldExportSource, options: DeckOptions, txt: boolean) {
  const file = txt ? 'moxfield.txt' : 'moxfield';
  if (source.kind === 'location') {
    return `/api/exports/locations/${source.locationId}/${file}`;
  }
  const query = new URLSearchParams({
    tags: options.tags ? '1' : '0',
    maybe: options.maybe ? '1' : '0',
  });
  return `/api/exports/decks/${source.deckId}/${file}?${query}`;
}

const cards = (count: number) => `${count} ${count === 1 ? 'card' : 'cards'}`;

/** Such as "95 cards and 5 on the maybe board · commander first". */
function summary(source: MoxfieldExportSource, answer: MoxfieldExport) {
  if (source.kind === 'location') {
    const lines = `${answer.lineCount} ${answer.lineCount === 1 ? 'line' : 'lines'}`;
    return `${cards(answer.cardCount)} in ${lines} · one line per printing and finish`;
  }
  const maybe = answer.maybeCount > 0 ? ` and ${answer.maybeCount} on the maybe board` : '';
  return `${cards(answer.cardCount)}${maybe} · commander first`;
}

/** Copies or downloads a deck or a location as Moxfield's import text. */
export function MoxfieldExportDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: MoxfieldExportSource;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {/* Mounted only while open, so each opening starts with both options on. */}
        {open && <MoxfieldExportBody source={source} />}
      </DialogContent>
    </Dialog>
  );
}

function MoxfieldExportBody({ source }: { source: MoxfieldExportSource }) {
  const ids = useId();
  const [options, setOptions] = useState<DeckOptions>({ tags: true, maybe: true });
  // The address whose text was copied: "Copied" stays until an option changes the text.
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const path = exportPath(source, options, false);
  const copied = copiedPath === path;

  const answer = useQuery({
    queryKey: ['exports', path],
    queryFn: async (): Promise<MoxfieldExport> => {
      const res =
        source.kind === 'deck'
          ? await api.exports.decks[':id'].moxfield.$get({
              param: { id: String(source.deckId) },
              query: { tags: options.tags ? '1' : '0', maybe: options.maybe ? '1' : '0' },
            })
          : await api.exports.locations[':id'].moxfield.$get({
              param: { id: String(source.locationId) },
            });
      if (!res.ok) {
        const body = ErrorBody.safeParse(await res.json().catch(() => null));
        throw new Error(
          body.success ? body.data.error.message : "Couldn't make the export. Try again.",
        );
      }
      return res.json();
    },
  });

  const copy = async () => {
    if (!answer.data) {
      return;
    }
    try {
      await navigator.clipboard.writeText(answer.data.text);
      setCopiedPath(path);
      setCopyError(null);
    } catch {
      setCopyError("Couldn't copy. Select the text and copy it by hand.");
    }
  };

  const name = source.kind === 'deck' ? source.deckName : source.locationName;
  const data = answer.data;

  return (
    <div className="grid min-w-0 gap-4">
      <DialogHeader>
        <div className="flex items-center gap-2">
          <DialogTitle className="font-serif">Export {name} to Moxfield</DialogTitle>
          {source.kind === 'location' && source.forTrade && <TradeTag />}
        </div>
        <DialogDescription>
          {data ? summary(source, data) : answer.isError ? 'No export' : 'Making the export…'}
        </DialogDescription>
      </DialogHeader>

      {source.kind === 'deck' && (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(
            [
              ['tags', 'Include tags'],
              ['maybe', 'Include maybe board'],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              htmlFor={`${ids}-${key}`}
              className="flex items-center gap-2 font-medium text-sm"
            >
              <input
                id={`${ids}-${key}`}
                type="checkbox"
                checked={options[key]}
                onChange={(event) => setOptions({ ...options, [key]: event.target.checked })}
                className="size-4 accent-primary"
              />
              {label}
            </label>
          ))}
        </div>
      )}

      {answer.isError ? (
        <p role="alert" className="text-sm text-status-missing">
          {answer.error.message}
        </p>
      ) : (
        <textarea
          readOnly
          aria-label="Moxfield text"
          value={data?.text ?? ''}
          className="h-72 w-full resize-none rounded-lg border border-border bg-background px-3.5 py-2.5 font-mono text-[13px] leading-[1.6] outline-none"
        />
      )}

      <p className="text-[13px] text-muted-foreground">
        {source.kind === 'deck' ? (
          <>
            Paste this into Moxfield's Import. Each card uses the printing you picked, or the deck's
            printing hint, with <span className="font-mono">*F*</span> for foil.
          </>
        ) : (
          "Proxies are left out. Paste this into Moxfield's Import to share your trade binder as a list."
        )}
      </p>

      {copyError && (
        <p role="alert" className="text-sm text-status-missing">
          {copyError}
        </p>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Close
          </Button>
        </DialogClose>
        <Button asChild variant="outline">
          <a href={exportPath(source, options, true)} download={data?.fileName ?? true}>
            Download .txt
          </a>
        </Button>
        <Button type="button" onClick={copy} disabled={!data}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </DialogFooter>
    </div>
  );
}
