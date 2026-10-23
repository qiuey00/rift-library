import type { ReactNode } from 'react';
import type { ActionResult, Id } from '../../../shared/api/common';
import type { ManaBoxPreview, NewLocation, RowNumber } from '../../../shared/api/manabox';
import type { UpdatePreview } from '../../../shared/api/manabox-update';

/** What the import does: add the file's copies, or make one location match the file (#28). */
export type ImportMode = 'add' | 'update';

/** Where one ManaBox binder or deck goes: an existing location, or a new one made for it. */
export type BinderChoice =
  | { kind: 'existing'; locationId: Id }
  | { kind: 'new'; location: NewLocation };

/** The printing Jeff picked for an unknown row, with what the preview shows for it. */
export type RowFix = { scryfallId: string; label: string };

/**
 * Everything the dialog's steps have chosen so far. Each step reads it and changes it through
 * `change`; the steps a mode needs come from `stepsFor` in steps.tsx.
 */
export type ImportDraft = {
  mode: ImportMode;
  file: File | null;
  /** The server's preview of the file in Add copies mode, read when Jeff leaves the file step. */
  preview: ManaBoxPreview | null;
  /**
   * Where the copies go when the file has no binders, or the location an update makes match the
   * file; null until a location step picks one.
   */
  target: { id: Id; name: string } | null;
  /** The server's preview of an Update a location import, read when Jeff leaves its location step. */
  updatePreview: UpdatePreview | null;
  /** Flagged deck-box stacks Jeff switched to Remove in an update; every other one is kept. */
  removeFlagged: Id[];
  /**
   * Jeff's choices on the binder mapping step, by binder key. A binder without one goes to its
   * remembered location, if it has one.
   */
  binderChoices: Record<string, BinderChoice>;
  /** "These are all proxies", only offered when the file has no Proxy column. */
  allProxies: boolean;
  fixes: Record<RowNumber, RowFix>;
  skips: RowNumber[];
  /** A message for the file step, such as a preview that expired. */
  notice: string | null;
};

export const emptyDraft: ImportDraft = {
  mode: 'add',
  file: null,
  preview: null,
  target: null,
  updatePreview: null,
  removeFlagged: [],
  binderChoices: {},
  allProxies: false,
  fixes: {},
  skips: [],
  notice: null,
};

export type StepProps = {
  draft: ImportDraft;
  change: (changes: Partial<ImportDraft>) => void;
};

/** One step of the dialog. Adding a step means one new file and one entry in steps.tsx. */
export type StepDefinition = {
  /** The step's name in the step list at the top of the dialog. */
  label: string;
  Body: (props: StepProps) => ReactNode;
  /** Why the step can't go on yet, said under the buttons, or null when it can. */
  blocker: (draft: ImportDraft) => string | null;
  /** Work to finish before the next step, such as reading the file; answers draft changes. */
  leave?: (draft: ImportDraft) => Promise<Partial<ImportDraft>>;
  /** On the last step: the button that applies the import, and what it sends. */
  confirm?: {
    label: (draft: ImportDraft) => string;
    /** A question to ask once more before running, such as when the import removes cards. */
    question?: (draft: ImportDraft) => { title: string; text: string; confirm: string } | null;
    run: (draft: ImportDraft) => Promise<ActionResult>;
  };
};

/** An error answer from the server, keeping its code so the dialog can react to it. */
export class ImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}
