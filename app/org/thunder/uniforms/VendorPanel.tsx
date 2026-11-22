"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CardPanel, PanelIcon, iconBtn } from "../../../CardIcons";
import { GearIcon } from "../../../OrgSettings";
import { fieldLabel, inputCls } from "../../../ui";
import { cancelUniformOrder, emailUniformVendor, previewUniformOrder, saveUniformVendor } from "./actions";

export const VENDOR_PANEL = "uniform-vendor";

// The Uniforms card's ⚙ (top right): the vendor's email and who's copied, opened right in the card.
export function VendorGear() {
  return (
    <PanelIcon id={VENDOR_PANEL} label="Uniform vendor settings" className={iconBtn}>
      <GearIcon className="size-5" />
    </PanelIcon>
  );
}

export function VendorSettings({ email, cc, setBy }: { email: string | null; cc: string[]; setBy: string | null }) {
  const router = useRouter();
  const [vendor, setVendor] = useState(email ?? "");
  const [copies, setCopies] = useState(cc.join("\n"));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <CardPanel id={VENDOR_PANEL} className="mb-4 space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
      <p className="text-sm font-semibold">Uniform vendor</p>
      <label className="block">
        <span className={fieldLabel}>Vendor email</span>
        <input type="email" value={vendor} onChange={(e) => setVendor(e.target.value)} className={inputCls} placeholder="orders@vendor.com" />
      </label>
      <label className="block">
        <span className={fieldLabel}>Cc (one email per line, up to 10)</span>
        <textarea rows={3} value={copies} onChange={(e) => setCopies(e.target.value)} className={inputCls} />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await saveUniformVendor(vendor, copies);
              setMsg(r.ok ? { ok: true, text: "Saved ✓" } : { ok: false, text: r.message });
              if (r.ok) router.refresh();
            })
          }
          className="rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</span>}
      </div>
      {setBy && <p className="text-xs text-zinc-500">Last set by {setBy}</p>}
    </CardPanel>
  );
}

type Draft = {
  to: string;
  cc: string[];
  senderCopied: boolean;
  orderNo: string;
  subject: string;
  text: string;
  filename: string;
  players: number;
};

// Email the vendor (the new players): first a preview of the email right here (To, Cc with the
// sender copied, subject, the list and the attached spreadsheet), then Send or Cancel.
export function SendToVendor({ ready, hasVendor }: { ready: number; hasVendor: boolean }) {
  const router = useRouter();
  const [preview, setPreview] = useState<{ everyone: boolean; draft: Draft } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const open = (everyone: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await previewUniformOrder(everyone);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setPreview({ everyone, draft: r.draft });
    });
  const send = () =>
    start(async () => {
      if (!preview) return;
      const r = await emailUniformVendor(preview.everyone);
      setPreview(null);
      setMsg(r.ok ? { ok: true, text: `Order #${r.orderNo} sent: ${r.players} player${r.players === 1 ? "" : "s"} ✓` } : { ok: false, text: r.message });
      if (r.ok) router.refresh();
    });
  if (!hasVendor) return <p className="text-sm text-zinc-500">Set the vendor&apos;s email in the gear (top right) to email the order.</p>;
  return (
    <div className="space-y-2">
      {preview ? (
        <div className="space-y-2 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
          <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Preview</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-zinc-500">To</dt>
            <dd className="min-w-0 break-words">{preview.draft.to}</dd>
            <dt className="text-zinc-500">Cc</dt>
            <dd className="min-w-0 break-words">
              {preview.draft.cc.length ? preview.draft.cc.join(", ") : "No one"}
              {!preview.draft.senderCopied && <span className="block text-xs text-amber-700 dark:text-amber-400">You have no email on file, so you won&apos;t get a copy.</span>}
            </dd>
            <dt className="text-zinc-500">Subject</dt>
            <dd className="min-w-0 break-words font-medium">{preview.draft.subject}</dd>
            <dt className="text-zinc-500">Attached</dt>
            <dd className="min-w-0 break-words">📎 {preview.draft.filename}</dd>
          </dl>
          <pre className="max-h-80 overflow-auto rounded-lg bg-white p-3 font-sans text-sm whitespace-pre-wrap ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
            {preview.draft.text}
          </pre>
          <div className="flex items-center gap-3">
            <button type="button" disabled={busy} onClick={send} className="rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Sending…" : `Send order #${preview.draft.orderNo}`}
            </button>
            <button type="button" disabled={busy} onClick={() => setPreview(null)} className="text-sm font-medium text-zinc-500">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() => open(false)}
            className="rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Loading…" : `Email the vendor${ready ? ` (${ready} new)` : ""}`}
          </button>
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}

// Cancel order (the newest one): asks right here, with "Email the vendor that it's cancelled" ticked.
export function CancelOrder({ orderNo, to }: { orderNo: string; to: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [notify, setNotify] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!asking)
    return (
      <button type="button" onClick={() => setAsking(true)} className="text-sm font-medium text-red-600 dark:text-red-400">
        Cancel this order
      </button>
    );
  return (
    <div className="space-y-2 rounded-xl bg-red-50 p-3 text-sm ring-1 ring-red-200 dark:bg-red-500/10 dark:ring-red-500/30">
      <p className="font-semibold">Cancel order #{orderNo}?</p>
      <p className="text-zinc-600 dark:text-zinc-300">
        Its players go back to Not sent yet, so you can fix them and send a corrected order (with a new number). The order stays
        listed as Cancelled.
      </p>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 size-4" />
        <span>
          Email the vendor ({to}) that it&apos;s cancelled, with the same Cc and you copied
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await cancelUniformOrder(orderNo, notify);
              if (!r.ok) return setMsg(r.message);
              setAsking(false);
              router.refresh();
            })
          }
          className="rounded-full bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Cancelling…" : "Cancel order"}
        </button>
        <button type="button" disabled={busy} onClick={() => setAsking(false)} className="font-medium text-zinc-500">
          Keep it
        </button>
      </div>
      {msg && <p className="text-red-600 dark:text-red-400">{msg}</p>}
    </div>
  );
}
