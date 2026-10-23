import { FileText, Plus, RefreshCw, Upload } from 'lucide-react';
import { type DragEvent, type ReactNode, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { emptyDraft, type ImportMode, type StepProps } from './draft';

/** Step 1: choose the CSV and what the import does. */
export function FileStep({ draft, change }: StepProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // A new file or mode starts the later steps over.
  const choose = (file: File | undefined) => {
    if (file) change({ ...emptyDraft, mode: draft.mode, file });
  };
  const pickMode = (mode: ImportMode) => {
    if (mode !== draft.mode) change({ ...emptyDraft, mode, file: draft.file });
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  };

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-bold text-[15px]">What should this import do?</legend>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <ModeButton
            pressed={draft.mode === 'add'}
            onClick={() => pickMode('add')}
            icon={<Plus aria-hidden="true" className="size-4" />}
            title="Add copies"
            text="New cards join the collection. Nothing already here changes."
          />
          <ModeButton
            pressed={draft.mode === 'update'}
            onClick={() => pickMode('update')}
            icon={<RefreshCw aria-hidden="true" className="size-4" />}
            title="Update a location"
            text="Make one location match the file: add, adjust and remove stacks."
          />
        </div>
      </fieldset>

      <section
        aria-label="ManaBox CSV file"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border-2 border-border border-dashed bg-[#fbfbfc] px-6 py-7 text-center',
          dragging && 'border-primary bg-[#f3f6fe]',
        )}
      >
        {draft.file ? (
          <p className="flex items-center gap-2 font-semibold">
            <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
            {draft.file.name}
          </p>
        ) : (
          <p className="text-muted-foreground">
            Drop the CSV exported from ManaBox here, or choose it.
          </p>
        )}
        <Button type="button" variant="outline" onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" />
          {draft.file ? 'Choose another file' : 'Choose file'}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          aria-label="ManaBox CSV"
          className="hidden"
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </section>

      {draft.notice && (
        <p role="alert" className="text-[13px] text-destructive">
          {draft.notice}
        </p>
      )}
    </div>
  );
}

function ModeButton({
  pressed,
  onClick,
  icon,
  title,
  text,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-1 rounded-[10px] border-2 px-3.5 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        pressed ? 'border-primary bg-[#f3f6fe]' : 'border-border bg-card hover:border-[#9fb4e8]',
      )}
    >
      <span className="flex items-center gap-2 font-bold text-[15px]">
        {icon}
        {title}
      </span>
      <span className="text-[13px] text-muted-foreground">{text}</span>
    </button>
  );
}
