import type { ReactNode } from 'react';
import type { LocationRef } from '../../../shared/api/common';
import { cn } from '../../lib/utils';
import { LocationTile } from '../LocationTile';

/**
 * One stop on the walk: a header with the location's tile, its path and how many cards to
 * move here, then its lines.
 */
export function WalkGroup({
  location,
  title,
  countText,
  tone = 'default',
  headerAction,
  children,
}: {
  location?: LocationRef;
  /** The heading; the location's path when left out. */
  title?: ReactNode;
  /** Such as "pull 6 here" or "put 6 here". */
  countText: string;
  tone?: 'default' | 'warning';
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const heading = title ?? location?.path;
  return (
    <section
      aria-label={typeof heading === 'string' ? heading : undefined}
      data-slot="walk-group"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3',
          tone === 'warning'
            ? 'border-[#f0dfc0] bg-status-other-decks-soft'
            : 'border-border bg-[#f6f7f9]',
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {location && <LocationTile type={location.type} color={location.color} />}
          <h2 className="m-0 truncate font-bold text-base">{heading}</h2>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'font-semibold text-[13px]',
              tone === 'warning' ? 'text-status-other-decks' : 'text-muted-foreground',
            )}
          >
            {countText}
          </span>
          {headerAction}
        </div>
      </div>
      <ul className="m-0 list-none py-1">{children}</ul>
    </section>
  );
}
