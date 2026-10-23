import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod';
import { AppError } from './errors';

/**
 * Checks one part of a request (`json`, `query`, `param`, ...) with a Zod schema, as
 * `@hono/zod-validator` does, but answers a failure with 400 `invalid_request` in the
 * shared error shape. Use it on every route that takes a body, query or path params:
 *
 *   .get('/decks/:id', validate('param', z.object({ id: IdParam })), (c) => ...)
 */
export const validate = <Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      const where = issue && issue.path.length > 0 ? ` (${issue.path.join('.')})` : '';
      throw new AppError(
        400,
        'invalid_request',
        `The request had a value the server can't use${where}: ${issue?.message ?? 'not valid'}.`,
      );
    }
  });
