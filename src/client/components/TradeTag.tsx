import { cn } from '../lib/utils';

/** Marks a location (or the copies in it) as for trade: a teal "Trade" tag. */
export function TradeTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-trade bg-trade-soft px-1.5 font-bold text-[11px] text-trade leading-4',
        className,
      )}
    >
      Trade
    </span>
  );
}
