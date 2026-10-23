import { startServer } from '../../../src/server/server';

// The flow tests' own app, on port 4301 with the database in DATA_DIR, so the collection
// they build never shows in the screen tests on port 4300. The screens are the ones
// `npm start` built for the first server.

/** The port playwright.config.ts gives the flows project. */
const FLOWS_PORT = 4301;

startServer({ port: FLOWS_PORT });
