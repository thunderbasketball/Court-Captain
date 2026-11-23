"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPaid } from "./org/scenic-city/actions";
import type { TeamRegistration } from "@/lib/registrations-list";
import type { TeamCardPayment } from "@/lib/stripe/refunds";
import RefundForm from "./RefundForm";
import { money } from "@/lib/program-options";
import { formatCell } from "@/lib/phone";
import { Chip, EmailLink, PhoneLink, pillCls } from "./ui";
import SubCard from "./SubCard";
import { TZ } from "@/lib/time";

// The Registrations card's list (rows from lib/registrations-list): a program (when there's more than one) and a view:
// Newest first, By division, By organization, or Unpaid. Each team one line; tap it for its details and Mark paid /
// Mark unpaid (Directors of Programs; checked again on the server, who did it recorded).
const VIEWS = [
  { key: "newest", label: "Newest" },
  { key: "division", label: "By division" },
  { key: "org", label: "By organization" },
  { key: "unpaid", label: "Unpaid" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });

type Pay = { payments: Record<string, TeamCardPayment>; canRefund: boolean };

export default function RegistrationsView({
  programs,
  rows: loaded,
  payments = {},
  canRefund = false,
}: { programs: { id: string; name: string }[]; rows: TeamRegistration[] } & Partial<Pay>) {
  const [program, setProgram] = useState(programs[0]?.id ?? "");
  // Marked Paid / Unpaid here: shown at once (the page refreshes behind it).
  const [marks, setMarks] = useState<Record<string, { paid: boolean; by: string }>>({});
  const rows = loaded.map((r) => {
    const m = marks[`${r.programId}-${r.teamId}`];
    return m ? { ...r, paid: m.paid, paidSetBy: m.by } : r;
  });
  const marked = (r: TeamRegistration, paid: boolean) => setMarks((x) => ({ ...x, [`${r.programId}-${r.teamId}`]: { paid, by: "you" } }));
  const [view, setView] = useState<View>("newest");
  const mine = rows.filter((r) => r.programId === program);
  if (!programs.length) return <p className="text-sm text-zinc-500">No current programs.</p>;
  const shown = view === "unpaid" ? mine.filter((r) => !r.paid && !r.out && r.feeCents !== null && r.feeCents > 0) : mine;
  // Grouped views: a card per division or organization, each sorted by team name.
  const groups =
    view === "division" || view === "org"
      ? [...new Set(shown.map((r) => (view === "division" ? r.division : r.from)))]
          .sort((a, b) => (view === "division" ? 0 : a.localeCompare(b)))
          .map((k) => ({
            key: k,
            rows: shown.filter((r) => (view === "division" ? r.division : r.from) === k).sort((a, b) => a.team.localeCompare(b.team)),
          }))
      : null;
  const unpaid = mine.filter((r) => !r.paid && !r.out && r.feeCents !== null && r.feeCents > 0).length;

  return (
    <div className="space-y-3">
      {programs.length > 1 && (
        <div className="flex flex-wrap gap-2" aria-label="Program">
          {programs.map((p) => (
            <button key={p.id} type="button" className={pillCls(p.id === program)} onClick={() => setProgram(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2" aria-label="View">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" className={pillCls(v.key === view)} onClick={() => setView(v.key)}>
            {v.label}
            {v.key === "unpaid" && unpaid > 0 ? ` (${unpaid})` : ""}
          </button>
        ))}
      </div>
      <p className="text-sm text-zinc-500">
        {mine.length} team{mine.length === 1 ? "" : "s"} registered
        {view === "unpaid" ? ` · ${shown.length} unpaid` : ""}
      </p>
      {!shown.length && <p className="text-sm text-zinc-500">{view === "unpaid" ? "Every team is paid." : "No teams registered yet."}</p>}
      {groups ? (
        <div className="space-y-2">
          {groups.map((g) => (
            <SubCard key={g.key} title={g.key} count={g.rows.length}>
              <Rows rows={g.rows} onMarked={marked} payments={payments} canRefund={canRefund} />
            </SubCard>
          ))}
        </div>
      ) : (
        shown.length > 0 && (
          <div className="overflow-hidden rounded-xl ring-1 ring-zinc-950/10 dark:ring-white/10">
            <Rows rows={shown} showWhen onMarked={marked} payments={payments} canRefund={canRefund} />
          </div>
        )
      )}
    </div>
  );
}

function Rows({
  rows,
  showWhen = false,
  onMarked,
  payments,
  canRefund,
}: {
  rows: TeamRegistration[];
  showWhen?: boolean;
  onMarked: (r: TeamRegistration, paid: boolean) => void;
} & Pay) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-white/5">
      {rows.map((r) => (
        <li key={`${r.programId}-${r.teamId}`}>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className={`block font-medium ${r.out ? "text-zinc-400 line-through" : ""}`}>
                  {r.team} <span className="font-normal text-zinc-500">({r.tag})</span>
                </span>
                <span className="block text-xs text-zinc-500">
                  {r.gradeLabel} {r.level}
                  {showWhen ? ` · ${when(r.registeredAt)}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {r.feeCents !== null && r.feeCents > 0 && (
                  <Chip tone={r.paid ? "green" : "amber"}>{r.paid ? "Paid" : "Unpaid"}</Chip>
                )}
                <span aria-hidden className="text-xs text-zinc-400 transition group-open:rotate-90">
                  ▶
                </span>
              </span>
            </summary>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 pb-3 text-sm">
              <dt className="text-zinc-500">From</dt>
              <dd>{r.from}</dd>
              <dt className="text-zinc-500">Division</dt>
              <dd>
                {r.division} · {r.group}
              </dd>
              {r.registeredFor && (
                <>
                  <dt className="text-zinc-500">For</dt>
                  <dd>{r.registeredFor}</dd>
                </>
              )}
              {r.feeCents !== null && (
                <>
                  <dt className="text-zinc-500">Fee</dt>
                  <dd className="space-y-1.5">
                    <span className="block">
                      {money(r.feeCents)} · {r.paid ? "Paid" : "Unpaid"}
                      {r.paidSetBy && <span className="text-zinc-500"> · marked by {r.paidSetBy}</span>}
                    </span>
                    <PaidButton r={r} onMarked={onMarked} />
                  </dd>
                </>
              )}
              {payments[`${r.programId}-${r.teamId}`] && (
                <CardPaid p={payments[`${r.programId}-${r.teamId}`]} canRefund={canRefund} team={{ id: r.teamId, name: r.team }} />
              )}
              <dt className="text-zinc-500">Registered</dt>
              <dd>
                {when(r.registeredAt)} by {r.registeredBy}
              </dd>
              <dt className="text-zinc-500">Head Coach</dt>
              <dd className="min-w-0">
                {r.coach ?? "None yet"}
                {r.coachCell && (
                  <span className="block">
                    <PhoneLink cell={r.coachCell} label={formatCell(r.coachCell)} />
                  </span>
                )}
                {r.coachEmail && (
                  <span className="block truncate">
                    <EmailLink email={r.coachEmail} />
                  </span>
                )}
              </dd>
              {r.out && (
                <>
                  <dt className="text-zinc-500">Status</dt>
                  <dd>Taken out of the program</dd>
                </>
              )}
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}

// Mark paid / Mark unpaid on one registration (the server checks it's a Director of Programs, and records who).
function PaidButton({ r, onMarked }: { r: TeamRegistration; onMarked: (r: TeamRegistration, paid: boolean) => void }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const next = !r.paid;
  return (
    <span className="block">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await setPaid(r.programId, r.teamId, next);
            if (!res.ok) return setError(res.message);
            onMarked(r, next);
            router.refresh();
          })
        }
        className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 disabled:opacity-50 ${
          next
            ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-700"
            : "text-zinc-600 ring-zinc-950/15 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-white/20 dark:hover:bg-white/5"
        }`}
      >
        {busy ? "Saving…" : next ? "Mark paid" : "Mark unpaid"}
      </button>
      {error && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });

// The team's card payment: what was charged (with the card fee when added), refunds, and Refund (any amount up to
// what's left; the server checks it's the League's Owner). One payment for several teams says so.
function CardPaid({ p, canRefund, team }: { p: TeamCardPayment; canRefund: boolean; team: { id: string; name: string } }) {
  const left = p.paidCents - p.refundedCents;
  return (
    <>
      <dt className="text-zinc-500">Card</dt>
      <dd className="space-y-1">
        <span className="block">
          {dollars(p.paidCents)} paid by {p.by} on {day(p.at)}
          {p.teams > 1 && <span className="text-zinc-500"> · one payment for {p.teams} teams</span>}
        </span>
        {p.refunds.map((f, i) => (
          <span key={i} className="block text-xs font-medium text-amber-700 dark:text-amber-300">
            Refunded {dollars(f.cents)} by {f.by} on {day(f.at)}
          </span>
        ))}
        {left > 0 && canRefund && <RefundForm paymentId={p.id} left={left} who={p.who} team={team} />}
      </dd>
    </>
  );
}
