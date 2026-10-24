import type { PrintingSummary } from '../../../shared/api/common';
import type { PickLine } from '../../../shared/api/pick-list';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

/** Asks before pulling a copy out of another deck's box. */
export function ConfirmPullDialog({
  line,
  onConfirm,
  onCancel,
}: {
  /** The line being ticked; the dialog is closed when null. */
  line: PickLine | null;
  onConfirm: (line: PickLine) => void;
  onCancel: () => void;
}) {
  const deck = line?.fromDeck;
  return (
    <Dialog open={line !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        {line && deck && (
          <>
            <DialogHeader>
              <DialogTitle>
                Pull {line.card.name} from the {deck.name} deck box?
              </DialogTitle>
              <DialogDescription>
                {deck.becomesPartly
                  ? `${deck.name} becomes partly assembled.`
                  : `The copy moves out of the ${deck.name} deck box.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button onClick={() => onConfirm(line)}>Pull it</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Lets Jeff pick the printing for a proxy when the decklist names none (or names one not found). */
export function ProxyPrintingDialog({
  cardName,
  printings,
  onPick,
  onCancel,
}: {
  cardName: string | null;
  printings: PrintingSummary[];
  onPick: (printing: PrintingSummary) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={cardName !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pick a printing for the {cardName} proxy</DialogTitle>
          <DialogDescription>The proxy goes straight into the deck box.</DialogDescription>
        </DialogHeader>
        {printings.length === 0 ? (
          <p className="m-0 text-muted-foreground">There are no printings of this card.</p>
        ) : (
          <ul className="m-0 flex max-h-80 list-none flex-col gap-1 overflow-y-auto p-0">
            {printings.map((printing) => (
              <li key={printing.printingId}>
                <button
                  type="button"
                  onClick={() => onPick(printing)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span className="font-semibold">{printing.publicCode}</span>
                  <span className="truncate text-muted-foreground">{printing.setName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
