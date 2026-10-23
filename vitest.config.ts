import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.join(import.meta.dirname, 'src', 'client') },
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    // Unit tests never touch Jeff's real database in data/.
    env: { DATA_DIR: mkdtempSync(path.join(tmpdir(), 'log-unit-')) },
  },
});
