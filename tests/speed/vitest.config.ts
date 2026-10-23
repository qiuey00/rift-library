import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// `npm run test:speed`: the timing tests against the big made-up collection. They are kept
// out of `npm test` because building the collection takes a few seconds.
export default defineConfig({
  test: {
    root: path.join(import.meta.dirname, '..', '..'),
    include: ['tests/speed/**/*.test.ts'],
    env: { DATA_DIR: mkdtempSync(path.join(tmpdir(), 'log-speed-')) },
    hookTimeout: 120_000,
    testTimeout: 60_000,
    // Prints each test and the table of measured times.
    reporters: ['verbose'],
  },
});
