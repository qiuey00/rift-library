import { expect, type Page, test } from '@playwright/test';
import { deckViewSample, jinxBurn } from '../../src/shared/api/samples/decks';
import { putAwaySample } from '../../src/shared/api/samples/put-away';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

/** A new install: no decks and no locations, so the home screen loads no card images. */
const newInstall = async (page: Page) => {
  await page.route('**/api/decks', (route) => route.fulfill({ json: { decks: [] } }));
  await page.route('**/api/locations/tree', (route) => route.fulfill({ json: { nodes: [] } }));
};

test('opens on Decks, in the app frame', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Rift Library');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Decks');
  await expect(nav(page).getByRole('link', { name: 'Decks' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('every screen address opens', async ({ page }) => {
  // The deck view shows its deck's name, so it gets a deck to show.
  await page.route('**/api/decks/3', (route) =>
    route.fulfill({
      json: { ...deckViewSample, deck: { ...jinxBurn, id: 3, name: 'Viktor Tempo' } },
    }),
  );
  // The take-apart screen shows the put-away list's deck name.
  await page.route('**/api/decks/3/put-away', (route) => route.fulfill({ json: putAwaySample }));
  const screens: [string, string][] = [
    ['/', 'Decks'],
    ['/collection', 'Collection'],
    ['/locations', 'Locations'],
    ['/buy-list', 'Buy list'],
    ['/history', 'History'],
    ['/settings', 'Settings'],
    ['/cards/13', 'Ember Signet'],
    ['/decks/new', 'New deck'],
    ['/decks/3', 'Viktor Tempo'],
    ['/decks/3/assemble', 'Pick list'],
    ['/decks/3/take-apart', 'Take apart Jinx Burn'],
    ['/decks/3/swap', 'Swap list'],
  ];
  for (const [path, title] of screens) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }), path).toHaveText(title);
    await expect(nav(page), path).toBeVisible();
  }

  await page.goto('/no-such-screen');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nothing here');
});

test('the top bar links go to the five screens, in order', async ({ page }) => {
  await page.goto('/history');
  await expect(nav(page).getByRole('link')).toHaveText([
    'Decks',
    'Collection',
    'Locations',
    'Buy list',
    'History',
  ]);

  const targets: [string, string][] = [
    ['Collection', '/collection'],
    ['Locations', '/locations'],
    ['Buy list', '/buy-list'],
    ['History', '/history'],
    ['Decks', '/'],
  ];
  for (const [name, path] of targets) {
    const link = nav(page).getByRole('link', { name });
    await link.click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
  }
});

test('deck pages count as Decks in the top bar', async ({ page }) => {
  await page.goto('/decks/3/assemble');
  await expect(nav(page).getByRole('link', { name: 'Decks' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('the gear opens Settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/settings');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
});

test('a new install starts with Create a location', async ({ page }) => {
  await newInstall(page);
  await page.goto('/');
  const main = page.getByRole('main');
  await main.getByRole('link', { name: 'Create a location' }).click();
  await expect(page).toHaveURL('/locations');
});

test('fonts load with no network', async ({ page }) => {
  const offsite: string[] = [];
  await page.route(
    (url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost',
    (route) => {
      offsite.push(route.request().url());
      return route.abort();
    },
  );
  await newInstall(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Decks');
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((face) => face.status === 'loaded')
      .map((face) => face.family.replaceAll('"', ''));
  });

  expect(loaded).toContain('Instrument Sans');
  expect(loaded).toContain('Instrument Serif');
  expect(offsite).toEqual([]);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS(
    'font-family',
    /^"Instrument Serif"/,
  );
});

test('the top bar is one line at 1280 px and wraps at 1024 px with no sideways scroll', async ({
  page,
}) => {
  const layout = () =>
    page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`No ${selector}`);
        return element.getBoundingClientRect();
      };
      const nav = box('nav[aria-label="Main"]');
      const search = box('input[type="search"]');
      return {
        sameLine: search.top < nav.bottom,
        sideways: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(nav(page)).toBeVisible();
  expect(await layout()).toEqual({ sameLine: true, sideways: false });

  await page.setViewportSize({ width: 1024, height: 768 });
  expect(await layout()).toEqual({ sameLine: false, sideways: false });
  await expect(page.getByRole('link', { name: 'Settings' })).toBeInViewport();
});
