import { hc } from 'hono/client';
import type { AppType } from '../server/app';

/**
 * The typed client for the server's API, made from the routes themselves, so a changed
 * route breaks the build instead of a screen. `api.health.$get()` calls GET /api/health.
 */
export const api = hc<AppType>('/').api;
