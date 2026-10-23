import { MapPin } from 'lucide-react';
import type { LocationRef } from '../../../shared/api/common';
import { LocationTile } from '../LocationTile';
import { Panel } from '../Panel';
import type { WalkLineData } from './types';
import { CopyLabel } from './WalkLine';
import { WalkProgress } from './WalkProgress';

export type KeyHint = { keys: string[]; action: string };

const defaultHints: KeyHint[] = [
  { keys: ['↑', '↓'], action: 'move' },
  { keys: ['Space'], action: 'tick' },
];

/** A key as it looks on the keyboard. */
export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-[4px] border border-input border-b-2 bg-[#f6f7f9] px-1.5 font-sans">
      {children}
    </kbd>
  );
}

/**
 * The pane beside a walk list: where to go, the current card's image and copy, the keys,
 * and the progress. It follows the walk list's current line.
 */
export function NowPickingPane({
  heading = 'Now picking',
  line,
  location,
  locationNote,
  progress,
  hints = defaultHints,
}: {
  heading?: string;
  /** The current line; null once every line is ticked. */
  line: WalkLineData | null;
  /** Where the current card is (or goes); null for a section that isn't a location. */
  location: LocationRef | null;
  /** Under the location, such as "Stop 2 of 5". */
  locationNote?: string;
  progress: { done: number; total: number; label?: string };
  hints?: KeyHint[];
}) {
  const image = line ? (line.card.imageNormal ?? line.card.imageSmall) : null;
  return (
    <Panel role="complementary" aria-label={heading} className="flex flex-col gap-3.5 p-4">
      <span className="font-bold text-muted-foreground text-xs uppercase tracking-[0.06em]">
        {heading}
      </span>
      {line ? (
        <>
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-bold text-xl leading-tight">
              {location ? (
                <LocationTile type={location.type} color={location.color} />
              ) : (
                <MapPin aria-hidden="true" className="size-5 text-primary" />
              )}
              <span data-slot="pane-location">{location?.path ?? 'Not in storage'}</span>
            </span>
            {locationNote && (
              <span className="text-[13px] text-muted-foreground">{locationNote}</span>
            )}
          </div>
          <div className="flex justify-center">
            {image ? (
              <img
                src={image}
                alt={line.card.name}
                className="aspect-[488/680] w-full max-w-[258px] rounded-[12px] bg-muted object-contain"
              />
            ) : (
              <div className="flex aspect-[488/680] w-full max-w-[258px] items-center justify-center rounded-[12px] bg-muted p-4 text-center font-semibold">
                {line.card.name}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">
              {line.quantity} {line.card.name}
            </span>
            <CopyLabel copy={line.copy} className="text-[#2b303b]" />
          </div>
        </>
      ) : (
        <p className="m-0 text-muted-foreground">Every line is ticked.</p>
      )}
      <WalkProgress {...progress} />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        {hints.map((hint) => (
          <span key={hint.action} className="inline-flex items-center gap-1">
            {hint.keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
            <span className="ml-0.5">{hint.action}</span>
          </span>
        ))}
      </div>
    </Panel>
  );
}
