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

/**
 * Each domain's icon, as drawn on the UI canvas: a circle of its color with a glyph on a
 * 24-unit grid. They are original shapes, not Riot's artwork: Fury a flame, Calm a leaf,
 * Mind an eye, Body a mountain, Chaos a star, Order a shield (dark, so it reads on yellow).
 */
const DOMAIN_ICONS: Record<Domain, { fill: string; glyphFill: string; glyph: string }> = {
  fury: {
    fill: '#d0342c',
    glyphFill: '#ffffff',
    glyph:
      'M12 2.5c.9 3.2 5 5.2 5 10a5 5 0 0 1-10 0c0-2.2 1-3.8 2.4-5 .1 1.9 1 3 2.2 3.4-.6-3.1-.2-5.9.4-8.4z',
  },
  calm: {
    fill: '#2e8b57',
    glyphFill: '#ffffff',
    glyph: 'M4.5 19.5C4.5 10.5 10 5 19.5 4.5 19 14 13.5 19.5 4.5 19.5z',
  },
  mind: {
    fill: '#2f6fd6',
    glyphFill: '#ffffff',
    glyph:
      'M1.5 12S5.5 5.5 12 5.5 22.5 12 22.5 12 18.5 18.5 12 18.5 1.5 12 1.5 12zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7z',
  },
  body: {
    fill: '#e2771b',
    glyphFill: '#ffffff',
    glyph: 'M1.5 20 9 6.5l4 7 2.5-4L22.5 20z',
  },
  chaos: {
    fill: '#7b48c8',
    glyphFill: '#ffffff',
    glyph: 'M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6L12 22.5l-2.6-7.9L1.5 12l7.9-2.6z',
  },
  order: {
    fill: '#e3b11c',
    glyphFill: '#3d2e00',
    glyph: 'M12 2l8.5 3.3v6c0 5.4-3.6 9-8.5 10.7C7.1 20.3 3.5 16.7 3.5 11.3v-6z',
  },
};

/** One domain's icon, sized to the text around it; screen readers hear its name. */
export function DomainIcon({ domain, className }: { domain: Domain; className?: string }) {
  const { fill, glyphFill, glyph } = DOMAIN_ICONS[domain];
  return (
    <svg
      role="img"
      aria-label={DOMAIN_WORDS[domain]}
      data-domain={domain}
      viewBox="0 0 24 24"
      className={cn('inline-block size-[1em] shrink-0', className)}
    >
      <title>{DOMAIN_WORDS[domain]}</title>
      <circle cx="12" cy="12" r="12" fill={fill} />
      <path
        d={glyph}
        fill={glyphFill}
        fillRule="evenodd"
        transform="translate(4.56 4.56) scale(0.62)"
      />
    </svg>
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
