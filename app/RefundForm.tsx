"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refundCardPayment } from "./stripe/actions";
import { Toast } from "./client-ui";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// Refund opens right here (no pop-up): the amount, full by default, then a second tap to confirm.
export default function RefundForm({ paymentId, left, who }: { paymentId: string; left: number; who: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((left / 100).toFixed(2));
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const cents = Math.round(Number(amount.replace(/[$,\s]/g, "")) * 100);
  const valid = Number.isFinite(cents) && cents > 0 && cents <= left;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-thunder-blue dark:text-blue-400">
        Refund…
      </button>
    );
  return (
    <div className="space-y-2 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
      <label className="flex items-center gap-2 text-sm">
        Refund $
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setSure(false);
          }}
          className="w-28 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 tabular-nums dark:border-white/15 dark:bg-zinc-900"
        />
        <span className="text-xs text-zinc-500">of {money(left)} left</span>
      </label>
      {!valid && amount && <p className="text-xs text-red-600 dark:text-red-400">Enter an amount up to {money(left)}.</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => {
            if (!sure) return setSure(true);
            start(async () => {
              const r = await refundCardPayment(paymentId, cents);
              if (!r.ok) return setMsg(r.message);
              setMsg(`Refunded ${money(cents)}. Stripe returns it to the card in 5–10 days.`);
              setOpen(false);
              setSure(false);
              router.refresh();
            });
          }}
          className={`rounded-full px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${sure ? "bg-red-600" : "bg-thunder-blue"}`}
        >
          {busy ? "Refunding…" : sure ? `Yes, refund ${money(cents)} to ${who}` : `Refund ${valid ? money(cents) : ""}`}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setSure(false);
          }}
          className="rounded-full px-3.5 py-1.5 text-sm font-medium text-zinc-600 ring-1 ring-zinc-950/10 dark:text-zinc-300 dark:ring-white/15"
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-zinc-500">Stripe keeps its card fee on a refund.</p>
      {msg && <Toast key={msg} message={msg} />}
    </div>
  );
}
