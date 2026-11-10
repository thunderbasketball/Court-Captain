"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import ChatPanel from "./ChatPanel";
import { NotifyPanel } from "./NotifyButton";
import type { AudienceInput } from "@/lib/announcements";

// The Director's chat bubble and bell in the header: each opens right under the header (no pop-up): the chat with every
// Head Coach (with All chats →), or the alert to all team staff (with My announcements →). Tap the icon again, the ×,
// or anywhere outside it to close.
export default function HeaderPanels({
  chat,
  alert,
  className,
}: {
  chat?: { chatKey: string; icon: ReactNode };
  alert?: { audience: AudienceInput; to: string; icon: ReactNode };
  className: string;
}) {
  const [open, setOpen] = useState<"chat" | "alert" | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const toggle = (k: "chat" | "alert") => setOpen(open === k ? null : k);
  return (
    <span ref={box} className="contents">
      {chat && (
        <button
          type="button"
          aria-label="Chat with all Head Coaches"
          title="Chat with all Head Coaches"
          aria-expanded={open === "chat"}
          onClick={() => toggle("chat")}
          className={`${className} ${open === "chat" ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
        >
          {chat.icon}
        </button>
      )}
      {alert && (
        <button
          type="button"
          aria-label={`Notify ${alert.to}`}
          title={`Notify ${alert.to}`}
          aria-expanded={open === "alert"}
          onClick={() => toggle("alert")}
          className={`${className} ${open === "alert" ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
        >
          {alert.icon}
        </button>
      )}
      {open && (
        // Under the header (it's the nearest positioned box), over the page, the page's width.
        <div className="absolute inset-x-0 top-full z-20 px-4 pt-2">
          <div className="mx-auto max-w-3xl rounded-2xl bg-white p-3 shadow-lg ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{open === "chat" && "Head Coaches chat"}</span>
              <span className="flex items-center gap-3">
                {open === "chat" && (
                  <Link href="/chat" className="text-sm font-medium text-thunder-blue dark:text-blue-400">
                    All chats →
                  </Link>
                )}
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setOpen(null)}
                  className="rounded-full px-2 text-lg leading-none text-zinc-400 hover:text-zinc-700"
                >
                  ×
                </button>
              </span>
            </div>
            <div className="max-h-[70dvh] overflow-y-auto">
              {open === "chat" && chat && <ChatPanel chatKey={chat.chatKey} />}
              {open === "alert" && alert && <NotifyPanel audience={alert.audience} to={alert.to} inbox />}
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
