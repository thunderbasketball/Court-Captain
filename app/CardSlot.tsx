"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const noop = () => () => {};

// Puts its buttons on a Home card's title line (the card's `card-slot-<key>` spot), so they show while it's closed.
// Outside a Home card (no such spot), they show where they are.
export default function CardSlot({ slot, children }: { slot: string; children: ReactNode }) {
  const target = useSyncExternalStore(
    noop,
    () => document.getElementById(slot),
    () => null,
  );
  return target ? createPortal(children, target) : null;
}
