import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import type { Finish, Id } from '../../../shared/api/common';
import type { FlaggedCopy, UpdatePreview, UpdateRow } from '../../../shared/api/manabox-update';
import { cn } from '../../lib/utils';
import { LocationTile } from '../LocationTile';
import { type ImportDraft, plural, type StepProps } from './draft';
import {
  InvalidRowsSection,
  LookupFailedNote,
  openUnknownRows,
  UnknownRowsSection,
} from './PreviewStep';

type GroupId = keyof UpdatePreview['groups'];

const groups: { id: GroupId; title: string; text: string }[] = [
  { id: 'new', title: 'New', text: 'In the file, not in the app' },
  { id: 'raised', title: 'Raised', text: 'More copies in the file than in the app' },
  { id: 'lowered', title: 'Lowered', text: 'Fewer copies in the file than in the app' },
  { id: 'missing', title: 'Missing', text: 'In the app, not in the file' },
];

const finishWords: Record<Finish, string> = { nonfoil: 'Nonfoil', foil: 'Foil', etched: 'Etched' };

/** "near_mint" reads "Near mint". */
function conditionWord(condition: string) {
  const words = condition.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function updateBlocker(draft: ImportDraft) {
  const open = openUnknownRows(draft.updatePreview?.unknownRows ?? [], draft).length;
  if (open === 0) return null;
  return open === 1
    ? 'Fix or skip the unknown row first.'
    : `Fix or skip the ${open} unknown rows first.`;
}

/**
 * The cards the update takes out: every copy the lowered and missing rows lose, less the flagged
 * deck-box copies Jeff keeps.
 */
export function cardsToRemove(draft: ImportDraft): number {
  const preview = draft.updatePreview;
  if (!preview) return 0;
  let count = 0;
  for (const row of [...preview.groups.lowered, ...preview.groups.missing]) {
    count += row.appQuantity - row.fileQuantity;
    for (const copy of row.flagged) {
      if (!draft.removeFlagged.includes(copy.stackId)) count -= copy.quantity;
    }
  }
  return Math.max(0, count);
}

/** Update a location, step 3: what changes, group by group, and the deck-box copies to decide. */
export function UpdatePreviewStep({ draft, change }: StepProps) {
  const preview = draft.updatePreview;
  if (!preview) return null;

  const setRemove = (stackId: Id, remove: boolean) => {
    const others = draft.removeFlagged.filter((id) => id !== stackId);
    change({ removeFlagged: remove ? [...others, stackId] : others });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted-foreground">
        Comparing the file with{' '}
        <span className="inline-flex items-center gap-1.5 align-middle font-semibold text-foreground">
          <LocationTile type={preview.location.type} color={preview.location.color} size="sm" />
          {preview.location.path}
        </span>
        . {plural(preview.unchangedCount, 'stack stays', 'stacks stay')} the same.
      </p>

      {preview.lookupFailed && <LookupFailedNote />}

      <div className="flex flex-col gap-2.5">
        {groups.map((group) => {
          const rows = preview.groups[group.id];
          return (
            <details
              key={group.id}
              aria-label={`${group.title}: ${rows.length}`}
              // Open the groups holding deck-box copies, so Jeff sees each choice.
              open={rows.some((row) => row.flagged.length > 0) || undefined}
              className="group rounded-[10px] border border-border bg-card"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5">
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
                />
                <span className="font-bold text-[15px]">{group.title}</span>
                <span
                  data-testid="group-count"
                  className="rounded-full bg-[#eef0f4] px-2 py-px font-semibold text-[13px] tabular-nums"
                >
                  {rows.length.toLocaleString('en-US')}
                </span>
                <span className="text-[13px] text-muted-foreground">{group.text}</span>
              </summary>
              {rows.length === 0 ? (
                <p className="border-[#eceef2] border-t px-3.5 py-2.5 text-[13px] text-muted-foreground">
                  Nothing here.
                </p>
              ) : (
                <UpdateRows rows={rows} removeFlagged={draft.removeFlagged} onSwitch={setRemove} />
              )}
            </details>
          );
        })}
      </div>

      <UnknownRowsSection rows={preview.unknownRows} draft={draft} change={change} />
      <InvalidRowsSection rows={preview.invalidRows} />
    </div>
  );
}

function UpdateRows({
  rows,
  removeFlagged,
  onSwitch,
}: {
  rows: UpdateRow[];
  removeFlagged: Id[];
  onSwitch: (stackId: Id, remove: boolean) => void;
}) {
  return (
    <div className="max-h-[320px] overflow-auto border-[#eceef2] border-t">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 bg-[#f6f7f9] text-left text-muted-foreground text-xs uppercase tracking-[0.04em]">
          <tr>
            <th scope="col" className="px-3.5 py-2 font-semibold">
              Card
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              Printing
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              Finish
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              Condition
            </th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">
              File
            </th>
            <th scope="col" className="px-3.5 py-2 text-right font-semibold">
              App
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.key}>
              <tr aria-label={row.card.name} className="border-[#eceef2] border-t">
                <td className="px-3.5 py-2 font-semibold">{row.card.name}</td>
                <td className="px-2 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <i
                      aria-hidden="true"
                      className={cn(
                        'ss',
                        `ss-${row.printing.setCode}`,
                        `ss-${row.printing.rarity}`,
                      )}
                    />
                    {row.printing.setCode.toUpperCase()} #{row.printing.collectorNumber}
                  </span>
                </td>
                <td className="px-2 py-2">{finishWords[row.finish]}</td>
                <td className="px-2 py-2">{conditionWord(row.condition)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.fileQuantity}</td>
                <td className="px-3.5 py-2 text-right tabular-nums">{row.appQuantity}</td>
              </tr>
              {row.flagged.map((copy) => (
                <FlaggedCopyRow
                  key={copy.stackId}
                  copy={copy}
                  remove={removeFlagged.includes(copy.stackId)}
                  onSwitch={(remove) => onSwitch(copy.stackId, remove)}
                />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A deck-box copy the update would take out, with Jeff's Keep or Remove. Keep is the default. */
function FlaggedCopyRow({
  copy,
  remove,
  onSwitch,
}: {
  copy: FlaggedCopy;
  remove: boolean;
  onSwitch: (remove: boolean) => void;
}) {
  const label = `${copy.quantity} in ${copy.deck.name} deck box`;
  return (
    <tr className="bg-status-other-decks-soft/50">
      <td colSpan={6} className="px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-3 pl-4">
          <span className="flex flex-col">
            <span className="font-semibold">{label}</span>
            <span className="text-muted-foreground">
              Removing it would empty a slot in {copy.deck.name}.
            </span>
          </span>
          <fieldset
            aria-label={label}
            className="ml-auto inline-flex min-w-0 rounded-lg border border-border bg-card p-0.5"
          >
            {(['Keep', 'Remove'] as const).map((choice) => {
              const pressed = (choice === 'Remove') === remove;
              return (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => onSwitch(choice === 'Remove')}
                  className={cn(
                    'h-8 rounded-md px-3 font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    pressed && choice === 'Keep' && 'bg-status-in-box-soft text-status-in-box',
                    pressed && choice === 'Remove' && 'bg-status-missing-soft text-status-missing',
                    !pressed && 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {choice}
                </button>
              );
            })}
          </fieldset>
        </div>
      </td>
    </tr>
  );
}
