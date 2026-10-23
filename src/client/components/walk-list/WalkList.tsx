import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WalkCurrent, WalkGroupData, WalkLineData } from './types';
import { WalkGroup } from './WalkGroup';
import { WalkLine } from './WalkLine';

/** Keys typed here belong to the field, a button or an open dialog, not to the walk. */
function ownsKeys(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return true;
  if (target instanceof HTMLInputElement) return target.type !== 'checkbox';
  return ['TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName);
}

/**
 * The shared body of the pick, put-away and swap lists: groups of lines in walking order.
 * It keeps the current line (the first unticked one, or the one Jeff moved to) and handles
 * the keyboard anywhere on the page: ↑ / ↓ move between lines, Space ticks or unticks the
 * current line. Ticking moves on to the next unticked line. It fetches nothing: ticks go to
 * `onToggle`, and the screen passes the new `done` back in.
 */
export function WalkList({
  groups,
  onToggle,
  onCurrentChange,
  renderActions,
  keyboard = true,
}: {
  groups: WalkGroupData[];
  onToggle: (line: WalkLineData, group: WalkGroupData) => void;
  /** Called whenever the current line changes, such as to fill the Now picking pane. */
  onCurrentChange?: (current: WalkCurrent | null) => void;
  /** The actions at the right of a line, such as Switch copy or a ⋯ menu. */
  renderActions?: (line: WalkLineData, group: WalkGroupData) => ReactNode;
  /** Off when another walk list on the page takes the keys. */
  keyboard?: boolean;
}) {
  const order = useMemo(
    () => groups.flatMap((group) => group.lines.map((line) => ({ line, group }))),
    [groups],
  );
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const current: WalkCurrent | null =
    order.find((entry) => entry.line.key === movedTo) ??
    order.find((entry) => !entry.line.done) ??
    null;
  const currentKey = current?.line.key ?? null;

  const toggle = useCallback(
    (line: WalkLineData) => {
      const index = order.findIndex((entry) => entry.line.key === line.key);
      if (index === -1) return;
      onToggle(line, order[index].group);
      if (line.done) {
        setMovedTo(line.key);
        return;
      }
      // Ticked: walk on to the next unticked line, or stay when it was the last.
      const next =
        order.slice(index + 1).find((entry) => !entry.line.done) ??
        order.find((entry) => !entry.line.done && entry.line.key !== line.key);
      setMovedTo(next?.line.key ?? line.key);
    },
    [order, onToggle],
  );

  const focusLine = useCallback((key: string) => {
    const row = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-walk-line]') ?? [],
    ).find((element) => element.dataset.walkLine === key);
    row?.scrollIntoView?.({ block: 'nearest' });
    // Keep keyboard focus on the current line, so a native Space ticks the same line.
    if (listRef.current?.contains(document.activeElement)) {
      row?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
    }
  }, []);

  useEffect(() => {
    if (!keyboard) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (ownsKeys(event.target)) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (order.length === 0) return;
        event.preventDefault();
        const index = order.findIndex((entry) => entry.line.key === currentKey);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = Math.min(order.length - 1, Math.max(0, index + step));
        const key = order[next].line.key;
        setMovedTo(key);
        focusLine(key);
      } else if (event.key === ' ') {
        // A focused checkbox ticks itself, and it is always the current line.
        if (event.target instanceof HTMLInputElement) return;
        if (!current) return;
        event.preventDefault();
        toggle(current.line);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [keyboard, order, current, currentKey, toggle, focusLine]);

  // Report only real changes: screens often rebuild their groups on every render.
  const reported = useRef<string | undefined>(undefined);
  useEffect(() => {
    const signature = JSON.stringify(current ? [current.line, current.group.location] : null);
    if (reported.current === signature) return;
    reported.current = signature;
    onCurrentChange?.(current);
  }, [current, onCurrentChange]);

  return (
    <div ref={listRef} data-slot="walk-list" className="flex min-w-0 flex-col gap-4">
      {groups.map((group) => (
        <WalkGroup
          key={group.key}
          location={group.location}
          title={group.title}
          countText={group.countText}
          tone={group.tone}
          headerAction={group.headerAction}
        >
          {group.lines.map((line) => (
            <WalkLine
              key={line.key}
              line={line}
              current={line.key === currentKey}
              onToggle={toggle}
              onSelect={(selected) => setMovedTo(selected.key)}
              actions={renderActions?.(line, group)}
            />
          ))}
        </WalkGroup>
      ))}
    </div>
  );
}
