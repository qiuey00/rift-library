const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** A value in US cents as Jeff reads it, such as "$1,046.20". */
export function formatCents(cents: number): string {
  return dollars.format(cents / 100);
}

const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Where the prices come from and how fresh they are, such as "TCGplayer prices, updated
 * today". Prices are TCGplayer's US dollar market prices.
 */
export function pricesUpdated(at: string | null, now = new Date()): string {
  if (at === null) return 'no prices loaded yet';
  const when = new Date(at);
  const daysAgo = Math.round((startOfDay(now) - startOfDay(when)) / 86_400_000);
  const words = daysAgo <= 0 ? 'today' : daysAgo === 1 ? 'yesterday' : day.format(when);
  return `TCGplayer prices, updated ${words}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
