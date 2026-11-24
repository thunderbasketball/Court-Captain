"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProgramCartItem } from "@/lib/cart";
import { money, shortDate } from "@/lib/program-options";
import { Toast } from "../client-ui";
import { registerCartItemLater } from "./actions";

// A League program's In carts card (its Owners): what's in people's carts for it, by organization and whose cart, not paid
// for yet. Each can be registered now and paid later, case by case (asked first): due the day before its first Game Day.
export default function ProgramCarts({ items, canAct }: { items: ProgramCartItem[]; canAct: boolean }) {
  const groups: { key: string; org: string; who: string; items: ProgramCartItem[] }[] = [];
  for (const i of items) {
    const key = `${i.org} ${i.who}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, org: i.orgName, who: i.who, items: [] }));
    g.items.push(i);
  }
  if (!items.length) return <p className="text-sm text-zinc-500">Nothing is in anyone&apos;s cart for this event.</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">Not registered: waiting to be paid. What isn&apos;t paid for in 7 days comes out of the cart.</p>
      {groups.map((g) => (
        <section key={g.key} className="space-y-1">
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="font-semibold">{g.org}</span> <span className="text-zinc-500">· {g.who}&rsquo;s cart</span>
            </span>
            <span className="shrink-0 font-bold tabular-nums">{money(g.items.reduce((n, i) => n + i.cents, 0))}</span>
          </p>
          <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
            {g.items.map((i) => (
              <Line key={i.id} i={i} canAct={canAct} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Line({ i, canAct }: { i: ProgramCartItem; canAct: boolean }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <li className="space-y-1.5 px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {i.team} <span className="text-xs font-normal text-zinc-500">{i.level}</span>
          </p>
          <p className="text-xs text-zinc-500">
            {i.adding && "Adding: "}
            {i.what} · added {shortDate(i.added)}, until {shortDate(i.until)}
          </p>
          {i.problem && <p className="text-xs font-medium text-red-600 dark:text-red-400">{i.problem}</p>}
        </div>
        <p className="shrink-0 tabular-nums">{money(i.cents)}</p>
      </div>
      {canAct && !i.problem && !msg && (
        <div className="flex flex-wrap items-center gap-3">
          {sure && (
            <p className="w-full text-xs text-zinc-600 dark:text-zinc-300">
              Register {i.team} now? {i.orgName} owes {money(i.cents)}, due {shortDate(i.due)} (the day before its first Game Day){i.org !== "scenic-city" && "; its invoice is emailed"}. It comes out of{" "}
              {i.who}&rsquo;s cart.
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!sure) return setSure(true);
              start(async () => {
                setErr(null);
                const r = await registerCartItemLater(i.id);
                if (!r.ok) return setErr(r.message);
                setMsg(`${r.team} is registered, to pay later.`);
                router.refresh();
              });
            }}
            className="rounded-full px-3 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 disabled:opacity-50 dark:text-blue-400"
          >
            {busy ? "Registering…" : sure ? "Yes, register it · Pay later" : "Register now · Pay later"}
          </button>
          {sure && (
            <button type="button" className="text-xs text-zinc-500" onClick={() => setSure(false)}>
              Cancel
            </button>
          )}
        </div>
      )}
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      {msg && <Toast key={msg} message={msg} />}
    </li>
  );
}
