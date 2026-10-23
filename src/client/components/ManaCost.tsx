import { Fragment } from 'react';
import { cn } from '../lib/utils';

/**
 * The Mana font class for one symbol from Scryfall's cost text, such as `{2}` → `ms-2`,
 * `{G/U}` → `ms-gu`, `{2/W}` → `ms-2w`, `{T}` → `ms-tap`.
 */
export function manaSymbolClass(symbol: string): string {
  const s = symbol.toLowerCase().replaceAll('/', '');
  if (s === 't') return 'ms-tap';
  if (s === 'q') return 'ms-untap';
  if (s === '½') return 'ms-1-2';
  if (s === '∞') return 'ms-infinity';
  return `ms-${s}`;
}

/** Splits cost text into faces (split by " // ") and each face into its symbols. */
export function parseManaCost(cost: string): string[][] {
  if (cost.trim() === '') return [];
  return cost.split(' // ').map((face) => [...face.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]));
}

/** Mana font class names for a Scryfall mana cost, such as "{2}{W/U}{G/P}" → ["2", "wu", "gp"]. */
export function manaSymbols(cost: string): string[] {
  return parseManaCost(cost)
    .flat()
    .map((symbol) => manaSymbolClass(symbol).slice('ms-'.length));
}

/**
 * A mana cost drawn with the Mana font, such as `{1}{U}`. Double-faced cards show each
 * face's cost with "//" between, or only the front face's with `frontOnly`. Screen readers
 * hear the cost text itself.
 */
export function ManaCost({
  cost,
  className,
  frontOnly = false,
}: {
  cost: string;
  className?: string;
  frontOnly?: boolean;
}) {
  const shown = frontOnly ? (cost.split(' // ')[0] ?? '') : cost;
  const faces = parseManaCost(shown);
  if (faces.every((symbols) => symbols.length === 0)) return null;
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-[0.15em] whitespace-nowrap', className)}
    >
      <span className="sr-only">Mana cost {shown}</span>
      {faces.map((symbols, face) => (
        // Faces never reorder, so their position is a steady key.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <Fragment key={face}>
          {face > 0 && (
            <span aria-hidden="true" className="px-[0.2em] text-muted-foreground">
              {'//'}
            </span>
          )}
          {symbols.map((symbol, i) => (
            <i
              // biome-ignore lint/suspicious/noArrayIndexKey: a cost can repeat a symbol
              key={i}
              aria-hidden="true"
              className={cn('ms ms-cost ms-shadow', manaSymbolClass(symbol))}
            />
          ))}
        </Fragment>
      ))}
    </span>
  );
}
