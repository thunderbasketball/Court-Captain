"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import type { FollowedGame, FollowedTeam } from "@/lib/public-league";
import { timeLabel } from "@/lib/time";
import { loadFollowedTeams } from "./league/actions";

// Following teams with no login (SPEC.md section 14): the followed team ids live on this device only (browser storage,
// one list per organization), never on the server. A private window or cleared site data forgets them.
const MAX = 30;
const EVENT = "followed-teams";
const keyOf = (org: string) => `followed-teams:${org}`;

function readRaw(org: string): string {
  try {
    return localStorage.getItem(keyOf(org)) ?? "";
  } catch {
    return "";
  }
}

const parse = (raw: string): string[] => {
  try {
    const v: unknown = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^\d{1,18}$/.test(x)).slice(0, MAX) : [];
  } catch {
    return [];
  }
};

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function useFollowed(org: string): string[] {
  const raw = useSyncExternalStore(subscribe, () => readRaw(org), () => "");
  return useMemo(() => parse(raw), [raw]);
}

function setFollowed(org: string, ids: string[]) {
  try {
    localStorage.setItem(keyOf(org), JSON.stringify(ids.slice(0, MAX)));
  } catch {
    // Storage blocked (private mode on some phones): following just doesn't stick.
  }
  window.dispatchEvent(new Event(EVENT));
}

// ☆ / ★ by a team's name: follow it on this device, or stop.
export function FollowStar({ org, id, name }: { org: string; id: string; name: string }) {
  const followed = useFollowed(org);
  const on = followed.includes(id);
  const full = !on && followed.length >= MAX;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Stop following ${name}` : `Follow ${name}`}
      title={full ? `You can follow up to ${MAX} teams` : on ? "Following (tap to stop)" : "Follow this team"}
      disabled={full}
      onClick={() => setFollowed(org, on ? followed.filter((x) => x !== id) : [...followed, id])}
      className={`-my-1 flex size-8 shrink-0 items-center justify-center rounded-full text-lg leading-none disabled:opacity-30 ${
        on ? "text-amber-500" : "text-zinc-400 hover:text-amber-500"
      }`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const SOON_DAYS = 21;

// My Teams: the teams this device follows. Shows only when following some.
export function MyTeams({ org }: { org: string }) {
  const followed = useFollowed(org);
  const [data, setData] = useState<{ teams: FollowedTeam[]; today: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const key = followed.join(",");

  useEffect(() => {
    if (!key) return;
    start(async () => {
      const r = await loadFollowedTeams(org, key.split(","));
      if (r.ok) {
        setData({ teams: r.teams, today: r.today });
        setError(null);
      } else setError(r.message);
    });
  }, [org, key]);

  if (!followed.length) return null;
  // Unfollowing shows at once, before the reload.
  const shown = data?.teams.filter((t) => followed.includes(t.id));
  return (
    <section className="mt-4 space-y-2">
      <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">My teams</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!shown && !error && <p className="text-sm text-zinc-500">Loading…</p>}
      {shown?.length === 0 && <p className="text-sm text-zinc-500">The teams you followed aren&apos;t in any program now.</p>}
      <ul className="space-y-2">
        {shown?.map((t) => (
          <TeamCard key={t.id} org={org} team={t} today={data!.today} />
        ))}
      </ul>
    </section>
  );
}

type Game = FollowedGame & { program: string };

function GameLine({ g, past = false }: { g: Game; past?: boolean }) {
  return (
    <li className={`flex gap-2 ${past ? "opacity-50" : ""}`}>
      <span className="w-24 shrink-0 text-zinc-500">
        {day(g.date)}
        <span className="block text-xs">{g.starts ? timeLabel(g.starts) : "Time TBA"}</span>
      </span>
      <span className="min-w-0">
        <span className="block">
          <span className="text-zinc-500">{g.home ? "vs" : "at"}</span> <span className="font-medium">{g.opponent}</span>
        </span>
        {g.gym && (
          <span className="block text-xs text-zinc-500">
            {g.gym}
            {g.court ? `, ${g.court}` : ""}
          </span>
        )}
      </span>
    </li>
  );
}

const iconBtn = (on: boolean) =>
  `flex size-8 shrink-0 items-center justify-center rounded-full text-base ring-1 ${
    on ? "bg-thunder-blue text-white ring-thunder-blue" : "ring-zinc-950/10 hover:bg-zinc-50 dark:ring-white/15 dark:hover:bg-white/5"
  }`;

// One followed team: its games in the next 21 days, and 👥 Roster and 📅 Schedule icons on the card, each opening its
// part right here (tap again to close).
function TeamCard({ org, team, today }: { org: string; team: FollowedTeam; today: string }) {
  const [panel, setPanel] = useState<"roster" | "schedule" | null>(null);
  const until = plusDays(today, SOON_DAYS);
  const all: Game[] = team.programs
    .flatMap((p) => (p.games ?? []).map((g) => ({ ...g, program: p.name })))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.starts ?? "99").localeCompare(b.starts ?? "99"));
  const soon = all.filter((g) => g.date >= today && g.date <= until);
  const posted = team.programs.some((p) => p.games !== null);
  const show = (p: "roster" | "schedule") => setPanel((x) => (x === p ? null : p));

  return (
    <li className="rounded-xl bg-white ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
      <div className="flex items-center gap-1.5 p-3 pb-1">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{team.name}</span>
          <span className="block truncate text-xs text-zinc-500">
            {team.programs.length ? team.programs.map((p) => `${p.name} · ${p.group}`).join(" / ") : "Not in a current program"}
          </span>
        </span>
        <button type="button" aria-expanded={panel === "roster"} aria-label="Roster" title="Roster" onClick={() => show("roster")} className={iconBtn(panel === "roster")}>
          👥
        </button>
        <button type="button" aria-expanded={panel === "schedule"} aria-label="Schedule" title="Schedule" onClick={() => show("schedule")} className={iconBtn(panel === "schedule")}>
          📅
        </button>
        <FollowStar org={org} id={team.id} name={team.name} />
      </div>

      {/* Collapsed: the next 21 days. */}
      <div className="px-3 pb-3">
        {soon.length ? (
          <ul className="mt-1 space-y-1.5 text-sm">
            {soon.map((g, i) => (
              <GameLine key={i} g={g} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-zinc-500">
            {posted ? `No games in the next ${SOON_DAYS} days.` : team.programs.length ? "Schedule not posted yet." : ""}
          </p>
        )}
      </div>

      {panel && (
        <div className="border-t border-zinc-100 p-3 dark:border-white/5">
          {panel === "roster" && (
            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Roster</p>
              {team.roster === null ? (
                <p className="text-sm text-zinc-500">This team doesn&apos;t keep its roster here.</p>
              ) : team.roster.length ? (
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {team.roster.map((p, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="w-6 shrink-0 text-right text-zinc-500 tabular-nums">{p.jersey ? `#${p.jersey}` : ""}</span>
                      <span className="truncate">{p.name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-zinc-500">No players listed yet.</p>
              )}
            </div>
          )}

          {panel === "schedule" && (
            <div className="space-y-3">
              {!team.programs.length && <p className="text-sm text-zinc-500">Not in a current program.</p>}
              {team.programs.map((p) => (
                <div key={p.id}>
                  <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    {p.name} · {p.group}
                  </p>
                  {p.games === null ? (
                    <p className="text-sm text-zinc-500">Schedule not posted yet.</p>
                  ) : p.games.length ? (
                    <ul className="space-y-1.5 text-sm">
                      {p.games.map((g, i) => (
                        <GameLine key={i} g={{ ...g, program: p.name }} past={g.date < today} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-zinc-500">No games scheduled yet.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
