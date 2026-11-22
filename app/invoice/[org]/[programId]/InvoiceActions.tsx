"use client";

import { useState, useTransition } from "react";
import { payOpenInvoice } from "../../actions";

// The invoice's buttons (not printed): Print / Save as PDF, and Pay by card when something is due.
export function InvoiceActions({
  org,
  programId,
  canPay,
  due,
  payOnly = false,
}: {
  org: string;
  programId: string;
  canPay: boolean;
  due: string;
  payOnly?: boolean; // just Pay (the Home card), no Print
}) {
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {!payOnly && (
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-full px-4 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-950/15 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20 dark:hover:bg-white/5"
      >
        Print / Save as PDF
      </button>
      )}
      {canPay && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await payOpenInvoice(org, programId);
              if (!r.ok) return setErr(r.message);
              window.location.href = r.pay; // Stripe Checkout; back here once paid
            })
          }
          className="rounded-full bg-[#635bff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5146e5] disabled:opacity-50"
        >
          {busy ? "Opening payment…" : `Pay ${due} by card`}
        </button>
      )}
      {err && <p className="w-full text-sm text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}
