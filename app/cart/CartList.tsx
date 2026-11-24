"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money, shortDate as day } from "@/lib/program-options";
import type { Cart, CartGroup } from "@/lib/cart";
import { Toast } from "../client-ui";
import StripeInPage, { payInPage } from "../StripeInPage";
import { payCartGroup, removeCartItem, requestCartInvoice } from "./actions";

// A person's cart (Home's Invoices and Cart card; a team's page): what they picked, by program, each with Remove, its
// total, and Pay. Nothing is registered until it's paid (a Pay later organization may register now and owe it). Teams
// someone else registered meanwhile come out by themselves, saying so.
export default function CartList({ cart, canPay }: { cart: Cart; canPay: boolean }) {
  return (
    <div className="space-y-4">
      {cart.gone.length > 0 && (
        <ul className="space-y-1">
          {cart.gone.map((g) => (
            <Gone key={g.id} id={g.id} why={g.why} />
          ))}
        </ul>
      )}
      {cart.groups.map((g) => (
        <Group key={`${g.org} ${g.programId}`} g={g} canPay={canPay} />
      ))}
    </div>
  );
}

function Gone({ id, why }: { id: string; why: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
      <span>Taken out of your cart: {why}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            await removeCartItem(id);
            router.refresh();
          })
        }
        className="shrink-0 font-medium underline"
      >
        OK
      </button>
    </li>
  );
}

function Group({ g, canPay }: { g: CartGroup; canPay: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ clientSecret: string; account: string } | null>(null);
  const problems = g.lines.filter((l) => l.problem).length;
  const total = g.cents + g.cardCents;
  const pay = (mode?: "card" | "later") =>
    start(async () => {
      setErr(null);
      const r = await payCartGroup(g.org, g.programId, mode, payInPage);
      if (!r.ok) {
        setErr(r.message);
        router.refresh(); // it may have changed
        return;
      }
      if (r.payInPage) return setPaying(r.payInPage); // Stripe's form right here
      if (r.pay) {
        window.location.href = r.pay; // Stripe's own page; registered once paid
        return;
      }
      if (r.registered)
        setMsg(`Registered ${r.registered} team${r.registered === 1 ? "" : "s"}. The invoice is emailed (check Spam if you don't see it).`);
      router.refresh();
    });
  return (
    <section className="space-y-2">
      <p className="text-sm font-semibold">
        {g.program} <span className="font-normal text-zinc-500">· {g.orgName}</span>
      </p>
      <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
        {g.lines.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">
                {l.team} <span className="text-xs font-normal text-zinc-500">{l.level}</span>
              </p>
              <p className="text-xs text-zinc-500">
                {l.adding && "Adding: "}
                {l.what} <span className="whitespace-nowrap">· in your cart until {day(l.until)}</span>
              </p>
              {l.problem && <p className="text-xs font-medium text-red-600 dark:text-red-400">{l.problem} Remove it to pay for the rest.</p>}
            </div>
            <div className="shrink-0 text-right">
              <p className="tabular-nums">{l.problem ? "—" : money(l.cents)}</p>
              <button
                type="button"
                disabled={busy || !!paying || !canPay}
                onClick={() =>
                  start(async () => {
                    const r = await removeCartItem(l.id);
                    if (!r.ok) setErr(r.message);
                    router.refresh();
                  })
                }
                className="text-xs font-medium text-red-600 disabled:opacity-50 dark:text-red-400"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      {paying ? (
        <StripeInPage pay={paying} onCancel={() => setPaying(null)} amount={money(total)} />
      ) : (
        <>
          <p className="flex items-baseline justify-between text-sm">
            <span className="text-zinc-500">
              {g.lines.length} team{g.lines.length === 1 ? "" : "s"}
              {g.cardCents > 0 && ` · card processing ${money(g.cardCents)}`}
            </span>
            <span className="font-bold tabular-nums">{money(total)}</span>
          </p>
          {canPay && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || problems > 0}
                onClick={() => pay(g.payLater && g.cents > 0 ? "card" : undefined)}
                className="flex-1 rounded-full bg-[#635bff] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "One moment…" : g.cents > 0 ? `Pay ${money(total)}` : "Register"}
              </button>
              {!g.payLater && g.cents > 0 && (
                <button
                  type="button"
                  disabled={busy || problems > 0}
                  onClick={() =>
                    start(async () => {
                      setErr(null);
                      const r = await requestCartInvoice(g.org, g.programId);
                      if (!r.ok) setErr(r.message);
                      else setMsg(`Invoice #${r.id} is emailed (check Spam if you don't see it). Its teams register when it's paid.`);
                      router.refresh();
                    })
                  }
                  className="flex-1 rounded-full px-4 py-2.5 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 disabled:opacity-50 dark:text-blue-400"
                >
                  Request an invoice
                </button>
              )}
              {g.payLater && g.cents > 0 && (
                <button
                  type="button"
                  disabled={busy || problems > 0}
                  onClick={() => pay("later")}
                  className="flex-1 rounded-full px-4 py-2.5 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 disabled:opacity-50 dark:text-blue-400"
                >
                  Pay later (register now, due in 30 days)
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-zinc-500">
            {g.payLater ? "Registered when you pay, or now if you choose Pay later (its invoice is due in 30 days)." : "Not registered until it's paid, by card now or from an invoice (pay it by the day before the first event)."}
          </p>
        </>
      )}
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {msg && <Toast key={msg} message={msg} />}
    </section>
  );
}
