import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Undo2, X } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActionResult, ErrorBody, type Id } from '../../shared/api/common';

/** How long the bar stays up after it changes, unless the pointer is over it. */
export const UNDO_BAR_MS = 8000;

export type UndoBarInput = {
  /** What moved, such as "Moved 3 cards to Long box" (an `ActionResult` message). */
  message: string;
  /** The movement batch Undo reverses; null shows the message with no Undo button. */
  batchId: Id | null;
  /** Shows the message as a failure, with no Undo button. */
  failed?: boolean;
};

type Bar = UndoBarInput & {
  key: number;
  phase: 'ready' | 'undoing' | 'undone' | 'failed';
};

const UndoBarContext = createContext<{ show: (input: UndoBarInput) => void } | null>(null);

/**
 * Shows the undo bar after an action that moved copies:
 *
 *   const undoBar = useUndoBar();
 *   undoBar.show({ message: result.message, batchId: result.batchId });
 */
export function useUndoBar() {
  const context = useContext(UndoBarContext);
  if (!context) {
    throw new Error('useUndoBar needs an UndoBarProvider around it; the app frame has one.');
  }
  return context;
}

/**
 * Undoes a movement batch, answering with the message to show. The undo route isn't in the
 * typed client yet (its area adds it), so this calls it directly.
 */
export async function undoBatch(batchId: Id): Promise<{ ok: boolean; message: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/batches/${batchId}/undo`, { method: 'POST' });
  } catch {
    return {
      ok: false,
      message: "Couldn't reach the server to undo. Is the app still running?",
    };
  }
  const body: unknown = await res.json().catch(() => null);
  const result = ActionResult.safeParse(body);
  if (res.ok && result.success) {
    return { ok: true, message: result.data.message };
  }
  const error = ErrorBody.safeParse(body);
  return {
    ok: false,
    message: error.success
      ? error.data.error.message
      : 'Something went wrong while undoing. Check History to see what moved.',
  };
}

/** Holds the undo bar at the bottom of the window and gives `useUndoBar()` to everything inside. */
export function UndoBarProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [bar, setBar] = useState<Bar | null>(null);
  const [hovered, setHovered] = useState(false);
  const nextKey = useRef(0);

  const show = useCallback((input: UndoBarInput) => {
    nextKey.current += 1;
    setHovered(false);
    setBar({ ...input, key: nextKey.current, phase: input.failed ? 'failed' : 'ready' });
  }, []);
  const context = useMemo(() => ({ show }), [show]);

  // Close a while after the bar last changed. Waiting on the server or a pointer over the
  // bar holds it open; each change (a new show, the undo's answer) starts the wait again.
  useEffect(() => {
    if (!bar || bar.phase === 'undoing' || hovered) {
      return;
    }
    const timer = setTimeout(() => setBar(null), UNDO_BAR_MS);
    return () => clearTimeout(timer);
  }, [bar, hovered]);

  const undo = async () => {
    if (!bar || bar.batchId === null || bar.phase !== 'ready') {
      return;
    }
    const { key, batchId } = bar;
    setBar({ ...bar, phase: 'undoing' });
    const result = await undoBatch(batchId);
    if (result.ok) {
      // Copies moved back, so every screen's data may be out of date.
      void queryClient.invalidateQueries();
    }
    // A newer show wins over this answer.
    setBar((current) =>
      current?.key === key
        ? { ...current, phase: result.ok ? 'undone' : 'failed', message: result.message }
        : current,
    );
  };

  return (
    <UndoBarContext.Provider value={context}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-6"
      >
        {bar && (
          // The pointer handlers only hold the bar open while it is pointed at; the buttons
          // inside are the interactive parts.
          // biome-ignore lint/a11y/noStaticElementInteractions: hover pause, not an interaction
          <div
            data-slot="undo-bar"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="pointer-events-auto flex max-w-full items-center gap-4 rounded-[10px] bg-foreground py-2.5 pr-3 pl-4.5 text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
          >
            {bar.phase === 'failed' ? (
              <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-[#ff9a92]" />
            ) : (
              <Check
                aria-hidden="true"
                className="size-4 shrink-0 text-[#7fd6a0]"
                strokeWidth={2.4}
              />
            )}
            <span>{bar.message}</span>
            {bar.batchId !== null && (bar.phase === 'ready' || bar.phase === 'undoing') && (
              <button
                type="button"
                onClick={undo}
                disabled={bar.phase === 'undoing'}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border border-[#4a5161] px-3 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-70"
              >
                <Undo2 aria-hidden="true" className="size-3.5" />
                {bar.phase === 'undoing' ? 'Undoing…' : 'Undo'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setBar(null)}
              aria-label="Close"
              className="flex size-8 shrink-0 items-center justify-center rounded-[7px] text-[#c3c8d2] hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        )}
      </div>
    </UndoBarContext.Provider>
  );
}
