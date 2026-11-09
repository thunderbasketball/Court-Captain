"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import type { AudienceInput } from "@/lib/announcements";
import { Alert, CloseButton, Toast, dialogCls, useConfirm } from "./client-ui";
import { previewAudience, sendAnnouncement } from "./inbox/actions";
import { fieldLabel as label, inputCls, primaryBtn } from "./ui";

type Preview = { names: string[]; emailOnly: number } | null;

const reach = (p: NonNullable<Preview>) => {
  const parts = [`${p.names.length} ${p.names.length === 1 ? "person" : "people"}`];
  if (p.emailOnly) parts.push(`${p.emailOnly} by email (no app login)`);
  return parts.join(" + ");
};

// The announcement form for one group: who it reaches (loaded when shown), Title, Message, Send (confirmed first).
// In the bell's pop-up, or right on a team card (Teams page). `onSent` gets the "Sent to …" line; `onClose` shows ×.
export function NotifyForm({
  audience,
  to,
  inbox = false,
  onSent,
  onClose,
}: {
  audience: AudienceInput;
  to: string;
  inbox?: boolean;
  onSent: (message: string) => void;
  onClose?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<Preview>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  const nobody = preview !== null && !preview.names.length && !preview.emailOnly;
  const audienceKey = JSON.stringify(audience);
  useEffect(() => {
    let live = true;
    previewAudience(JSON.parse(audienceKey) as AudienceInput).then((r) => {
      if (!live) return;
      if (r.ok) setPreview({ names: r.names, emailOnly: r.emailOnly });
      else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [audienceKey]);

  return (
    <>
      {confirmDialog}
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!preview) return;
          const ok = await confirm({
            title: `Send to ${reach(preview)}?`,
            message: (
              <p>
                &ldquo;{title.trim()}&rdquo; goes out now. It can be removed later from Announcements → Sent, but emails can&apos;t be
                taken back.
              </p>
            ),
            confirmLabel: "Send",
            tone: "warning",
          });
          if (!ok) return;
          start(async () => {
            setError(null);
            const r = await sendAnnouncement({ ...audience, title, body });
            if (!r.ok) return setError(r.message);
            setTitle("");
            setBody("");
            onSent(`Sent to ${r.count} ${r.count === 1 ? "person" : "people"}${r.emailed ? ` and emailed ${r.emailed}` : ""}.`);
          });
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className={onClose ? "text-lg font-semibold" : "font-semibold"}>Notify {to}</h2>
            <p className="text-sm text-zinc-500">{preview ? `Goes to ${reach(preview)}` : "Finding who this reaches…"}</p>
          </div>
          {onClose && <CloseButton onClick={onClose} />}
        </div>
        {inbox && (
          <Link href="/inbox" prefetch={false} onClick={onClose} className="block text-sm font-medium text-thunder-blue dark:text-blue-400">
            My announcements →
          </Link>
        )}
        {preview && preview.names.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-500">Who</summary>
            <p className="mt-1 text-zinc-600 dark:text-zinc-300">{preview.names.join(", ")}</p>
          </details>
        )}
        {nobody && <Alert tone="red">Nobody to notify here yet.</Alert>}
        <label className="block">
          <span className={label}>Title</span>
          <input className={inputCls} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>Message</span>
          <textarea className={`${inputCls} min-h-32`} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
        </label>
        {error && <Alert tone="red">{error}</Alert>}
        <button type="submit" disabled={busy || !preview || nobody || !title.trim() || !body.trim()} className={primaryBtn}>
          {busy ? "Sending…" : "Send"}
        </button>
      </form>
    </>
  );
}

// The form right on a team card (Teams page): after sending, says so and the form is ready again.
export function NotifyPanel({ audience, to }: { audience: AudienceInput; to: string }) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
      {done && (
        <div className="mb-3">
          <Alert tone="green">{done}</Alert>
        </div>
      )}
      <NotifyForm audience={audience} to={to} onSent={setDone} />
    </div>
  );
}

// Director: a bell that sends an announcement to one group (a team, a practice day, a role, everyone…).
// `className` and `children` replace the round bell's look; `inbox` adds a link to the person's announcements.
export default function NotifyButton({
  audience,
  to,
  size = "sm",
  className,
  children,
  inbox = false,
}: {
  audience: AudienceInput;
  to: string;
  size?: "sm" | "md";
  className?: string;
  children?: ReactNode;
  inbox?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(0); // a new form (and who it reaches) each time it opens
  const close = () => dialog.current?.close();
  const [done, setDone] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        aria-label={`Notify ${to}`}
        title={`Notify ${to}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((n) => n + 1);
          dialog.current?.showModal();
        }}
        className={
          className ??
          `inline-flex shrink-0 items-center justify-center rounded-full text-thunder-orange ring-1 ring-thunder-orange/40 hover:bg-orange-50 dark:hover:bg-orange-500/10 ${
            size === "md" ? "size-9" : "size-7"
          }`
        }
      >
        {children ?? <BellIcon className={size === "md" ? "size-5" : "size-4"} />}
      </button>
      {done && <Toast key={done} message={done} />}
      <dialog
        ref={dialog}
        className={dialogCls}
        onClose={() => setOpen(0)}
        onClick={(e) => e.target === dialog.current && close()}
      >
        <div className="p-5">
          {open > 0 && (
            <NotifyForm
              key={open}
              audience={audience}
              to={to}
              inbox={inbox}
              onClose={close}
              onSent={(m) => {
                close();
                setDone(m);
              }}
            />
          )}
        </div>
      </dialog>
    </>
  );
}

export function BellIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}
