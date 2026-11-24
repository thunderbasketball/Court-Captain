"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ConflictSide, RosterConflict, RosterReport } from "@/lib/roster-conflicts";
import SubCard from "../../../SubCard";
import { reviewRosterConflict } from "../actions";

const ABOUT = {
  Conflict: "The same first name, last name and birthdate.",
  Likely: "Nearly the same: a wrong year, a digit off, a nickname or a misspelling.",
  Check: "Maybe: the same birthdate and one name (it could be twins), or the same name with a birthdate missing.",
} as const;
const dob = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}/${d.slice(0, 4)}` : "no birthdate");

// A League program's Roster conflicts card (its Owners, Admins and Directors of Programs): players who look like they're on
// two of its teams against the rules, by how sure it is. Each is marked as different players or allowed (who did is kept).
export default function RosterConflicts({ programId, report: r, canAct }: { programId: string; report: RosterReport; canAct: boolean }) {
  const list = (items: RosterConflict[]) => (
    <ul className="space-y-2">
      {items.map((c) => (
        <Pair key={c.pair} programId={programId} c={c} canAct={canAct} />
      ))}
    </ul>
  );
  const group = (title: string, count: number, about: string, body: ReactNode, tone?: "alert" | "warn") =>
    count > 0 && (
      <SubCard title={title} count={count} alert={tone === "alert"} warn={tone === "warn"}>
        <p className="mb-2 text-xs text-zinc-500">{about}</p>
        {body}
      </SubCard>
    );
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        A player may be on two teams only in the same organization, in different divisions, and never REC and COMP. {r.withRoster} of {r.teams} teams have a roster ({r.players}{" "}
        players{r.missing > 0 && `, ${r.missing} with no birthdate`}).
      </p>
      {!r.conflicts.length && <p className="text-sm text-zinc-500">✓ Nothing to look at.</p>}
      {(["Conflict", "Likely", "Check"] as const).map((s) => {
        const items = r.conflicts.filter((c) => c.strength === s);
        return <div key={s}>{group(s, items.length, ABOUT[s], list(items), s === "Conflict" ? "alert" : s === "Likely" ? "warn" : undefined)}</div>;
      })}
      {group("Allowed", r.allowed.length, "On two teams, within the rules.", list(r.allowed))}
      {group("Reviewed", r.reviewed.length, "Comes back if a team, name or birthdate changes.", list(r.reviewed))}
      {group(
        "Birthdates that can't be right",
        r.birthdates.length,
        "These hide conflicts. The team's organization fixes them on its roster.",
        <ul className="divide-y divide-zinc-100 dark:divide-white/5">
          {r.birthdates.map((b, i) => (
            <li key={i} className="flex justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{b.name}</span>{" "}
                <span className="text-xs text-zinc-500">
                  {b.org} · {b.team}
                </span>
              </span>
              <span className="shrink-0 text-xs text-red-600 dark:text-red-400">
                {dob(b.dob)} · {b.why}
              </span>
            </li>
          ))}
        </ul>,
        "warn",
      )}
    </div>
  );
}

function Side({ s }: { s: ConflictSide }) {
  return (
    <div className="min-w-0 rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-white/5">
      <p className="font-semibold">{s.name}</p>
      <p className="text-xs text-zinc-500">
        {dob(s.dob)}
        {s.grade && ` · ${s.grade}`}
      </p>
      <p className="text-xs">
        {s.org} · {s.team}
      </p>
      <p className="text-xs text-zinc-500">
        {s.division}
        {s.locked && " · League roster"}
      </p>
    </div>
  );
}

function Pair({ programId, c, canAct }: { programId: string; c: RosterConflict; canAct: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const decide = (d: "different" | "allowed" | null) =>
    start(async () => {
      setErr(null);
      const r = await reviewRosterConflict(programId, c.pair, d);
      if (!r.ok) return setErr(r.message);
      router.refresh();
    });
  const btn = "rounded-full px-3 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 disabled:opacity-50 dark:text-blue-400";
  return (
    <li className="space-y-1.5 rounded-xl p-2.5 text-sm ring-1 ring-zinc-950/10 dark:ring-white/10">
      <p className="text-xs">
        {c.why}
        {c.broken.length > 0 && <span className="font-semibold text-red-600 dark:text-red-400"> · {c.broken.join(", ")}</span>}
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        <Side s={c.a} />
        <Side s={c.b} />
      </div>
      {c.review && (
        <p className="text-xs text-zinc-500">
          {c.review.decision === "different" ? "Different players" : "Allowed"} · {c.review.by}
        </p>
      )}
      {canAct && (c.review || c.broken.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {c.review ? (
            <button type="button" disabled={busy} onClick={() => decide(null)} className={btn}>
              Look at it again
            </button>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => decide("different")} className={btn}>
                Different players
              </button>
              <button type="button" disabled={busy} onClick={() => decide("allowed")} className={btn}>
                Allow it
              </button>
            </>
          )}
        </div>
      )}
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </li>
  );
}
