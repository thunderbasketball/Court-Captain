import Link from "next/link";
import type { ReactNode } from "react";
import { Chip, GroupCard } from "./ui";
import TeamRowMore, { type CardToggle } from "./TeamRowMore";
import ChatPanel from "./ChatPanel";
import { BellIcon, NotifyPanel } from "./NotifyButton";
import type { AudienceInput } from "@/lib/announcements";

// What a team still needs, flashing red until it's done.
export function MustBeEntered({ what }: { what: "COACH INFO" | "COACH CELL" | "COACH EMAIL" | "ROSTER" }) {
  return <span className="block animate-pulse text-sm font-semibold text-red-600 dark:text-red-400">{what} MUST BE ENTERED</span>;
}

// One team on a Teams page, the same for Thunder and every organization. One line: its grade/gender badge, name (and
// Alternate name; both open the team page), its buttons (`lead`: Text coaches; `roster`: the 👥 count, which opens the roster on the card; `actions`: chat,
// notify) and the
// chevron. Opened: level, grades (when more than one) and practice places (`sub`), its staff (`people`) and what it
// still needs, flashing red: a Head Coach (COACH INFO MUST BE ENTERED), their cell when named without one (COACH CELL),
// their email (COACH EMAIL) and players (ROSTER MUST BE ENTERED).
export default function TeamRow({
  href,
  name,
  altName,
  gender,
  level,
  sub,
  hasCoach,
  waitingCoach,
  needsEmail,
  players,
  people,
  lead,
  roster,
  schedule,
  chat,
  notify,
  actions,
  issue,
}: {
  issue?: string | null; // a roster problem ("1 Too old"): the name turns red with a badge saying it
  href: string;
  name: string;
  altName: string | null;
  gender: "Boys" | "Girls" | "Coed";
  level: string;
  sub: string; // e.g. "4th–5th Grade · Action Church" ("" for one grade and no places)
  hasCoach: boolean;
  waitingCoach?: string | null; // a Head Coach named without a cell yet ("Alex Campbell")
  needsEmail?: boolean; // the Head Coach (or the one waiting) has no email
  players: number;
  people?: ReactNode;
  lead?: ReactNode; // first button (Text coaches)
  roster?: { count: number; list: ReactNode }; // the 👥 count; tapping it opens `list` on the card
  schedule?: { items: number; list: ReactNode }; // 📅 by it: published League games and upcoming practices, on the card
  chat?: { chatKey: string; label: string }; // its staff chat, opened on the card
  notify?: AudienceInput; // 🔔 an announcement to the team, written on the card
  actions?: ReactNode; // after the toggles
}) {
  const ring = "inline-flex size-7 shrink-0 items-center justify-center rounded-full ring-1";
  const toggles: CardToggle[] = [
    ...(roster
      ? [
          {
            key: "roster",
            label: `${name} roster, ${roster.count} ${roster.count === 1 ? "player" : "players"}`,
            icon: <span className="text-xs font-semibold tabular-nums">👥 {roster.count}</span>,
            className: `${ring} h-7 w-auto px-2.5 text-zinc-600 ring-zinc-950/15 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-white/20 dark:hover:bg-white/10`,
            panel: roster.list,
          },
        ]
      : []),
    ...(schedule
      ? [
          {
            key: "schedule",
            label: schedule.items ? "Schedule" : "Schedule: no games published or practices booked yet",
            icon: <CalendarIcon />,
            className: `${ring} ring-zinc-950/15 hover:bg-zinc-100 dark:ring-white/20 dark:hover:bg-white/10 ${
              schedule.items ? "text-thunder-blue dark:text-blue-400" : "text-zinc-300 dark:text-zinc-600"
            }`,
            panel: schedule.list,
          },
        ]
      : []),
    ...(chat
      ? [
          {
            key: "chat",
            label: chat.label,
            icon: <ChatIcon />,
            className: `${ring} text-thunder-blue ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10`,
            panel: <ChatPanel chatKey={chat.chatKey} />,
          },
        ]
      : []),
    ...(notify
      ? [
          {
            key: "notify",
            label: `Notify ${name}`,
            icon: <BellIcon className="size-4" />,
            className: `${ring} text-thunder-orange ring-thunder-orange/40 hover:bg-orange-50 dark:hover:bg-orange-500/10`,
            panel: <NotifyPanel audience={notify} to={name} />,
          },
        ]
      : []),
  ];
  return (
    <li className="px-4 py-2.5">
      <TeamRowMore
        head={
          <>
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white ${
                gender === "Boys" ? "bg-thunder-blue" : gender === "Coed" ? "bg-emerald-600" : "bg-pink-600"
              }`}
            >
              {name.split(" ")[0]}
            </span>
            <span className={`truncate font-semibold ${issue ? "text-red-600 dark:text-red-400" : ""}`}>
              {name}
              {altName && <span className="font-normal text-zinc-500"> · {altName}</span>}
            </span>
            {issue && <Chip tone="red">{issue}</Chip>}
          </>
        }
        lead={lead}
        toggles={toggles}
        actions={
          <>
            {actions}
            {/* The team page, last before the chevron. */}
            <Link
              href={href}
              aria-label={`${name}: team page`}
              title="Team page"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-600 ring-1 ring-zinc-950/15 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-white/20 dark:hover:bg-white/10"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className="size-4">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
            </Link>
          </>
        }
        more={
          <>
            {/* One line: the level, then its staff (grades and places, when shown, after the level). */}
            <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
              <Chip tone={level === "COMP" ? "orange" : "zinc"}>{level}</Chip>
              {sub && <span className="mr-1 text-sm text-zinc-500 dark:text-zinc-400">{sub}</span>}
              {people}
            </div>
            {waitingCoach && (
              <span className="text-sm text-zinc-600 dark:text-zinc-300">
                Head Coach {waitingCoach} <span className="text-zinc-400">· no cell yet</span>
              </span>
            )}
            {!hasCoach && !waitingCoach && <MustBeEntered what="COACH INFO" />}
            {waitingCoach && <MustBeEntered what="COACH CELL" />}
            {(waitingCoach || needsEmail) && <MustBeEntered what="COACH EMAIL" />}
            {!players && <MustBeEntered what="ROSTER" />}
          </>
        }
      />
    </li>
  );
}

// A Teams page tab's teams grouped by grade (each team under its top grade, the one on its badge), youngest first as
// listed, one card per grade with how many, each collapsed (tap to open).
// A grade card's title: red, with a ⚠ badge of how many of its teams have a problem.
function gradeTitle(label: string, bad: number) {
  if (!bad) return label;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-red-600 dark:text-red-400">{label}</span>
      <Chip tone="red">
        ⚠ {bad} {bad === 1 ? "team" : "teams"}
      </Chip>
    </span>
  );
}

export function GradeGroups<T>({
  teams,
  grade,
  row,
  warn,
}: {
  teams: T[];
  grade: (t: T) => string; // e.g. "1st Grade"
  row: (t: T) => ReactNode;
  warn?: (t: T) => boolean; // a team with a problem (a player not eligible): its grade's title turns red with ⚠ N teams
}) {
  const groups: { label: string; teams: T[] }[] = [];
  for (const t of teams) {
    const label = grade(t);
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, teams: [] }));
    g.teams.push(t);
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <GroupCard key={g.label} title={gradeTitle(g.label, warn ? g.teams.filter(warn).length : 0)} count={g.teams.length} defaultOpen={false}>
          {g.teams.map(row)}
        </GroupCard>
      ))}
    </div>
  );
}

// The tabs at the top of every Teams page: one per level and gender the organization has teams for (with how many), then
// Register (league programs) when it registers teams into a league. `href(key)` is that tab's link.
export const TEAM_GROUPS = [
  { key: "rec-boys", label: "REC – Boys", level: "REC", gender: "Boys" },
  { key: "rec-girls", label: "REC – Girls", level: "REC", gender: "Girls" },
  { key: "comp-boys", label: "COMP – Boys", level: "COMP", gender: "Boys" },
  { key: "comp-girls", label: "COMP – Girls", level: "COMP", gender: "Girls" },
  { key: "prek-coed", label: "Pre-K – Coed", level: "REC", gender: "Coed" }, // Scenic City Leagues' Pre-K teams
] as const;

export function teamTabs<T extends { level: string; gender: string }>(teams: T[], view: unknown, register: boolean) {
  const groups = TEAM_GROUPS.map((g) => ({
    ...g,
    teams: teams.filter((t) => t.level === g.level && t.gender === g.gender),
  })).filter((g) => g.teams.length);
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

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className="size-4">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
      />
    </svg>
  );
}

export function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className="size-4">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
      />
    </svg>
  );
}
