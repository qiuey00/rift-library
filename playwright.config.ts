import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Each run gets fresh, empty database folders, never Jeff's real data/. Test workers load
// this file too and inherit the variables, so they share the folders instead of making more.
process.env.E2E_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'log-e2e-'));
process.env.E2E_FLOWS_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'log-e2e-flows-'));

/** Never call Riftcodex during tests: no card data sync and no card lookups. */
const OFFLINE = { RIFTCODEX: 'off' };

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4300',
    trace: 'retain-on-failure',
  },
  projects: [
    // Screen tests mock the API, but some read the real server (an empty collection, the
    // inbox count), so the flow tests, which fill a collection, get a server of their own.
    { name: 'chromium', testIgnore: 'flows/**', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'flows',
      testMatch: 'flows/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4301' },
    },
  ],
  // Never test against an app that is already running: it would be Jeff's real one. Both
  // servers load the card fixtures first (see tests/e2e/global-setup.ts). The servers
  // start in order, so the screens are built before the flow server starts.
  webServer: [
    {
      command: 'npx tsx tests/e2e/global-setup.ts && npm start',
      env: { DATA_DIR: process.env.E2E_DATA_DIR, ...OFFLINE },
      url: 'http://127.0.0.1:4300/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npx tsx tests/e2e/global-setup.ts && npx tsx tests/e2e/flows/server.ts',
      env: { DATA_DIR: process.env.E2E_FLOWS_DATA_DIR, ...OFFLINE },
      url: 'http://127.0.0.1:4301/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
