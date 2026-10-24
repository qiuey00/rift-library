import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import type { Finish } from '../../../shared/api/common';
import { cn } from '../../lib/utils';
import { ProxyTag } from '../ProxyTag';
import type { WalkCopy, WalkLineData, WalkTag } from './types';

const finishWord: Record<Finish, string> = { normal: 'Normal', foil: 'Foil' };

/** "near_mint" reads "Near mint". */
function conditionWord(condition: string) {
  const words = condition.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A copy as Jeff reads it on a line, such as "OGN #126 · Foil · Near mint". */
export function copyText(copy: WalkCopy) {
  return `${copy.setCode} #${copy.collectorNumber} · ${finishWord[copy.finish]} · ${conditionWord(copy.condition)}`;
}

/** A copy's details, then a Proxy tag for proxies. */
export function CopyLabel({ copy, className }: { copy: WalkCopy; className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2', className)}>
      <span data-set={copy.setCode}>{copyText(copy)}</span>
      {copy.isProxy && <ProxyTag />}
    </span>
  );
}

const tagTone: Record<NonNullable<WalkTag['tone']>, string> = {
  info: 'bg-[#e8eefc] text-[#1b3f9c]',
  missing: 'bg-status-missing-soft text-status-missing',
  warning: 'bg-status-other-decks-soft text-status-other-decks',
  trade: 'border border-trade bg-trade-soft text-trade',
};

/** A line's tag, such as "From trade binder". */
export function TagChip({ tag }: { tag: WalkTag }) {
  return (
    <span
      className={cn('rounded-sm px-1.5 py-px font-bold text-[11px]', tagTone[tag.tone ?? 'info'])}
    >
      {tag.text}
    </span>
  );
}

/**
 * One line of a walk list: a checkbox, how many, the card (its image shows on hover), the
 * copy to look for, and Jeff's actions at the right. A ticked line greys out.
 */
export function WalkLine({
  line,
  current = false,
  onToggle,
  onSelect,
  actions,
}: {
  line: WalkLineData;
  /** The line the walk is on: highlighted, and what Space ticks. */
  current?: boolean;
  onToggle: (line: WalkLineData) => void;
  /** Jeff clicked or tabbed into the line, so it becomes the current one. */
  onSelect?: (line: WalkLineData) => void;
  /** Such as Switch copy, a ⋯ menu or buttons. */
  actions?: ReactNode;
}) {
  const [showImage, setShowImage] = useState(false);
  const image = line.card.imageUrl ?? line.card.imageUrl;
  const checkboxId = `walk-line-${line.key}`;
  return (
    <li
      data-walk-line={line.key}
      data-done={line.done || undefined}
      aria-current={current ? 'step' : undefined}
      onFocus={() => onSelect?.(line)}
      onMouseDown={() => onSelect?.(line)}
      className={cn(
        'grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-[#f0f2f5] border-t px-4 py-2.5 first:border-t-0 hover:bg-[#f6f8fb]',
        current && 'bg-[#eef3fd] shadow-[inset_3px_0_0_var(--color-primary)] hover:bg-[#eef3fd]',
      )}
    >
      <input
        id={checkboxId}
        type="checkbox"
        checked={line.done}
        onChange={() => onToggle(line)}
        aria-label={`${line.quantity} ${line.card.name}`}
        className="m-0 size-5 cursor-pointer accent-status-in-box-fill"
      />
      <div className={cn('flex min-w-0 flex-col gap-0.5', line.done && 'opacity-50')}>
        <span className="relative flex min-w-0 items-center gap-2">
          <span className={cn('truncate font-semibold text-[15px]', line.done && 'line-through')}>
            {line.quantity}{' '}
            <Link
              to={`/cards/${line.card.id}`}
              className="text-foreground hover:text-primary hover:underline"
              onMouseEnter={() => setShowImage(true)}
              onMouseLeave={() => setShowImage(false)}
            >
              {line.card.name}
            </Link>
          </span>
          {showImage && image && (
            <img
              src={image}
              alt=""
              data-slot="hover-image"
              className="pointer-events-none absolute top-6 left-6 z-20 w-60 rounded-[12px] shadow-xl"
            />
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <CopyLabel copy={line.copy} />
          {line.tag && <TagChip tag={line.tag} />}
        </span>
        {line.note && <span className="text-[13px] text-status-other-decks">{line.note}</span>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </li>
  );
}
