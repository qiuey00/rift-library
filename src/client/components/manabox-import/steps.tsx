import { applyAddCopies, applyUpdate, previewAddCopies } from './api';
import { BinderStep, binderApplyFields, binderBlocker, binderConfirmLabel } from './BinderStep';
import { type ImportDraft, plural, type StepDefinition } from './draft';
import { FileStep } from './FileStep';
import { LocationStep } from './LocationStep';
import { cardsToAdd, openRows, PreviewStep } from './PreviewStep';
import {
  leaveUpdateLocation,
  UpdateLocationStep,
  updateLocationBlocker,
} from './UpdateLocationStep';
import { cardsToRemove, UpdatePreviewStep, updateBlocker } from './UpdatePreviewStep';

/**
 * Every step of the ManaBox import dialog, by name. A step is one component file plus an entry
 * here; `stepsFor` says which steps a draft goes through, in order.
 */
export const STEPS = {
  file: {
    label: 'File',
    Body: FileStep,
    blocker: (draft) => (draft.file ? null : 'Choose the CSV exported from ManaBox first.'),
    leave: async (draft) => {
      // Update a location reads the file in its own step (#28).
      if (draft.mode !== 'add' || !draft.file || draft.preview) return {};
      return { preview: await previewAddCopies(draft.file) };
    },
  },
  location: {
    label: 'Location',
    Body: LocationStep,
    blocker: (draft) => (draft.target ? null : 'Pick where the cards go first.'),
  },
  // The binder mapping step, for files with a Binder Name column.
  binders: { label: 'Binders', Body: BinderStep, blocker: binderBlocker },
  preview: {
    label: 'Preview',
    Body: PreviewStep,
    blocker: (draft) => {
      const open = openRows(draft).length;
      if (open === 0) return null;
      return open === 1
        ? 'Fix or skip the unknown row first.'
        : `Fix or skip the ${open} unknown rows first.`;
    },
    confirm: {
      label: (draft) => {
        if (draft.preview?.hasBinderColumn) return binderConfirmLabel(draft);
        const cards = cardsToAdd(draft);
        const where = draft.target?.name ?? 'the collection';
        return `Add ${cards.toLocaleString('en-US')} ${cards === 1 ? 'card' : 'cards'} to ${where}`;
      },
      run: async (draft) => {
        const preview = draft.preview;
        const binders = preview?.hasBinderColumn === true;
        if (!preview || (!binders && !draft.target)) throw new Error('Nothing to import yet.');
        return applyAddCopies({
          previewId: preview.previewId,
          ...(binders ? binderApplyFields(draft) : { targetLocationId: draft.target?.id }),
          allProxies: !preview.hasProxyColumn && draft.allProxies,
          fixes: Object.fromEntries(
            Object.entries(draft.fixes).map(([row, fix]) => [row, fix.scryfallId]),
          ),
          skips: draft.skips,
        });
      },
    },
  },
  // Update a location: the location the file describes, then what changes.
  updateLocation: {
    label: 'Location',
    Body: UpdateLocationStep,
    blocker: updateLocationBlocker,
    leave: leaveUpdateLocation,
  },
  updatePreview: {
    label: 'Preview',
    Body: UpdatePreviewStep,
    blocker: updateBlocker,
    confirm: {
      label: (draft) => `Update ${draft.updatePreview?.location.name ?? 'the location'}`,
      question: (draft) => {
        const cards = cardsToRemove(draft);
        if (cards === 0) return null;
        const where = draft.updatePreview?.location.name ?? 'the location';
        return {
          title: `Remove ${plural(cards, 'card')} from ${where}?`,
          text: 'They come out of the collection. Undo puts them back.',
          confirm: `Remove ${plural(cards, 'card')} and update`,
        };
      },
      run: async (draft) => {
        const preview = draft.updatePreview;
        if (!preview) throw new Error('Nothing to import yet.');
        return applyUpdate({
          previewId: preview.previewId,
          removeFlagged: draft.removeFlagged,
          fixes: Object.fromEntries(
            Object.entries(draft.fixes).map(([row, fix]) => [row, fix.scryfallId]),
          ),
          skips: draft.skips,
        });
      },
    },
  },
} satisfies Record<string, StepDefinition>;

export type StepId = keyof typeof STEPS;

/** The steps a draft goes through, in order. */
export function stepsFor(draft: ImportDraft): StepId[] {
  if (draft.mode === 'update') return ['file', 'updateLocation', 'updatePreview'];
  return ['file', draft.preview?.hasBinderColumn ? 'binders' : 'location', 'preview'];
}
