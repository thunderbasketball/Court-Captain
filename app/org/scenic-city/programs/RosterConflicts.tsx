"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ConflictSide, LeagueConflicts, RosterConflict, RosterReport } from "@/lib/roster-conflicts";
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
  const list = (items: RosterConflict[]) => <ConflictList programId={programId} items={items} canAct={canAct} />;
  const allowed = [...r.allowed, ...r.reviewed.filter((c) => c.allowed)];
  const different = r.reviewed.filter((c) => !c.allowed);
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
      {group("Allowed", allowed.length, "On two rosters and allowed, each with why.", list(allowed))}
      {group("Different players", different.length, "Comes back if a team, name or birthdate changes.", list(different))}
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

// Home's To Do, Teams → Warnings: a League's pairs in the same cards, Conflict (red), Likely (amber) and Allowed (noted, with why).
export function ConflictGroups({ p, canAct, base }: { p: LeagueConflicts; canAct: boolean; base?: string }) {
  return (
    <div className="mb-2 space-y-2">
      <p className="text-sm font-medium">{p.program}</p>
      {(["Conflict", "Likely"] as const).map((s) => {
        const items = p.conflicts.filter((c) => c.strength === s);
        return (
          items.length > 0 && (
            <SubCard key={s} title={s} count={items.length} alert={s === "Conflict"} warn={s === "Likely"} open>
              <p className="mb-2 text-xs text-zinc-500">{ABOUT[s]}</p>
              <ConflictList programId={p.programId} items={items} canAct={canAct} base={base} />
            </SubCard>
          )
        );
      })}
      {p.allowed.length > 0 && (
        <SubCard title="Allowed" count={p.allowed.length}>
          <p className="mb-2 text-xs text-zinc-500">On two rosters and allowed, each with why.</p>
          <ConflictList programId={p.programId} items={p.allowed} canAct={canAct} base={base} />
        </SubCard>
      )}
    </div>
  );
}

// Pairs, side by side on a PC, each with its two buttons (Home's To Do shows them too).
// `base`: an organization's own address, to open its teams.
export function ConflictList({ programId, items, canAct, base }: { programId: string; items: RosterConflict[]; canAct: boolean; base?: string }) {
  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <Pair key={c.pair} programId={programId} c={c} canAct={canAct} base={base} />
      ))}
    </ul>
  );
}

function Side({ s, base }: { s: ConflictSide; base?: string }) {
  const team = [s.org, s.team].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0 rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-white/5">
      <p className="font-semibold">{s.name}</p>
      <p className="text-xs text-zinc-500">
        {s.orgKey && dob(s.dob)}
        {s.grade && ` · ${s.grade}`}
      </p>
      <p className="text-xs">
        {base && s.sourceId ? (
          <Link href={`${base}/teams/${s.sourceId}`} className="font-medium text-thunder-blue hover:underline dark:text-blue-400">
            {team}
          </Link>
        ) : (
          team
        )}
      </p>
      <p className="text-xs text-zinc-500">
        {s.division}
        {s.locked && " · League roster"}
      </p>
    </div>
  );
}

function Pair({ programId, c, canAct, base }: { programId: string; c: RosterConflict; canAct: boolean; base?: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null); // "Allow it" asks why
  const decide = (d: "different" | "allowed" | null, reason?: string) =>
    start(async () => {
      setErr(null);
      const r = await reviewRosterConflict(programId, c.pair, d, reason);
      if (!r.ok) return setErr(r.message);
      setWhy(null);
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
        <Side s={c.a} base={base} />
        <Side s={c.b} base={base} />
      </div>
      {c.allowed && <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">✓ {c.allowed}</p>}
      {c.review?.decision === "different" && <p className="text-xs text-zinc-500">Different players · {c.review.by}</p>}
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
              <button type="button" disabled={busy} onClick={() => setWhy(why === null ? "" : null)} className={btn}>
                Allow it
              </button>
            </>
          )}
        </div>
      )}
      {canAct && why !== null && !c.review && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            decide("allowed", why);
          }}
        >
          <input
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            maxLength={200}
            autoFocus
            placeholder="Why is it allowed? The teams see this."
            className="min-w-0 flex-1 rounded-lg bg-white px-3 py-1.5 text-base ring-1 ring-zinc-950/15 sm:text-sm dark:bg-zinc-900 dark:ring-white/15"
          />
          <button type="submit" disabled={busy || why.trim().length < 3} className={btn}>
            Save
          </button>
        </form>
      )}
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </li>
  );
}
