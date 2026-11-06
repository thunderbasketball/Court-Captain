"use client";

// Drag and drop for phones and tablets, where the browser's drag and drop doesn't work with a finger. Press and hold a
// card (a moment), then slide to a drop area and lift: a quick swipe still scrolls the page. Drop areas carry
// data-drop="<key>"; the card's data is handed to onDrop with the key under the finger.
import { useEffect, useRef, useState } from "react";

const HOLD_MS = 250;
const SLOP_PX = 10; // moving more than this before the hold ends is a scroll

type Options = {
  onStart: (data: string) => void;
  onOver: (key: string | null) => void;
  onDrop: (data: string, key: string | null) => void;
  onCancel: () => void;
};

export function useTouchDrag({ onStart, onOver, onDrop, onCancel }: Options) {
  const handlers = useRef({ onStart, onOver, onDrop, onCancel });
  useEffect(() => {
    handlers.current = { onStart, onOver, onDrop, onCancel };
  });
  const state = useRef<{ data: string; x: number; y: number; timer: number; active: boolean; key: string | null } | null>(null);
  const suppressClick = useRef(false);
  // The floating label: shown at the start and end of a drag; moved directly (no re-render) while the finger moves.
  const [ghost, setGhost] = useState<{ label: string; x: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const keyAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest("[data-drop]") as HTMLElement | null)?.dataset.drop ?? null;
    const move = (e: TouchEvent) => {
      const s = state.current;
      if (!s) return;
      const t = e.touches[0];
      if (!s.active) {
        if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > SLOP_PX) {
          clearTimeout(s.timer);
          state.current = null; // a scroll
        }
        return;
      }
      e.preventDefault(); // dragging: don't scroll
      if (ghostRef.current) {
        ghostRef.current.style.left = `${t.clientX}px`;
        ghostRef.current.style.top = `${t.clientY - 44}px`;
      }
      const key = keyAt(t.clientX, t.clientY);
      if (key !== s.key) handlers.current.onOver((s.key = key));
    };
    const end = (e: TouchEvent) => {
      const s = state.current;
      if (!s) return;
      clearTimeout(s.timer);
      state.current = null;
      if (!s.active) return;
      e.preventDefault();
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 400);
      setGhost(null);
      handlers.current.onOver(null);
      const t = e.changedTouches[0];
      handlers.current.onDrop(s.data, t ? keyAt(t.clientX, t.clientY) : s.key);
    };
    const cancel = () => {
      const s = state.current;
      if (!s) return;
      clearTimeout(s.timer);
      state.current = null;
      setGhost(null);
      if (s.active) handlers.current.onCancel();
    };
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end, { passive: false });
    document.addEventListener("touchcancel", cancel);
    return () => {
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", cancel);
    };
  }, []);

  // Spread on a card: its data (e.g. a game id) and the words shown under the finger while dragging.
  const source = (data: string, text: string) => ({
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const s = {
        data,
        x: t.clientX,
        y: t.clientY,
        active: false,
        key: null as string | null,
        timer: window.setTimeout(() => {
          s.active = true;
          navigator.vibrate?.(10);
          setGhost({ label: text, x: s.x, y: s.y });
          handlers.current.onStart(data);
        }, HOLD_MS),
      };
      state.current = s;
    },
    // Long-press menus and text selection would get in the way.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  // True right after a touch drop, so the click the browser sends next is ignored.
  const justDropped = () => suppressClick.current;

  // The floating label under the finger.
  const ghostEl = ghost && (
    <div
      ref={ghostRef}
      aria-hidden
      style={{ left: ghost.x, top: ghost.y - 44 }}
      className="pointer-events-none fixed z-50 max-w-[70vw] -translate-x-1/2 truncate rounded-lg bg-scenic-navy px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
    >
      {ghost.label}
    </div>
  );

  return { source, justDropped, ghost: ghostEl };
}
