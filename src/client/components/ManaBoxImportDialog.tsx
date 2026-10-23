import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, FileText } from 'lucide-react';
import { Fragment, useCallback, useState } from 'react';
import { cn } from '../lib/utils';
import {
  emptyDraft,
  type ImportDraft,
  ImportError,
  plural,
  type StepDefinition,
} from './manabox-import/draft';
import { STEPS, type StepId, stepsFor } from './manabox-import/steps';
import { useUndoBar } from './UndoBar';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

export type ManaBoxImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Imports a ManaBox CSV into the collection, one step at a time. The steps live in
 * manabox-import/, one file each; nothing changes until Jeff confirms on the last step.
 */
export function ManaBoxImportDialog({ open, onOpenChange }: ManaBoxImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[820px]">
        {/* Mounted only while open, so each opening starts fresh. */}
        <ImportSteps onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ImportSteps({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  const [draft, setDraft] = useState<ImportDraft>(emptyDraft);
  const [stepId, setStepId] = useState<StepId>('file');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const change = useCallback((changes: Partial<ImportDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setError(null);
  }, []);

  const steps = stepsFor(draft);
  const index = Math.max(0, steps.indexOf(stepId));
  const step: StepDefinition = STEPS[steps[index]];
  const blocker = step.blocker(draft);
  const last = index === steps.length - 1;

  const fail = (caught: unknown) => {
    if (caught instanceof ImportError && caught.code === 'preview_expired') {
      // The server no longer holds the file, so the import starts over from the file.
      setDraft({ ...emptyDraft, mode: draft.mode, notice: caught.message });
      setStepId('file');
      setError(null);
      return;
    }
    setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.');
  };

  const question = step.confirm?.question?.(draft) ?? null;

  const next = async (answered = false) => {
    if (blocker || busy) return;
    if (question && !answered) {
      setAsking(true);
      return;
    }
    setAsking(false);
    setBusy(true);
    setError(null);
    try {
      if (step.confirm) {
        const result = await step.confirm.run(draft);
        undoBar.show({ message: result.message, batchId: result.batchId });
        // Copies were added, so every screen's counts and lists may be out of date.
        void queryClient.invalidateQueries();
        onDone();
        return;
      }
      const changes = step.leave ? await step.leave(draft) : {};
      const nextDraft = { ...draft, ...changes };
      setDraft(nextDraft);
      const nextSteps = stepsFor(nextDraft);
      setStepId(nextSteps[nextSteps.indexOf(steps[index]) + 1] ?? steps[index]);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const Body = step.Body;
  const preview = draft.preview;

  return (
    <>
      <div className="flex items-center justify-between gap-4 px-6 pt-[18px] pr-14">
        <DialogTitle className="font-normal font-serif text-[30px] leading-tight">
          Import from ManaBox
        </DialogTitle>
        <DialogDescription className="sr-only">
          Add the cards in a ManaBox CSV export to the collection, or make one location match it.
        </DialogDescription>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 border-border border-b px-6 py-4">
        <StepList steps={steps} current={index} />
        {preview && (
          <span className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-[#f6f7f9] px-2.5 py-1 text-[13px] text-muted-foreground">
            <FileText aria-hidden="true" className="size-4" />
            {preview.fileName} · {plural(preview.cardCount, 'card')}
          </span>
        )}
      </div>

      <div className="max-h-[calc(100vh-260px)] overflow-y-auto px-6 py-5">
        <Body draft={draft} change={change} />
        {error && (
          <p role="alert" className="mt-4 text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-border border-t bg-[#fbfbfc] px-6 py-3.5">
        <span className="text-[13px] text-muted-foreground">{blocker}</span>
        <span className="ml-auto flex gap-2.5">
          {index > 0 && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError(null);
                setStepId(steps[index - 1]);
              }}
            >
              Back
            </Button>
          )}
          {(!last || step.confirm) && (
            <Button disabled={blocker !== null || busy} onClick={() => next()}>
              {step.confirm ? (
                busy ? (
                  'Importing…'
                ) : (
                  step.confirm.label(draft)
                )
              ) : busy ? (
                'Reading the file…'
              ) : (
                <>
                  Next: {STEPS[steps[index + 1]].label}
                  <ChevronRight aria-hidden="true" />
                </>
              )}
            </Button>
          )}
        </span>
      </div>

      {question && (
        <Dialog open={asking} onOpenChange={setAsking}>
          <DialogContent className="sm:max-w-[440px]" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{question.title}</DialogTitle>
              <DialogDescription>{question.text}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => next(true)}>
                {question.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** The steps across the top: done ones ticked, the current one highlighted. */
function StepList({ steps, current }: { steps: StepId[]; current: number }) {
  return (
    <ol aria-label="Steps" className="flex items-center gap-2.5">
      {steps.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && (
            <li
              aria-hidden="true"
              className={cn('h-0.5 w-10', i <= current ? 'bg-status-in-box-fill' : 'bg-border')}
            />
          )}
          <li
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2',
              i < current && 'font-semibold text-status-in-box',
              i === current && 'font-bold text-[#1b3f9c]',
              i > current && 'font-medium text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'inline-flex size-6 items-center justify-center rounded-full text-[13px]',
                i < current && 'bg-status-in-box-soft',
                i === current && 'bg-primary text-primary-foreground',
                i > current && 'border-[1.5px] border-[#c9ced6]',
              )}
            >
              {i < current ? <Check aria-hidden="true" className="size-3.5" /> : i + 1}
            </span>
            {STEPS[id].label}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
