import { useId } from 'react';
import { LocationPicker, useLocationTree } from '../LocationPicker';
import { previewUpdate } from './api';
import type { ImportDraft, StepProps } from './draft';

export function updateLocationBlocker(draft: ImportDraft) {
  return draft.target ? null : 'Pick the location the file describes first.';
}

/** Reads the file against the picked location, unless that preview is already here. */
export async function leaveUpdateLocation(draft: ImportDraft): Promise<Partial<ImportDraft>> {
  if (!draft.file || !draft.target || draft.updatePreview) return {};
  return { updatePreview: await previewUpdate(draft.file, draft.target.id) };
}

/** Update a location, step 2: the location the file describes. There is no default. */
export function UpdateLocationStep({ draft, change }: StepProps) {
  const id = useId();
  const tree = useLocationTree();
  const nodes = tree.data?.nodes ?? [];

  return (
    <section className="flex flex-col gap-2">
      <label htmlFor={id} className="font-bold text-[15px]">
        Which location does this file describe?
      </label>
      <div className="max-w-[420px]">
        <LocationPicker
          id={id}
          value={draft.target?.id ?? null}
          onChange={(locationId) => {
            const node = nodes.find((n) => n.id === locationId);
            if (!node || node.id === draft.target?.id) return;
            // Another location means another comparison, so earlier choices no longer apply.
            change({
              target: { id: node.id, name: node.name },
              updatePreview: null,
              removeFlagged: [],
              fixes: {},
              skips: [],
            });
          }}
          excludeDeckBoxes
          placeholder="Pick a location"
        />
      </div>
      <p className="text-[13px] text-muted-foreground">
        The location will match the file: new cards are added, quantities change and cards missing
        from the file are removed. Copies in deck boxes that came from it count too.
      </p>
    </section>
  );
}
