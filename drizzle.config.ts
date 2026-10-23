import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` compares src/server/db/schema.ts with the last migration and writes
// the difference as a new SQL migration, which the server applies when it starts.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './src/server/db/migrations',
});
