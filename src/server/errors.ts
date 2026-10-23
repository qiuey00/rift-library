import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorBody } from '../shared/api/common';

/**
 * An error the screens can show as it is. Throw it from a route or service, such as
 * `throw new AppError(409, 'copy_moved', 'This copy has moved, pick another')`, and the
 * server answers with that status and an `ErrorBody`.
 */
export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

/** Turns anything a route throws into an `ErrorBody` answer. */
export function handleError(err: Error, c: Context) {
  if (err instanceof AppError) {
    return c.json(errorBody(err.code, err.message), err.status);
  }
  if (err instanceof HTTPException && err.status < 500) {
    // Raised by Hono itself, such as for a request body that isn't valid JSON.
    return c.json(errorBody('bad_request', err.message), err.status);
  }
  console.error(err);
  return c.json(
    errorBody(
      'internal_error',
      'Something went wrong on the server. Try again, and restart the app if it keeps happening.',
    ),
    500,
  );
}
