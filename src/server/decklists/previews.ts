import { randomBytes } from 'node:crypto';
import { AppError } from '../errors';

// A deck list preview waits here in memory until the deck is made from it: it is dropped after
// an hour, once the deck is made, or when the server restarts, as in Library of Gathering.

export const PREVIEW_LIFETIME_MS = 60 * 60 * 1000;

export class PreviewStore<T> {
  private readonly previews = new Map<string, { value: T; expiresAt: number }>();

  /** Keeps a preview and returns its id, such as "dlp_7f3a9c0b1d2e4f56". */
  put(value: T): string {
    this.dropExpired();
    const id = `dlp_${randomBytes(8).toString('hex')}`;
    this.previews.set(id, { value, expiresAt: Date.now() + PREVIEW_LIFETIME_MS });
    return id;
  }

  /** The preview, or 404 `preview_not_found` when it is gone or too old. */
  get(id: string): T {
    this.dropExpired();
    const preview = this.previews.get(id);
    if (!preview) {
      throw new AppError(
        404,
        'preview_not_found',
        'This deck list preview has expired. Paste the list again to see a fresh one.',
      );
    }
    return preview.value;
  }

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
