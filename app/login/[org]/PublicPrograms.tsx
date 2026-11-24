"use client";

import { useState, useTransition } from "react";
import type { PublicDay, PublicGroup } from "@/lib/public-league";
import { REC_LIMITED } from "@/lib/program-options";
import { loadPublicProgram } from "../../league/actions";
import { ProgramDivisions } from "../../PublicProgramViews";
import Link from "next/link";

export type ProgramCard = {
  id: string;
  name: string;
  kind: string;
  dates: string;
  status: string; // "Register by Feb 14", "Starts Dec 5", "Under way · ends Feb 28", "Ended Feb 28"
  logo: string | null;
  recLimited: boolean;
  register: boolean; // Register button (registration open and Team Registrations on)
  org?: string; // another organization's program (its teams are in it): read there, no ☆, with a link to its page
  openable: boolean; // taps open its Teams (and a League's Schedule); a player program (season) just shows
};

type Loaded = { groups: PublicGroup[]; schedule: PublicDay[] | null; soon: string[]; today: string };


// The organization's programs on its login page, no login needed (SPEC.md section 14): open for registration, under
// way, or ended in the last 30 days. Tap one to open it right here: Division → REC / COMP → Grade (Standings, Schedule).
export default function PublicPrograms({ org, programs, title = "Programs" }: { org: string; programs: ProgramCard[]; title?: string }) {
  if (!programs.length) return null;
  return (
    <>
      <section className="mt-4 space-y-2 lg:mt-0">
      <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{title}</h2>
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
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, start] = useTransition();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !data)
      start(async () => {
        setError(null);
        const r = await loadPublicProgram(p.org ?? org, p.id);
        if (r.ok) setData(r);
        else setError(r.message);
      });
  };

  return (
    <li className="rounded-xl bg-white p-3 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={p.openable ? open : undefined}
          disabled={!p.openable}
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
              {p.kind}
              {p.dates && ` · ${p.dates}`}
            </span>
            <span className="block text-xs text-zinc-500">{p.status}</span>
            {p.recLimited && p.register && (
              <span className="block text-xs font-medium text-amber-700 dark:text-amber-300">{REC_LIMITED}</span>
            )}
          </span>
          {p.openable && (
            <span aria-hidden className={`shrink-0 text-zinc-400 transition ${open ? "rotate-90" : ""}`}>
              ›
            </span>
          )}
        </button>
        {p.register && (
          // One form for an organization's teams (one or more), this event already picked.
          <Link
            href={`/register-team/${org}?program=${p.id}`}
            className="shrink-0 rounded-full bg-thunder-blue px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-thunder-blue/90"
          >
            Register
          </Link>
        )}
      </div>


      {/* Opened: its Divisions, each with REC and COMP, each with its Grades (Standings, then Schedule by date). */}
      {open && (
        <div className="mt-3">
          {loading && !data && <p className="p-2 text-sm text-zinc-500">Loading…</p>}
          {error && <p className="p-2 text-sm text-red-600">{error}</p>}
          {data && <ProgramDivisions org={p.org ?? org} groups={data.groups} schedule={data.schedule} today={data.today} soon={data.soon} follow={!p.org} />}
          {data && p.org && (
            <Link href={`/league/${p.org}?l=${p.id}`} className="mt-2 block px-1 text-sm font-medium text-thunder-blue hover:underline dark:text-blue-400">
              Public view of the League →
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
