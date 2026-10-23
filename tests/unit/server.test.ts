import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { app } from '../../src/server/app';
import { AppError, handleError } from '../../src/server/errors';
import { createSite, startServer } from '../../src/server/server';
import { validate } from '../../src/server/validate';
import { ErrorBody } from '../../src/shared/api/common';

describe('API', () => {
  it('answers the health check', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('answers unknown API addresses with a 404 error body', async () => {
    const res = await app.request('/api/nothing-here');
    expect(res.status).toBe(404);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('not_found');
  });
});

describe('errors', () => {
  const routes = new Hono()
    .get('/moved', () => {
      throw new AppError(409, 'copy_moved', 'This copy has moved, pick another');
    })
    .get('/count', validate('query', z.object({ n: z.coerce.number().int() })), (c) =>
      c.json({ n: c.req.valid('query').n }),
    )
    .get('/broken', () => {
      throw new Error('boom');
    });
  routes.onError(handleError);

  it('turns an AppError into its status and error body', async () => {
    const res = await routes.request('/moved');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: 'copy_moved', message: 'This copy has moved, pick another' },
    });
  });

  it('checks requests with Zod and answers a bad one with 400 invalid_request', async () => {
    expect(await (await routes.request('/count?n=3')).json()).toEqual({ n: 3 });

    const res = await routes.request('/count?n=three');
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('invalid_request');
  });

  it('hides unexpected errors behind a plain 500 message', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await routes.request('/broken');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
    expect(res.status).toBe(500);
    expect(ErrorBody.parse(await res.json()).error.code).toBe('internal_error');
  });
});

describe('server', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('listens on 127.0.0.1 only', async () => {
    const server = startServer({ port: 0 });
    close = () => new Promise((resolve) => server.close(() => resolve()));
    await once(server, 'listening');

    const address = server.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');
    expect(address.family).toBe('IPv4');

    const res = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('serves the built screens, with the page for every screen address', async () => {
    const clientDir = await mkdtemp(path.join(tmpdir(), 'log-client-'));
    close = () => rm(clientDir, { recursive: true, force: true });
    await writeFile(path.join(clientDir, 'index.html'), '<title>Rift Library</title>');
    await writeFile(path.join(clientDir, 'app.js'), 'console.log(1);');
    const site = createSite(clientDir);

    expect(await (await site.request('/')).text()).toContain('Rift Library');
    expect(await (await site.request('/decks/12/assemble')).text()).toContain('Rift Library');
    expect(await (await site.request('/app.js')).text()).toBe('console.log(1);');
    expect(await (await site.request('/api/health')).json()).toEqual({ ok: true });
    expect((await site.request('/api/nothing-here')).status).toBe(404);
  });
});
