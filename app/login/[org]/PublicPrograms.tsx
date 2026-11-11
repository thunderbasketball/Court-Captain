"use client";

import { useState, useTransition } from "react";
import type { PublicDay, PublicGroup } from "@/lib/public-league";
import { REC_LIMITED } from "@/lib/program-options";
import { loadPublicProgram } from "../../league/actions";
import { ProgramSchedule, ProgramTeams } from "../../PublicProgramViews";
import { MyTeams } from "../../FollowTeams";
import RegisterChoice from "./RegisterChoice";

export type ProgramCard = {
  id: string;
  name: string;
  kind: string;
  dates: string;
  status: string; // "Register by Feb 14", "Starts Dec 5", "Under way · ends Feb 28", "Ended Feb 28"
  logo: string | null;
  recLimited: boolean;
  register: boolean; // Register button (registration open and Team Registrations on)
};

type Loaded = { groups: PublicGroup[]; schedule: PublicDay[] | null; today: string };

const tabCls = (on: boolean) =>
  `shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${
    on
      ? "border-thunder-orange text-zinc-900 dark:text-white"
      : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
  }`;

// The organization's programs on its login page, no login needed (SPEC.md section 14): open for registration, under
// way, or ended in the last 30 days. Tap one to open it right here: Teams, and a League's Schedule once published.
export default function PublicPrograms({ org, programs }: { org: string; programs: ProgramCard[] }) {
  if (!programs.length) return null;
  return (
    <>
      {/* The teams this device follows (☆ on a program's Teams). */}
      <MyTeams org={org} />
      <section className="mt-4 space-y-2">
      <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Programs</h2>
      <ul className="space-y-2">
        {programs.map((p) => (
          <Program key={p.id} org={org} p={p} />
        ))}
      </ul>
      </section>
    </>
  );
}

function Program({ org, p }: { org: string; p: ProgramCard }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [tab, setTab] = useState<"teams" | "schedule">("teams");
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, start] = useTransition();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !data)
      start(async () => {
        setError(null);
        const r = await loadPublicProgram(org, p.id);
        if (r.ok) setData(r);
        else setError(r.message);
      });
  };
  const teamCount = data?.groups.reduce((n, g) => n + g.teams.length, 0);

  return (
    <li className="rounded-xl bg-white p-3 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left hover:bg-zinc-50 dark:hover:bg-white/5"
        >
          {p.logo && (
            // eslint-disable-next-line @next/next/no-img-element -- an uploaded image served by /program-logo
            <img src={p.logo} alt="" className="size-10 shrink-0 rounded-lg object-contain" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{p.name}</span>
            <span className="block text-xs text-zinc-500">
              {p.kind} · {p.dates}
            </span>
            <span className="block text-xs text-zinc-500">{p.status}</span>
            {p.recLimited && p.register && (
              <span className="block text-xs font-medium text-amber-700 dark:text-amber-300">{REC_LIMITED}</span>
            )}
          </span>
          <span aria-hidden className={`shrink-0 text-zinc-400 transition ${open ? "rotate-90" : ""}`}>
            ›
          </span>
        </button>
        {p.register && !asking && (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="shrink-0 rounded-full bg-thunder-blue px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-thunder-blue/90"
          >
            Register
          </button>
        )}
      </div>

      {asking && (
        <div className="mt-3 space-y-2">
          <RegisterChoice org={org} programId={p.id} />
          <button type="button" onClick={() => setAsking(false)} className="text-xs text-zinc-500 hover:underline">
            Cancel
          </button>
        </div>
      )}

      {open && (
        <div className="mt-3">
          <div role="tablist" className="mb-3 flex gap-1 border-b border-zinc-200 dark:border-white/10">
            <button type="button" role="tab" aria-selected={tab === "teams"} onClick={() => setTab("teams")} className={tabCls(tab === "teams")}>
              Teams{teamCount !== undefined && ` (${teamCount})`}
            </button>
            {p.kind === "League" && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === "schedule"}
                onClick={() => setTab("schedule")}
                className={tabCls(tab === "schedule")}
              >
                Schedule
              </button>
            )}
          </div>
          {loading && !data && <p className="p-2 text-sm text-zinc-500">Loading…</p>}
          {error && <p className="p-2 text-sm text-red-600">{error}</p>}
          {data && tab === "teams" && <ProgramTeams org={org} groups={data.groups} />}
          {data && tab === "schedule" && <ProgramSchedule days={data.schedule} today={data.today} />}
        </div>
      )}
    </li>
  );
}
