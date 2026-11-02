import Link from "next/link";
import type { ReactNode } from "react";
import { Chip } from "./ui";

// What a team still needs, flashing red until it's done.
export function MustBeEntered({ what }: { what: "COACH INFO" | "ROSTER" }) {
  return <span className="block animate-pulse text-sm font-semibold text-red-600 dark:text-red-400">{what} MUST BE ENTERED</span>;
}

// One team on a Teams page, the same for Thunder and every organization: its grade/gender badge, name (and Alternate
// name), level, grades and practice places, its staff (`people`) and buttons (`actions`), and what it still needs:
// a Head Coach (COACH INFO MUST BE ENTERED) and players (ROSTER MUST BE ENTERED).
export default function TeamRow({
  href,
  name,
  altName,
  gender,
  level,
  sub,
  hasCoach,
  players,
  people,
  actions,
}: {
  href: string;
  name: string;
  altName: string | null;
  gender: "Boys" | "Girls";
  level: string;
  sub: string; // e.g. "2nd Grade · Action Church"
  hasCoach: boolean;
  players: number;
  people?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li className="px-4 py-3">
      <Link href={href} className="-mx-2 flex gap-3 rounded-xl px-2 py-1 hover:bg-zinc-50 dark:hover:bg-white/5">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white ${
            gender === "Boys" ? "bg-thunder-blue" : "bg-pink-600"
          }`}
        >
          {name.split(" ")[0]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-semibold">
              {name}
              {altName && <span className="font-normal text-zinc-500"> · {altName}</span>}
            </p>
            <Chip tone={level === "COMP" ? "orange" : "zinc"}>{level}</Chip>
          </div>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{sub}</p>
        </div>
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="mt-3 size-5 shrink-0 text-zinc-300">
          <path
            fillRule="evenodd"
            d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </Link>
      <div className="mt-1.5 flex items-start gap-2 pl-12">
        <div className="flex flex-1 flex-col gap-1">
          {people && <div className="flex flex-wrap gap-x-1 gap-y-1">{people}</div>}
          {!hasCoach && <MustBeEntered what="COACH INFO" />}
          {!players && <MustBeEntered what="ROSTER" />}
        </div>
        {actions}
      </div>
    </li>
  );
}

// The tabs at the top of every Teams page: one per level and gender the organization has teams for (with how many), then
// Register (league programs) when it registers teams into a league. `href(key)` is that tab's link.
export const TEAM_GROUPS = [
  { key: "rec-boys", label: "REC – Boys", level: "REC", gender: "Boys" },
  { key: "rec-girls", label: "REC – Girls", level: "REC", gender: "Girls" },
  { key: "comp-boys", label: "COMP – Boys", level: "COMP", gender: "Boys" },
  { key: "comp-girls", label: "COMP – Girls", level: "COMP", gender: "Girls" },
] as const;

export function teamTabs<T extends { level: string; gender: string }>(teams: T[], view: unknown, register: boolean) {
  const groups = TEAM_GROUPS.map((g) => ({ ...g, teams: teams.filter((t) => t.level === g.level && t.gender === g.gender) })).filter(
    (g) => g.teams.length,
  );
  const keys = [...groups.map((g) => g.key as string), ...(register ? ["register"] : [])];
  const current = typeof view === "string" && keys.includes(view) ? view : (keys[0] ?? "");
  return { groups, current, group: groups.find((g) => g.key === current) ?? null };
}

export function TeamsTabs({
  base,
  current,
  groups,
  register,
}: {
  base: string; // the Teams page's path
  current: string;
  groups: { key: string; label: string; teams: unknown[] }[];
  register: boolean;
}) {
  const tabs = [
    ...groups.map((g) => ({ key: g.key, label: `${g.label} (${g.teams.length})` })),
    ...(register ? [{ key: "register", label: "Register" }] : []),
  ];
  if (!tabs.length) return null;
  return (
    <nav aria-label="Teams" className="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}?view=${t.key}`}
          aria-current={current === t.key ? "page" : undefined}
          className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap ${
            current === t.key
              ? "border-thunder-orange text-zinc-900 dark:text-white"
              : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
