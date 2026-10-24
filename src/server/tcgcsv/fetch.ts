import { z } from 'zod';

// Reads TCGCSV's daily copies of TCGplayer's price data. TCGCSV is free and needs no key;
// Riftbound is category 89, with one group per set (plus promos and bundles). The app reads
// the list of groups, then each group's prices, with a short pause between requests.

export const TCGCSV_URL = 'https://tcgcsv.com';
export const RIFTBOUND_CATEGORY = 89;
export const REQUEST_GAP_MS = 200;
export const TCGCSV_HEADERS = {
  'User-Agent': 'RiftLibrary/0.1',
  Accept: 'application/json',
};

/** One TCGplayer group, such as Origins (OGN). */
export const TcgcsvGroup = z.object({
  groupId: z.number().int(),
  name: z.string(),
  abbreviation: z.string().nullish(),
});
export type TcgcsvGroup = z.infer<typeof TcgcsvGroup>;

/** One product's price in one subtype; `marketPrice` is in dollars, null when TCGplayer has none. */
export const TcgcsvPrice = z.object({
  productId: z.number().int(),
  subTypeName: z.string(),
  marketPrice: z.number().nullish(),
});
export type TcgcsvPrice = z.infer<typeof TcgcsvPrice>;

const Answer = <T extends z.ZodType>(item: T) =>
  z.object({
    success: z.boolean(),
    errors: z.array(z.unknown()).optional(),
    results: z.array(item),
  });

export interface FetchOptions {
  signal?: AbortSignal;
  /** The pause between requests; tests set 0. */
  gapMs?: number;
}

async function get<T extends z.ZodType>(path: string, item: T, signal?: AbortSignal) {
  const url = `${TCGCSV_URL}/tcgplayer/${RIFTBOUND_CATEGORY}${path}`;
  const response = await fetch(url, { headers: TCGCSV_HEADERS, signal });
  if (!response.ok) throw new Error(`TCGCSV answered ${response.status} to ${url}`);
  const body = Answer(item).parse(await response.json());
  if (!body.success) throw new Error(`TCGCSV reported errors for ${url}`);
  return body.results as z.infer<T>[];
}

/** Every Riftbound group. */
export function fetchGroups({ signal }: FetchOptions = {}) {
  return get('/groups', TcgcsvGroup, signal);
}

/** Every price entry in one group. */
export function fetchGroupPrices(groupId: number, { signal }: FetchOptions = {}) {
  return get(`/${groupId}/prices`, TcgcsvPrice, signal);
}

export function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
