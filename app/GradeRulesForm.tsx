"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "./client-ui";
import { inputCls, primaryBtn } from "./ui";
import { DEFAULT_RULES, controlDateLabel, schoolYearOf, type GradeRules } from "@/lib/eligibility";

type Saved = { ok: true } | { ok: false; message: string };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EX = 3; // the ages read as a 3rd grade team's (stored as grade + n)
const numCls =
  "w-16 rounded-lg bg-white px-2 py-1.5 text-center text-base ring-1 ring-zinc-950/15 focus:ring-2 focus:ring-thunder-blue focus:outline-none dark:bg-zinc-900 dark:ring-white/20";
const GRADES = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const gradeName = (g: number) => (g === -1 ? "Pre-K" : g === 0 ? "K" : `${g}${["", "st", "nd", "rd"][g] ?? "th"}`);
const ok = (r: GradeRules) =>
  [r.month, r.day, r.oldest].every((n) => Number.isInteger(n)) && (r.exception === null || Number.isInteger(r.exception));

// Each grade under these settings: can't turn this age (born on or after this date), and the age exception's. Follows
// what's typed, so they see what a change means before saving.
function GradeGuide({ r, year }: { r: GradeRules; year: number }) {
  if (!ok(r)) return null;
  const born = (age: number) =>
    new Date(Date.UTC(year + 1 - age, r.month - 1, r.day, 12)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return (
    <div>
      <p className="text-sm font-medium">Each grade for {year}-{String(year + 1).slice(2)}</p>
      <p className="text-xs text-zinc-500">
        Usual: oldest 11 and exception 10 for 3rd grade, with Aug 1 (AAU style). Ages are as of the control date.
      </p>
      <table className="mt-1 w-full text-xs">
        <thead className="text-left text-zinc-500">
          <tr>
            <th className="py-1 pr-2 font-medium">Grade</th>
            <th className="py-1 pr-2 font-medium">Can&apos;t turn · born on/after</th>
            {r.exception !== null && <th className="py-1 font-medium">Exception · born on/after</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
          {GRADES.map((g) => (
            <tr key={g} className={g === EX ? "font-semibold" : ""}>
              <td className="py-1 pr-2">{gradeName(g)}</td>
              <td className="py-1 pr-2 tabular-nums">
                {g + r.oldest} · {born(g + r.oldest)}
              </td>
              {r.exception !== null && (
                <td className="py-1 tabular-nums">
                  {g + r.exception} · {born(g + r.exception)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One line for a gear: "3rd grade 2026-27: can't turn 11 before Aug 1, 2027 · exception: not 10".
export function rulesSummary(r: GradeRules, today: string) {
  const y = schoolYearOf(today);
  return `3rd grade ${y}-${String(y + 1).slice(2)}: can't turn ${r.oldest + EX} before ${controlDateLabel(y, r)} · ${
    r.exception === null ? "no age exception" : `exception: not ${r.exception + EX}`
  }`;
}

// The grade requirements, shown as a 3rd grade team's ages: the control date (in the year after the school year
// starts), the age a player can't turn before it, and the age exception (any grade, if younger than this). With
// `adopt` (an organization), "Adopt League grade requirements" greys its own settings out and uses the League's.
export default function GradeRulesForm({
  rules,
  today,
  adopt,
  save,
  onSaved,
}: {
  rules: GradeRules;
  today: string; // "YYYY-MM-DD", for the example's school year
  adopt?: { on: boolean; league: { name: string; rules: GradeRules } | null };
  save: (rules: GradeRules, adopt: boolean) => Promise<Saved>;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [r, setR] = useState<GradeRules>(rules);
  const [adopting, setAdopting] = useState(adopt?.on ?? false);
  const [msg, setMsg] = useState<string | null>(null);
  const y = schoolYearOf(today);
  const off = adopting; // own settings greyed out while adopting
  const num = (v: string) => (v === "" ? NaN : Number(v));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setMsg(null);
          const res = await save(r, adopting);
          if (!res.ok) return setMsg(res.message);
          router.refresh();
          onSaved();
        });
      }}
    >
      {adopt && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={adopting} onChange={(e) => setAdopting(e.target.checked)} />
          <span>
            <span className="font-medium">Adopt League grade requirements</span>
            <span className="block text-xs text-zinc-500">
              {adopt.league
                ? `${adopt.league.name}: ${rulesSummary(adopt.league.rules, today)}`
                : "No current League: your own settings below are used until there is one."}
            </span>
          </span>
        </label>
      )}
      <fieldset disabled={off} className={`space-y-3 ${off ? "opacity-40" : ""}`}>
        <div>
          <span className="text-sm font-medium">Age control date</span>
          <div className="mt-1 flex items-center gap-2">
            <select
              className={`${inputCls} !w-24`}
              value={r.month}
              onChange={(e) => setR({ ...r, month: Number(e.target.value) })}
              aria-label="Month"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={31}
              className={numCls}
              value={Number.isNaN(r.day) ? "" : r.day}
              onChange={(e) => setR({ ...r, day: num(e.target.value) })}
              aria-label="Day"
            />
            <span className="text-sm text-zinc-500">
              → {controlDateLabel(y, Number.isNaN(r.day) ? DEFAULT_RULES : r)} for {y}-{String(y + 1).slice(2)}
            </span>
          </div>
        </div>
        <label className="block text-sm">
          <span className="font-medium">Oldest</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-zinc-600 dark:text-zinc-300">
            A 3rd grade team: in 3rd grade or below and can&apos;t turn
            <input
              type="number"
              min={8}
              max={15}
              className={numCls}
              value={Number.isNaN(r.oldest) ? "" : r.oldest + EX}
              onChange={(e) => setR({ ...r, oldest: num(e.target.value) - EX })}
            />
            before the control date
          </span>
        </label>
        <div className="text-sm">
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              className="size-4"
              checked={r.exception !== null}
              onChange={(e) => setR({ ...r, exception: e.target.checked ? r.oldest - 1 : null })}
            />
            Age exception
          </label>
          {r.exception !== null && (
            <span className="mt-1 flex flex-wrap items-center gap-2 text-zinc-600 dark:text-zinc-300">
              Any grade, if they don&apos;t turn
              <input
                type="number"
                min={7}
                max={14}
                className={numCls}
                value={Number.isNaN(r.exception) ? "" : r.exception + EX}
                onChange={(e) => setR({ ...r, exception: num(e.target.value) - EX })}
              />
              before it
            </span>
          )}
        </div>
      </fieldset>
      <div className={off ? "opacity-40" : ""}>
        <GradeGuide r={off && adopt?.league ? adopt.league.rules : r} year={y} />
      </div>
      {msg && <Alert tone="red">{msg}</Alert>}
      <button type="submit" disabled={busy} className={primaryBtn}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
