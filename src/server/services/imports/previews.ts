import { randomUUID } from 'node:crypto';
import { AppError } from '../../errors';

// Imports read a file in a preview and change things only in a later apply. The parsed file
// waits here in memory between the two: it is dropped after an hour, on restart, or once
// applied.

export const PREVIEW_LIFETIME_MS = 60 * 60 * 1000;

/** The apply named a preview the server no longer holds. */
export class PreviewExpiredError extends AppError {
  constructor() {
    super(
      410,
      'preview_expired',
      'This preview has expired. Choose the file again to see a fresh one.',
    );
    this.name = 'PreviewExpiredError';
  }
}

export class PreviewStore<T> {
  private readonly previews = new Map<string, { value: T; expiresAt: number }>();

  /** Keeps a preview and returns its id. */
  put(value: T): string {
    this.dropExpired();
    const id = randomUUID();
    this.previews.set(id, { value, expiresAt: Date.now() + PREVIEW_LIFETIME_MS });
    return id;
  }

  /** The preview, or `PreviewExpiredError` when it is gone or too old. */
  get(id: string): T {
    this.dropExpired();
    const preview = this.previews.get(id);
    if (!preview) throw new PreviewExpiredError();
    return preview.value;
  }

  /** Drops a preview once it is applied. */
  delete(id: string) {
    this.previews.delete(id);
  }

  private dropExpired() {
    const now = Date.now();
    for (const [id, preview] of this.previews) {
      if (preview.expiresAt <= now) this.previews.delete(id);
    }
  }
}
