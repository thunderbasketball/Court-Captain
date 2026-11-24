"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "../client-ui";
import StripeInPage, { payInPage } from "../StripeInPage";
import { cancelRequestedInvoice, markRequestedInvoicePaid, payRequestedInvoice } from "./actions";

// A requested invoice's buttons: Pay by card, Mark paid (the League's Owners; asks first), Cancel invoice (asks first), and
// Print on its own page.
export default function RequestedActions({
  id,
  amount,
  canPay,
  canMarkPaid,
  canCancel,
  print = false,
}: {
  id: string;
  amount: string; // "$257.78", what a card is charged
  canPay: boolean;
  canMarkPaid: boolean;
  canCancel: boolean;
  print?: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [sure, setSure] = useState<"paid" | "cancel" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ clientSecret: string; account: string } | null>(null);
  const pill = "rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 disabled:opacity-50";
  if (paying)
    return (
      <div className="w-full print:hidden">
        <StripeInPage pay={paying} onCancel={() => setPaying(null)} amount={amount} />
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {print && (
        <button type="button" onClick={() => window.print()} className={`${pill} text-zinc-700 ring-zinc-950/15 dark:text-zinc-200 dark:ring-white/20`}>
          Print / Save as PDF
        </button>
      )}
      {canPay && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              setErr(null);
              const r = await payRequestedInvoice(id, payInPage);
              if (!r.ok) {
                setErr(r.message);
                return router.refresh();
              }
              if (r.payInPage) return setPaying(r.payInPage);
              if (r.pay) window.location.href = r.pay;
              else router.refresh();
            })
          }
          className="rounded-full bg-[#635bff] px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "One moment…" : `Pay ${amount} by card`}
        </button>
      )}
      {canMarkPaid && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (sure !== "paid") return setSure("paid");
            start(async () => {
              setErr(null);
              const r = await markRequestedInvoicePaid(id);
              if (!r.ok) setErr(r.message);
              else setMsg(`Paid. ${r.registered} team${r.registered === 1 ? "" : "s"} registered.`);
              setSure(null);
              router.refresh();
            });
          }}
          className={`${pill} text-emerald-700 ring-emerald-600/40 dark:text-emerald-400`}
        >
          {sure === "paid" ? "Yes, it's paid: register its teams" : "Mark paid"}
        </button>
      )}
      {canCancel && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (sure !== "cancel") return setSure("cancel");
            start(async () => {
              setErr(null);
              const r = await cancelRequestedInvoice(id);
              if (!r.ok) setErr(r.message);
              setSure(null);
              router.refresh();
            });
          }}
          className={`${pill} text-red-600 ring-red-600/30 dark:text-red-400`}
        >
          {sure === "cancel" ? "Yes, cancel it (back to the cart)" : "Cancel invoice"}
        </button>
      )}
      {err && <p className="w-full text-sm text-red-600 dark:text-red-400">{err}</p>}
      {msg && <Toast key={msg} message={msg} />}
    </div>
  );
}
