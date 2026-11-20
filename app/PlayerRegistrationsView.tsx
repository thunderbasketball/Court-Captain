"use client";

import { useState } from "react";
import type { PlayerRegistration } from "@/lib/registrations-list";
import { formatCell } from "@/lib/phone";
import { TZ } from "@/lib/time";
import { Chip, EmailLink, PhoneLink, pillCls } from "./ui";
import SubCard from "./SubCard";

// The Registrations card's players (a CourtPlayers organization; rows from lib/registrations-list): a program (when
// there's more than one) and a view: Newest, By grade, By team (Not on a team first), or Fees owed. Each player one line;
// tap for their details. Fees come from TeamSnap (paid there), so they're shown, not changed, here.
const VIEWS = [
  { key: "newest", label: "Newest" },
  { key: "grade", label: "By grade" },
  { key: "team", label: "By team" },
  { key: "owed", label: "Fees owed" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });
const dollars = (v: string | null) => (v === null ? null : `$${Number(v).toFixed(2).replace(/\.00$/, "")}`);
const owes = (p: PlayerRegistration) => !p.feesWaivedBy && Number(p.amountRemaining ?? 0) > 0;
const gradeName = (g: string) => (g === "K" ? "K" : `${g}${["", "st", "nd", "rd"][Number(g)] ?? "th"}`);
const SMALL_TEAM = 7; // By team: a team with fewer registered players is highlighted
const programKey = (p: PlayerRegistration) => p.programId ?? `name:${p.program}`;

export default function PlayerRegistrationsView({ programs, rows }: { programs: { id: string; name: string }[]; rows: PlayerRegistration[] }) {
  const [program, setProgram] = useState(programs[0]?.id ?? "");
  const [view, setView] = useState<View>("newest");
  if (!programs.length) return <p className="text-sm text-zinc-500">No players registered yet.</p>;
  const mine = rows.filter((p) => programKey(p) === program);
  const shown = view === "owed" ? mine.filter(owes) : mine;
  const byName = (a: PlayerRegistration, b: PlayerRegistration) =>
    a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
  // Grouped views: a card per grade (Boys then Girls, youngest first) or per team (Not on a team first, then by name;
  // a team with fewer than 7 registered players in amber).
  const groups =
    view === "grade"
      ? [...new Map(shown.map((p) => [`${p.gender}|${String(p.gradeSort).padStart(2, "0")}`, `${p.gender} ${gradeName(p.grade)}`])).entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, label]) => ({
            key: k,
            label,
            rows: shown.filter((p) => `${p.gender}|${String(p.gradeSort).padStart(2, "0")}` === k).sort(byName),
          }))
      : view === "team"
        ? [...new Set(shown.map((p) => p.team ?? ""))]
            .sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, undefined, { numeric: true })))
            .map((k) => ({ key: k || "none", label: k || "Not on a team", rows: shown.filter((p) => (p.team ?? "") === k).sort(byName) }))
        : null;
  const small = view === "team" ? (groups ?? []).filter((g) => g.key !== "none" && g.rows.length < SMALL_TEAM).length : 0;
  const owedCount = mine.filter(owes).length;
  const owedTotal = mine.filter(owes).reduce((n, p) => n + Number(p.amountRemaining ?? 0), 0);

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
            {v.key === "owed" && owedCount > 0 ? ` (${owedCount})` : ""}
          </button>
        ))}
      </div>
      <p className="text-sm text-zinc-500">
        {mine.length} player{mine.length === 1 ? "" : "s"} registered
        {view === "owed" ? ` · ${owedCount} owe ${dollars(owedTotal.toFixed(2))} (paid in TeamSnap)` : ""}
        {small > 0 && (
          <span className="text-amber-700 dark:text-amber-400">
            {" "}
            · {small} team{small === 1 ? "" : "s"} under {SMALL_TEAM} players
          </span>
        )}
      </p>
      {!shown.length && <p className="text-sm text-zinc-500">{view === "owed" ? "No fees owed." : "No players registered yet."}</p>}
      {groups ? (
        <div className="space-y-2">
          {groups.map((g) => (
            <SubCard key={g.key} title={g.label} count={g.rows.length} warn={view === "team" && g.key !== "none" && g.rows.length < SMALL_TEAM}>
              <Rows rows={g.rows} />
            </SubCard>
          ))}
        </div>
      ) : (
        shown.length > 0 && (
          <div className="overflow-hidden rounded-xl ring-1 ring-zinc-950/10 dark:ring-white/10">
            <Rows rows={shown} showWhen />
          </div>
        )
      )}
    </div>
  );
}

function Contact({ name, cell, email }: { name: string | null; cell: string | null; email: string | null }) {
  if (!name && !cell && !email) return null;
  return (
    <span className="block min-w-0">
      {name ?? "Parent"}
      {cell && (
        <span className="block">
          <PhoneLink cell={cell} label={formatCell(cell)} />
        </span>
      )}
      {email && (
        <span className="block truncate">
          <EmailLink email={email} />
        </span>
      )}
    </span>
  );
}

function Rows({ rows, showWhen = false }: { rows: PlayerRegistration[]; showWhen?: boolean }) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-white/5">
      {rows.map((p) => (
        <li key={p.registrantId}>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="block font-medium">
                  {p.firstName} {p.lastName}
                </span>
                <span className="block text-xs text-zinc-500">
                  {p.gender} {gradeName(p.grade)} · {p.team ?? "Not on a team"}
                  {showWhen && p.registeredAt ? ` · ${when(p.registeredAt)}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {p.feesWaivedBy ? (
                  <Chip tone="zinc">Waived</Chip>
                ) : owes(p) ? (
                  <Chip tone="amber">Owes {dollars(p.amountRemaining)}</Chip>
                ) : p.totalFees !== null && Number(p.totalFees) > 0 ? (
                  <Chip tone="green">Paid</Chip>
                ) : null}
                <span aria-hidden className="text-xs text-zinc-400 transition group-open:rotate-90">
                  ▶
                </span>
              </span>
            </summary>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 pb-3 text-sm">
              <dt className="text-zinc-500">Program</dt>
              <dd>{p.program}</dd>
              {p.birthdate && (
                <>
                  <dt className="text-zinc-500">Born</dt>
                  <dd>{new Date(`${p.birthdate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</dd>
                </>
              )}
              <dt className="text-zinc-500">Parents</dt>
              <dd className="min-w-0 space-y-1.5">
                <Contact name={p.parent} cell={p.parentCell} email={p.parentEmail} />
                <Contact name={p.parent2} cell={p.parent2Cell} email={p.parent2Email} />
              </dd>
              {p.coachRequest && (
                <>
                  <dt className="text-zinc-500">Coach request</dt>
                  <dd>{p.coachRequest}</dd>
                </>
              )}
              {p.uniformSize && (
                <>
                  <dt className="text-zinc-500">Uniform</dt>
                  <dd>{p.uniformSize}</dd>
                </>
              )}
              <dt className="text-zinc-500">Fees</dt>
              <dd>
                {p.feesWaivedBy
                  ? `Waived by ${p.feesWaivedBy}`
                  : p.totalFees === null
                    ? "None"
                    : `${dollars(p.totalFees)} · paid ${dollars(p.amountPaid ?? "0")} · owes ${dollars(p.amountRemaining ?? "0")}`}
                {p.checkout && <span className="block text-zinc-500">{p.checkout}</span>}
              </dd>
              <dt className="text-zinc-500">Registered</dt>
              <dd>
                {p.registeredAt ? when(p.registeredAt) : "—"}
                {p.addedBy ? ` · added in the app by ${p.addedBy}` : " · TeamSnap"}
              </dd>
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}
