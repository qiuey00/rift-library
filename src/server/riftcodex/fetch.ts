import { RiftcodexCard, RiftcodexPage, RiftcodexSet } from './records';

// Reads Riftcodex's paged lists. Riftcodex is free and needs no key; the app asks for 100
// records a request, its largest page, with a short pause between requests.

export const RIFTCODEX_URL = 'https://api.riftcodex.com';
export const PAGE_SIZE = 100;
export const REQUEST_GAP_MS = 200;
/** Far more pages than Riftcodex has (about 15 for cards), so a paging bug can't run forever. */
export const MAX_PAGES = 200;
export const RIFTCODEX_HEADERS = {
  'User-Agent': 'RiftLibrary/0.1',
  Accept: 'application/json',
};

export interface FetchOptions {
  signal?: AbortSignal;
  /** Called after each page with the pages read and the pages there are. */
  onPage?: (read: number, pages: number) => void;
  /** The pause between requests; tests set 0. */
  gapMs?: number;
}

/** Every record of a paged list, in order, not checked yet. */
export async function fetchAllPages(
  path: string,
  query: Record<string, string>,
  { signal, onPage, gapMs = REQUEST_GAP_MS }: FetchOptions = {},
): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1 && gapMs > 0) await pause(gapMs, signal);
    const url = new URL(path, RIFTCODEX_URL);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(PAGE_SIZE));

    const response = await fetch(url.toString(), { headers: RIFTCODEX_HEADERS, signal });
    if (!response.ok) throw new Error(`Riftcodex answered ${response.status} to ${url}`);
    const body = RiftcodexPage.parse(await response.json());
    items.push(...body.items);
    onPage?.(page, Math.max(body.pages, page));
    if (body.items.length === 0 || page >= body.pages) return items;
  }
  throw new Error(`Riftcodex listed more than ${MAX_PAGES} pages for ${path}`);
}

/** Checks each record, skipping and counting the ones that don't match the schema. */
export function checkRecords(values: unknown[]) {
  const records: RiftcodexCard[] = [];
  let skipped = 0;
  for (const value of values) {
    const parsed = RiftcodexCard.safeParse(value);
    if (parsed.success) records.push(parsed.data);
    else skipped += 1;
  }
  return { records, skipped };
}

/** Every set's name, by set code (upper case, such as "OGN"). */
export async function fetchSetNames(options: FetchOptions = {}) {
  const names = new Map<string, string>();
  for (const value of await fetchAllPages('/sets', {}, options)) {
    const parsed = RiftcodexSet.safeParse(value);
    if (parsed.success) names.set(parsed.data.set_id.toUpperCase(), parsed.data.name);
  }
  return names;
}

function pause(ms: number, signal?: AbortSignal) {
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
