import { cn } from '../lib/utils';

/** Marks a proxy copy: an outlined "Proxy" tag with a dashed border. */
export function ProxyTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-proxy border-dashed px-1.5 font-bold text-[11px] text-proxy-ink leading-4',
        className,
      )}
    >
      Proxy
    </span>
  );
}
