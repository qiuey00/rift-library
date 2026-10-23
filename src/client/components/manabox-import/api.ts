import { ErrorBody, type Id } from '../../../shared/api/common';
import type {
  ManaBoxApplyRequest,
  ManaBoxApplyResult,
  ManaBoxPreview,
} from '../../../shared/api/manabox';
import type {
  ManaBoxUpdateApplyRequest,
  ManaBoxUpdateApplyResult,
  UpdatePreview,
} from '../../../shared/api/manabox-update';
import { api } from '../../api';
import { ImportError } from './draft';

/** The body of an API answer, or an `ImportError` carrying the server's code and message. */
async function answer<T>(response: { ok: boolean; json(): Promise<unknown> }): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = ErrorBody.safeParse(body);
    throw error.success
      ? new ImportError(error.data.error.code, error.data.error.message)
      : new ImportError('internal_error', 'Something went wrong. Try again.');
  }
  return body as T;
}

/** Reads the CSV on the server for an Add copies import. Nothing changes until the apply. */
export async function previewAddCopies(file: File): Promise<ManaBoxPreview> {
  return answer(await api.imports.manabox.preview.$post({ form: { file } }));
}

export async function applyAddCopies(request: ManaBoxApplyRequest): Promise<ManaBoxApplyResult> {
  return answer(await api.imports.manabox.apply.$post({ json: request }));
}

/** Reads the CSV on the server against one location for an Update a location import. */
export async function previewUpdate(file: File, locationId: Id): Promise<UpdatePreview> {
  return answer(
    await api.imports.manabox['update-preview'].$post({
      form: { file, locationId: String(locationId) },
    }),
  );
}

export async function applyUpdate(
  request: ManaBoxUpdateApplyRequest,
): Promise<ManaBoxUpdateApplyResult> {
  return answer(await api.imports.manabox['update-apply'].$post({ json: request }));
}
