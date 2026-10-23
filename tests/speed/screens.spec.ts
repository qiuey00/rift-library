import { expect, type Page, test } from '@playwright/test';
import type { StacksPage } from '../../src/shared/api/stacks';

// The screens with about 10,000 copies (PLAT-6): the Collection scrolls through every copy
// stack without stalling, and a deck view shows its decklist within a second.

/**
 * Work on the page's main thread longer than this at once is a visible stall while scrolling.
 * The check counts the page's long tasks rather than frame times, because a test runner's
 * headless browser often paints only every second or third display frame whatever the page does.
 */
const LONGEST_TASK_MS = 200;

test.beforeEach(async ({ page }) => {
  // Card images come from the internet; these checks never reach it.
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
});

type Recorded = { frames: number[]; tasks: number[] };

/** Starts recording the time between animation frames and every long task in the page. */
async function record(page: Page) {
  await page.evaluate(() => {
    const recorded: Recorded = { frames: [], tasks: [] };
    (window as unknown as { recorded: Recorded }).recorded = recorded;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) recorded.tasks.push(entry.duration);
    }).observe({ type: 'longtask' });
    let last = performance.now();
    const tick = (now: number) => {
      recorded.frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function recorded(page: Page) {
  const { frames, tasks } = await page.evaluate(
    () => (window as unknown as { recorded: Recorded }).recorded,
  );
  const sorted = [...frames].sort((a, b) => a - b);
  return {
    frames: frames.length,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    longTasks: tasks.length,
    longestTask: Math.max(0, ...tasks),
  };
}

test('the Collection scrolls through every copy stack smoothly', async ({ page }) => {
  test.setTimeout(120_000);
  let loaded = 0;
  let lastPage = false;
  page.on('response', async (res) => {
    if (new URL(res.url()).pathname !== '/api/stacks' || !res.ok()) return;
    const body = (await res.json()) as StacksPage;
    loaded += body.rows.length;
    if (body.nextCursor === null) lastPage = true;
  });

  await page.goto('/collection');
  await expect(page.getByTestId('collection-totals')).toContainText('in 7,000 stacks');
  await expect(page.locator('tbody tr[data-stack-id]').first()).toBeVisible();
  await record(page);

  const started = Date.now();
  await page.mouse.move(600, 400);
  let atBottom = false;
  while (!(lastPage && atBottom)) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(16);
    atBottom = await page.evaluate(
      () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
    );
    expect(Date.now() - started, 'scrolling to the end').toBeLessThan(90_000);
  }
  // The last copy stack in the list is on screen.
  await expect(page.locator('tbody tr[data-stack-id]').last()).toBeInViewport();
  expect(loaded).toBe(7_000);

  const seen = await recorded(page);
  console.log(
    `Scrolled through 7,000 stacks in ${((Date.now() - started) / 1000).toFixed(1)} s: ` +
      `${seen.frames} frames, 95% under ${seen.p95.toFixed(1)} ms; ` +
      `${seen.longTasks} tasks over 50 ms, longest ${seen.longestTask.toFixed(0)} ms.`,
  );
  expect(seen.longestTask).toBeLessThan(LONGEST_TASK_MS);
});

test('a deck view shows its decklist within a second', async ({ page, request }) => {
  const decks = (await (await request.get('/api/decks')).json()) as {
    decks: { id: number; name: string }[];
  };
  // Load the app frame first, so the second counts the deck view itself.
  await page.goto('/decks');
  for (const deck of decks.decks.slice(0, 3)) {
    const started = Date.now();
    await page.goto(`/decks/${deck.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(deck.name);
    await expect(page.locator('li[data-slot-id]').first()).toBeVisible();
    const ms = Date.now() - started;
    console.log(`${deck.name}: decklist shown in ${ms} ms.`);
    expect(ms).toBeLessThan(1_000);
  }
});
