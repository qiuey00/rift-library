import { ChevronRight, Info, Search } from 'lucide-react';
import { useState } from 'react';
import type { InvalidRow, UnknownRow } from '../../../shared/api/manabox';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { type ImportDraft, plural, type RowFix, type StepProps } from './draft';
import { FixRowDialog } from './FixRowDialog';

/** The unknown rows Jeff hasn't fixed or skipped yet. */
export function openRows(draft: ImportDraft): UnknownRow[] {
  return openUnknownRows(draft.preview?.unknownRows ?? [], draft);
}

/** The rows of `rows` Jeff hasn't fixed or skipped yet. */
export function openUnknownRows(rows: UnknownRow[], draft: ImportDraft): UnknownRow[] {
  return rows.filter((row) => !(row.row in draft.fixes) && !draft.skips.includes(row.row));
}

/** The cards the import adds: the file's cards less the unknown rows Jeff skipped. */
export function cardsToAdd(draft: ImportDraft): number {
  const preview = draft.preview;
  if (!preview) return 0;
  const skipped = preview.unknownRows
    .filter((row) => draft.skips.includes(row.row))
    .reduce((sum, row) => sum + row.quantity, 0);
  return preview.cardCount - skipped;
}

/** Step 3: the counts, the rows to fix or skip and the rows the import skips. */
export function PreviewStep({ draft, change }: StepProps) {
  const preview = draft.preview;
  if (!preview) return null;

  return (
    <div className="flex flex-col gap-4">
      <dl aria-label="Counts" className="flex flex-wrap gap-2.5">
        <Count label="rows" value={preview.rowCount} />
        <Count label="cards" value={preview.cardCount} />
        <Count label="unknown rows" value={preview.unknownRows.length} />
      </dl>

      {preview.lookupFailed && <LookupFailedNote />}
      <UnknownRowsSection rows={preview.unknownRows} draft={draft} change={change} />
      <InvalidRowsSection rows={preview.invalidRows} />
    </div>
  );
}

export function LookupFailedNote() {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-[10px] border border-status-other-decks-fill bg-status-other-decks-soft px-3.5 py-2.5 text-[13px] text-status-other-decks"
    >
      <Info aria-hidden="true" className="mt-px size-4 shrink-0" />
      Couldn't reach Scryfall; unknown cards are listed to fix or skip
    </p>
  );
}

/** The rows the app doesn't know, each to fix by picking its printing or to skip. */
export function UnknownRowsSection({ rows, draft, change }: StepProps & { rows: UnknownRow[] }) {
  const [fixing, setFixing] = useState<UnknownRow | null>(null);
  if (rows.length === 0) return null;

  const setChoice = (row: number, choice: RowFix | 'skip' | null) => {
    const fixes = { ...draft.fixes };
    delete fixes[row];
    const skips = draft.skips.filter((skipped) => skipped !== row);
    if (choice === 'skip') skips.push(row);
    else if (choice) fixes[row] = choice;
    change({ fixes, skips });
  };
  const open = openUnknownRows(rows, draft);

  return (
    <>
      <section aria-labelledby="manabox-unknown-title" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 id="manabox-unknown-title" className="font-bold text-[15px]">
              Unknown cards
            </h2>
            <p className="text-[13px] text-muted-foreground">
              The app doesn't know these printings. Fix each one by picking its card and printing,
              or skip it.
            </p>
          </div>
          {open.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => change({ skips: [...draft.skips, ...open.map((row) => row.row)] })}
            >
              Skip the rest
            </Button>
          )}
        </div>
        <div className="max-h-[280px] overflow-auto rounded-[10px] border border-border">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-[#f6f7f9] text-left text-muted-foreground text-xs uppercase tracking-[0.04em]">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Row
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  Qty
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  Card
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  <span className="sr-only">Choice</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const fix = draft.fixes[row.row];
                const skipped = draft.skips.includes(row.row);
                return (
                  <tr
                    key={row.row}
                    aria-label={`Row ${row.row}: ${row.name}`}
                    className="border-[#eceef2] border-t"
                  >
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.row}</td>
                    <td className="px-2 py-2 tabular-nums">{row.quantity}</td>
                    <td className="px-2 py-2">
                      <span
                        className={cn(
                          'font-semibold',
                          skipped && 'text-muted-foreground line-through',
                          !fix && !skipped && 'text-status-missing',
                        )}
                      >
                        {row.name}
                      </span>{' '}
                      <span className="text-muted-foreground">
                        {row.setCode.toUpperCase()} #{row.collectorNumber}
                      </span>
                      {fix && <span className="text-status-in-box"> → {fix.label}</span>}
                      {skipped && <span className="text-muted-foreground"> · skipped</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="flex justify-end gap-2">
                        {fix || skipped ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setChoice(row.row, null)}
                          >
                            Undo
                          </Button>
                        ) : (
                          <>
                            <Button variant="outline" size="sm" onClick={() => setFixing(row)}>
                              <Search aria-hidden="true" />
                              Fix
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setChoice(row.row, 'skip')}
                            >
                              Skip
                            </Button>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <FixRowDialog
        row={fixing}
        onClose={() => setFixing(null)}
        onPick={(fix) => {
          if (fixing) setChoice(fixing.row, fix);
          setFixing(null);
        }}
      />
    </>
  );
}

/** "Skipped: N rows with bad values", opening to the rows and why each was skipped. */
export function InvalidRowsSection({ rows }: { rows: InvalidRow[] }) {
  if (rows.length === 0) return null;
  return (
    <details className="group rounded-[10px] border border-border bg-[#fbfbfc] px-3.5 py-2.5 text-[13px]">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold">
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-90"
        />
        Skipped: {plural(rows.length, 'row')} with bad values
      </summary>
      <p className="mt-2 text-muted-foreground">
        Correct these in ManaBox and export again to bring them in.
      </p>
      <ul aria-label="Rows with bad values" className="mt-1.5 flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.row}>
            <span className="text-muted-foreground tabular-nums">Row {row.row}</span> ·{' '}
            <span className="font-semibold">{row.name}</span>{' '}
            <span className="text-muted-foreground">
              {row.setCode.toUpperCase()} #{row.collectorNumber}
            </span>{' '}
            · {row.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-[120px] flex-col-reverse rounded-[10px] border border-border bg-[#fbfbfc] px-3.5 py-2">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="font-bold text-xl tabular-nums">{value.toLocaleString('en-US')}</dd>
    </div>
  );
}
