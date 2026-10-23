import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ActionResult, ErrorBody } from '../../shared/api/common';
import type { SetProxyBody } from '../../shared/api/copies';
import { api } from '../api';
import { useUndoBar } from './UndoBar';

/** Marks stacks as proxies or real copies. Nothing moves, so there is no undo. */
export function useSetProxy() {
  const queryClient = useQueryClient();
  const undoBar = useUndoBar();
  return useMutation({
    mutationFn: async (body: SetProxyBody): Promise<ActionResult> => {
      const res = await api.stacks.proxy.$post({ json: body });
      if (!res.ok) {
        const error = ErrorBody.safeParse(await res.json().catch(() => null));
        throw new Error(
          error.success ? error.data.error.message : "Couldn't change the copies. Try again.",
        );
      }
      return res.json();
    },
    onSuccess: (result) => {
      undoBar.show({ message: result.message, batchId: result.batchId });
      // Proxy counts show on several screens.
      void queryClient.invalidateQueries();
    },
  });
}
