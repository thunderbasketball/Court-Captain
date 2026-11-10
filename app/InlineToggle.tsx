"use client";

import { useState, type ReactNode } from "react";
import ChatPanel from "./ChatPanel";
import { NotifyPanel } from "./NotifyButton";
import type { AudienceInput } from "@/lib/announcements";

// A button that opens its content right below it, on the page (no pop-up); tap it again to close. Put it in a wrapping
// row (flex-wrap): the content takes a line of its own under the row.
export default function InlineToggle({
  label,
  ariaLabel,
  className,
  children,
}: {
  label: ReactNode;
  ariaLabel?: string;
  className: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${className} ${open ? "ring-2" : ""}`}
      >
        {label}
      </button>
      {open && <div className="order-last basis-full">{children}</div>}
    </>
  );
}

// A chat, opened right on the page.
export function ChatToggle({ chatKey, label, className, children }: { chatKey: string; label: string; className: string; children: ReactNode }) {
  return (
    <InlineToggle label={children} ariaLabel={label} className={className}>
      <ChatPanel chatKey={chatKey} />
    </InlineToggle>
  );
}

// An alert (announcement) to a group, opened right on the page.
export function NotifyToggle({ audience, to, className, children }: { audience: AudienceInput; to: string; className: string; children: ReactNode }) {
  return (
    <InlineToggle label={children} ariaLabel={`Notify ${to}`} className={className}>
      <NotifyPanel audience={audience} to={to} />
    </InlineToggle>
  );
}
