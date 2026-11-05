// Shared building blocks so every page looks the same.
import type { ReactNode } from "react";
import Link from "next/link";

export const fieldLabel = "mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300";
export const inputCls =
  "w-full rounded-xl border-0 bg-white px-3 py-3 text-base shadow-sm ring-1 ring-inset ring-zinc-950/10 outline-none focus:ring-2 focus:ring-thunder-blue dark:bg-zinc-900 dark:ring-white/15";
export const primaryBtn =
  "w-full rounded-xl bg-thunder-blue px-4 py-3 text-lg font-semibold text-white shadow-sm hover:bg-thunder-blue-dark disabled:opacity-40";
// A toggle pill (gender, grade, level choices).
export const pillCls = (on: boolean) =>
  `rounded-full px-4 py-2 text-sm font-medium transition-colors ${
    on
      ? "bg-thunder-blue text-white shadow-sm"
      : "bg-zinc-100 text-zinc-600 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-300"
  }`;

export const card = "rounded-2xl bg-white shadow-sm ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10";

type Tone = "blue" | "orange" | "green" | "amber" | "red" | "pink" | "zinc";
const tones: Record<Tone, string> = {
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-400/30",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/25 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-400/30",
  green:
    "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30",
  red: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30",
  pink: "bg-pink-50 text-pink-700 ring-pink-600/20 dark:bg-pink-500/10 dark:text-pink-300 dark:ring-pink-400/30",
  zinc: "bg-zinc-100 text-zinc-700 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-white/10",
};

export function Chip({ tone = "zinc", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Avatar({ first, last, tone = "zinc" }: { first?: string | null; last?: string | null; tone?: Tone }) {
  const initials = `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || "?";
  return (
    <span
      className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1 ring-inset ${tones[tone]}`}
    >
      {initials}
    </span>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
    </div>
  );
}

export function Stats({ items }: { items: { label: string; value: number; tone?: string }[] }) {
  return (
    <div className="mb-5 grid grid-cols-3 gap-3">
      {items.map((s) => (
        <div key={s.label} className={`${card} px-4 py-3`}>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{s.label}</p>
          <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${s.tone ?? ""}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "green" | "red"; children: ReactNode }) {
  return <p className={`mb-5 rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${tones[tone]}`}>{children}</p>;
}

// A collapsible card with a title, a count, and a list inside.
export function GroupCard({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: ReactNode;
  count: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className={`${card} group overflow-hidden`} open={defaultOpen}>
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-3">
        <span className="font-semibold">{title}</span>
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {count}
          </span>
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
            className="size-5 text-zinc-400 transition-transform group-open:rotate-180"
          >
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </summary>
      <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">{children}</ul>
    </details>
  );
}

// One person in a list: initials circle, name, chips on the right, detail lines below.
export function PersonRow({
  first,
  last,
  avatarTone,
  chips,
  dim,
  under,
  href,
  children,
}: {
  first?: string | null;
  last?: string | null;
  avatarTone?: Tone;
  chips?: ReactNode;
  dim?: boolean;
  under?: ReactNode; // shown just under the initials circle (e.g. the 👁 View-as button)
  href?: string; // tapping the initials opens this (e.g. the person's dashboard, for Admins)
  children?: ReactNode;
}) {
  const avatar = href ? (
    <Link href={href} aria-label={`${first ?? ""} ${last ?? ""}: dashboard`} className="shrink-0 rounded-full hover:opacity-80">
      <Avatar first={first} last={last} tone={avatarTone} />
    </Link>
  ) : (
    <Avatar first={first} last={last} tone={avatarTone} />
  );
  return (
    <li className={`flex gap-3 px-4 py-3 ${dim ? "opacity-50" : ""}`}>
      {under ? (
        <div className="flex shrink-0 flex-col items-center gap-2">
          {avatar}
          {under}
        </div>
      ) : (
        avatar
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate">
            {first} <span className="font-semibold">{last}</span>
          </p>
          {chips && <div className="flex flex-wrap justify-end gap-1">{chips}</div>}
        </div>
        <div className="mt-0.5 space-y-0.5 text-sm text-zinc-500 dark:text-zinc-400">{children}</div>
      </div>
    </li>
  );
}

const linkCls = "text-blue-600 hover:underline dark:text-blue-400";

export function PhoneLink({ cell, label }: { cell: string; label: string }) {
  return (
    <a href={`tel:${cell}`} className={`${linkCls} whitespace-nowrap`}>
      {label}
    </a>
  );
}

export function EmailLink({ email }: { email: string }) {
  return (
    <a href={`mailto:${email}`} className={`${linkCls} break-all`}>
      {email}
    </a>
  );
}

// Simulated (DEV) teams (Scheduler's Simulation mode, development only) are highlighted purple wherever their name shows.
export const isDevTeam = (name: string | null | undefined) => !!name?.endsWith("(DEV)");
export const devTeamCls = "rounded bg-violet-200 px-1 text-violet-900 dark:bg-violet-500/30 dark:text-violet-100";
export function TeamName({ name, className = "" }: { name: string; className?: string }) {
  return isDevTeam(name) ? (
    <span className={`${devTeamCls} ${className}`}>{name}</span>
  ) : (
    <span className={className}>{name}</span>
  );
}

// Scheduler: REC or COMP, so a game's level is clear at a glance (COMP solid, REC outlined).
export function LevelTag({ level, className = "" }: { level: string; className?: string }) {
  return (
    <span
      className={`inline-block rounded px-1 text-[10px] leading-4 font-bold tracking-wide ${
        level === "COMP"
          ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
          : "text-zinc-700 ring-1 ring-zinc-400 ring-inset dark:text-zinc-200 dark:ring-zinc-500"
      } ${className}`}
    >
      {level}
    </span>
  );
}

// Scheduler: a coach with more than one team playing that day. Each such coach gets their own color (and initials, in
// case two share a color); `title` names the coach and their other teams.
export type CoachTag = { color: number; initials: string; title: string };
const COACH_COLORS = [
  "bg-orange-500 text-white",
  "bg-teal-600 text-white",
  "bg-indigo-600 text-white",
  "bg-lime-500 text-zinc-900",
  "bg-fuchsia-600 text-white",
  "bg-cyan-500 text-zinc-900",
  "bg-rose-600 text-white",
  "bg-yellow-400 text-zinc-900",
  "bg-blue-800 text-white",
  "bg-green-700 text-white",
  "bg-stone-600 text-white",
  "bg-amber-800 text-white",
];
export function CoachBadge({ tag }: { tag: CoachTag | undefined }) {
  if (!tag) return null;
  return (
    <span
      title={tag.title}
      aria-label={tag.title}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1 align-middle text-[9px] leading-4 font-bold ${COACH_COLORS[tag.color % COACH_COLORS.length]}`}
    >
      <svg viewBox="0 0 16 16" className="size-2.5" fill="currentColor" aria-hidden="true">
        <circle cx="5.5" cy="5" r="2.5" />
        <circle cx="11" cy="5.5" r="2" />
        <path d="M1 13.5c0-2.5 2-4.5 4.5-4.5S10 11 10 13.5V14H1zM10.8 14v-.5c0-1.3-.4-2.5-1.1-3.4.4-.2.8-.3 1.3-.3 2.2 0 4 1.8 4 4v.2z" />
      </svg>
      {tag.initials}
    </span>
  );
}
