import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// `npm run test:speed:e2e`: the screens against a server holding the big made-up collection.
// `npm run seed:big` builds it into a fresh temp folder first, never Jeff's real data/.
process.env.SPEED_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'log-speed-e2e-'));

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4300',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run seed:big && npm start',
    env: { DATA_DIR: process.env.SPEED_DATA_DIR },
    url: 'http://127.0.0.1:4300/api/health',
    // Never test against an app that is already running: it would be Jeff's real one.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
