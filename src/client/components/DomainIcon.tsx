import type { Domain } from '../../shared/api/common';
import { cn } from '../lib/utils';

/** Each domain's name as screens write it. */
export const DOMAIN_WORDS: Record<Domain, string> = {
  fury: 'Fury',
  calm: 'Calm',
  mind: 'Mind',
  body: 'Body',
  chaos: 'Chaos',
  order: 'Order',
};

/** Placeholder colors until the domain icons are drawn. */
const DOMAIN_DOTS: Record<Domain, string> = {
  fury: 'bg-red-500',
  calm: 'bg-green-500',
  mind: 'bg-blue-500',
  body: 'bg-orange-500',
  chaos: 'bg-purple-500',
  order: 'bg-yellow-400',
};

/** One domain as a colored dot (a placeholder for its icon); screen readers hear its name. */
export function DomainIcon({ domain, className }: { domain: Domain; className?: string }) {
  return (
    <span
      role="img"
      aria-label={DOMAIN_WORDS[domain]}
      title={DOMAIN_WORDS[domain]}
      className={cn(
        'inline-block size-[0.8em] shrink-0 rounded-full',
        DOMAIN_DOTS[domain],
        className,
      )}
    />
  );
}

/** A card's or deck's domains in a row; nothing when there are none. */
export function DomainIcons({ domains, className }: { domains: Domain[]; className?: string }) {
  if (domains.length === 0) return null;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-[0.2em]', className)}>
      {domains.map((domain) => (
        <DomainIcon key={domain} domain={domain} />
      ))}
    </span>
  );
}
