import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import AppHeader from "../../../AppHeader";
import PaidNotice from "../../../PaidNotice";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { invoiceFor } from "@/lib/invoices";
import { easternDate } from "@/lib/time";
import { teamsManagerOf } from "@/lib/org-teams";
import { stripeApi } from "@/lib/stripe/client";
import { payee } from "@/lib/stripe/registration";
import { InvoiceActions } from "./InvoiceActions";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const dueDay = (d: string, year = false) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: year ? "long" : "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });

// An organization's invoice for a League program (SPEC.md section 14): from the League, each team (division, what it
// registered for, price, paid), the total, paid and balance due; Print / Save as PDF, and Pay by card when something is
// due and the League takes cards (whoever manages the teams). Its managers and the League's Owners see it.
type Params = { params: Promise<{ org: string; programId: string }> };

export default function InvoicePage({ params }: Params) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Invoice params={params} />
    </Suspense>
  );
}

async function Invoice({ params }: Params) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { org, programId } = await params;
  const inv = await invoiceFor(db, user, programId, decodeURIComponent(org));
  if (!inv) notFound();
  const canPay = !user.actingBy && inv.dueCents > 0 && !!(await teamsManagerOf(db, user, inv.org)) && !!(await payee(db, stripeApi()));
  const overdue = !!inv.dueOn && inv.dueOn < easternDate(new Date());
  const issued = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  return (
    <>
      <div className="print:hidden">
        <AppHeader user={user} context={inv.org === "thunder" ? "director" : `org:${inv.org}`} />
      </div>
      <Suspense fallback={null}>
        <PaidNotice />
      </Suspense>
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-6 print:max-w-none print:p-0">
        <InvoiceActions org={inv.org} programId={inv.programId} canPay={canPay} due={money(inv.dueCents)} />
        <article className="space-y-5 rounded-2xl bg-white p-6 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10 print:rounded-none print:bg-white print:text-black print:ring-0">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Invoice</p>
              <h1 className="text-xl font-semibold">{inv.from}</h1>
              <p className="text-sm text-zinc-500">{issued}</p>
              {inv.dueOn && (
                <p className={`text-sm font-semibold ${overdue ? "text-red-600" : "text-zinc-700 dark:text-zinc-200 print:text-black"}`}>
                  {overdue ? "Was due" : "Due"} {dueDay(inv.dueOn, true)}
                </p>
              )}
            </div>
            <span
              className={`rounded-full px-3 py-1 text-sm font-bold ${
                overdue ? "bg-red-100 text-red-800" : inv.dueCents > 0 ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {overdue ? "OVERDUE" : inv.dueCents > 0 ? (inv.payLater ? "PAY LATER" : "BALANCE DUE") : "PAID"}
            </span>
          </header>
          <div className="text-sm">
            <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Bill to</p>
            <p className="font-semibold">{inv.orgName}</p>
            <p className="text-zinc-500">
              {inv.program} · {inv.dates}
            </p>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500 uppercase dark:border-white/10">
              <tr>
                <th className="py-2 font-semibold">Team</th>
                <th className="py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {inv.lines.map((l) => (
                <tr key={l.teamId} className="align-top">
                  <td className="py-2">
                    <p className="font-medium">{l.team}</p>
                    <p className="text-xs text-zinc-500">{l.division}</p>
                    <p className="text-xs text-zinc-500">{l.what}</p>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(l.cents)}
                    {l.paid ? (
                      <p className="text-xs font-semibold text-emerald-700">PAID{l.paidBy ? ` · ${l.paidBy}` : ""}</p>
                    ) : (
                      <p className="text-xs font-semibold text-amber-700">
                        {l.paidCents > 0 && `${money(l.paidCents)} paid · ${money(l.cents - l.paidCents)} `}Due{l.dueOn ? ` ${dueDay(l.dueOn)}` : ""}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto w-full max-w-xs space-y-1 border-t border-zinc-200 pt-3 text-sm dark:border-white/10">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Total</dt>
              <dd className="tabular-nums">{money(inv.totalCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Paid</dt>
              <dd className="tabular-nums">−{money(inv.paidCents)}</dd>
            </div>
            <div className="flex justify-between text-base font-bold">
              <dt>Balance due</dt>
              <dd className="tabular-nums">{money(inv.dueCents)}</dd>
            </div>
          </dl>
          <p className="text-xs text-zinc-500">
            Questions about this invoice? Contact {inv.from}. Teams registered after this date are added as they register.
          </p>
        </article>
      </main>
    </>
  );
}
