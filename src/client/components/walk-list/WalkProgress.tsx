import { cn } from '../../lib/utils';

/** How far the walk has got: a green bar and a count, such as "34 of 41 pulled". */
export function WalkProgress({
  done,
  total,
  label,
  className,
}: {
  done: number;
  total: number;
  /** After the count, such as "pulled" or "put away". */
  label?: string;
  className?: string;
}) {
  const percent = total === 0 ? 100 : Math.round((Math.min(done, total) / total) * 100);
  const text = `${done} of ${total}${label ? ` ${label}` : ''}`;
  return (
    <div className={cn('flex flex-wrap items-center gap-4', className)}>
      <div
        role="progressbar"
        aria-label={label ? `Cards ${label}` : 'Progress'}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={text}
        className="h-2.5 min-w-40 flex-1 overflow-hidden rounded-[5px] bg-[#e6e9ee]"
      >
        <div
          className="h-full rounded-[5px] bg-status-in-box-fill transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="font-bold tabular-nums">{text}</span>
    </div>
  );
}
