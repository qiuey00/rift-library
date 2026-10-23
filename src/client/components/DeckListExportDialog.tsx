import { ComingSoonDialog } from './ComingSoonDialog';

/** What the dialog exports: a deck, or a location such as a trade binder. */
export type DeckListExportSource =
  | { kind: 'deck'; deckId: number; deckName: string }
  | { kind: 'location'; locationId: number; locationName: string; forTrade?: boolean };

/** Copies or downloads a deck or a location as a deck list. Placeholder until #24. */
export function DeckListExportDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: DeckListExportSource;
}) {
  const name = source.kind === 'deck' ? source.deckName : source.locationName;
  return <ComingSoonDialog title={`Export ${name}`} open={open} onOpenChange={onOpenChange} />;
}
