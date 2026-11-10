"use client";

import { useState, type ReactNode } from "react";
import type { Contact } from "@/lib/teams";
import { MAX_GROUP_TEXT } from "@/lib/group-text";
import { ChatToggle } from "./InlineToggle";
import { PopUp } from "./client-ui";

type Role = Contact["role"];

export const ROLE_BADGE: Record<Role, { short: string; label: string; cls: string }> = {
  HeadCoach: { short: "HC", label: "Head Coach", cls: "bg-thunder-blue" },
  AsstCoach: { short: "AC", label: "Assistant Coach", cls: "bg-emerald-600" },
  Manager: { short: "TM", label: "Team Manager", cls: "bg-violet-600" },
  TeamParent: { short: "TP", label: "Team Parent", cls: "bg-thunder-orange" },
};

const pretty = (cell: string) => `(${cell.slice(0, 3)}) ${cell.slice(3, 6)}-${cell.slice(6)}`;

export function RoleDot({ role }: { role: Role }) {
  const b = ROLE_BADGE[role];
  return (
    <span
      title={b.label}
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${b.cls}`}
    >
      {b.short}
    </span>
  );
}

type Person = Pick<Contact, "role" | "email"> & { first: string | null; last: string | null; cell: string | null };

// A role circle and the person's name; tapping the name opens their details right there, on a line of their own (no
// pop-up): cell, email, and Chat / Call / Text / Email. `about` is the line under their name (team, or the player they
// registered). `chatKey`: an in-app chat with this person (coaches with a login). `extra`: more buttons beside the
// actions (e.g. 👁 View as, for Admins).
export function ContactChip({
  person,
  about,
  chatKey,
  extra,
}: {
  person: Person;
  about: string;
  chatKey?: string;
  extra?: ReactNode;
}) {
  const cell = person.cell && /^\d{10}$/.test(person.cell) ? person.cell : null;
  const name = [person.first, person.last].filter(Boolean).join(" ") || "No name";
  const [open, setOpen] = useState(false);
  const action =
    "inline-flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-thunder-blue hover:bg-zinc-200 dark:bg-zinc-800 dark:text-blue-400";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/5 ${
          open ? "bg-zinc-100 dark:bg-white/5" : ""
        }`}
      >
        <RoleDot role={person.role} />
        <span className="underline decoration-zinc-300 underline-offset-2">{name}</span>
      </button>
      {open && (
        <div className="basis-full space-y-2 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm dark:bg-white/5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold">
                {name} <span className="font-normal text-zinc-500">· {ROLE_BADGE[person.role].label} · {about}</span>
              </p>
              {cell ? <p>{pretty(cell)}</p> : <p className="text-zinc-400">No cell on file</p>}
              {person.email ? <p className="break-all">{person.email}</p> : <p className="text-zinc-400">No email on file</p>}
            </div>
            {extra}
          </div>
          <div className="flex flex-wrap gap-2">
            {chatKey && (
              <ChatToggle chatKey={chatKey} label={`Chat with ${name}`} className={action}>
                💬 Chat
              </ChatToggle>
            )}
            {cell && (
              <>
                <a href={`tel:+1${cell}`} className={action}>
                  📞 Call
                </a>
                <a href={`sms:+1${cell}`} className={action}>
                  📱 Text
                </a>
              </>
            )}
            {person.email && (
              <a href={`mailto:${encodeURIComponent(person.email)}`} className={action}>
                ✉️ Email
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Open the phone's Messages app with these numbers in one group text.
function openGroupText(to: string[]) {
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  window.location.href = apple ? `sms://open?addresses=${to.join(",")}` : `sms:${to.join(",")}`;
}

// Opens the phone's Messages app with everyone in one group text. iPhones/Macs and Android phones expect different link
// formats. More than 19 numbers: split into texts of 19 at most, one button each ("Text parents 1–19", "20–24").
// `small`: the compact button on a Teams page card.
// A group text, opened from a page's 📣 menu: says it opens the phone's Messages app, then the button(s).
export function TextPanel({ cells, label }: { cells: (string | null)[]; label: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-500">Opens your phone&apos;s Messages app with everyone in one group text (nothing is sent by the app).</p>
      <GroupTextButton cells={cells} label={label} />
    </div>
  );
}

export function GroupTextButton({ cells, label, small }: { cells: (string | null)[]; label: string; small?: boolean }) {
  const numbers = [...new Set(cells.filter((c): c is string => !!c && /^\d{10}$/.test(c)))].map((c) => `+1${c}`);
  const parts: string[][] = [];
  for (let i = 0; i < numbers.length; i += MAX_GROUP_TEXT) parts.push(numbers.slice(i, i + MAX_GROUP_TEXT));
  const cls = small
    ? "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
    : "shrink-0 rounded-full px-4 py-2 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-500/10";
  if (parts.length <= 1)
    return (
      <button type="button" disabled={!numbers.length} onClick={() => openGroupText(numbers)} className={cls}>
        💬 {label} ({numbers.length})
      </button>
    );
  return (
    <>
      {parts.map((part, i) => {
        const from = i * MAX_GROUP_TEXT + 1;
        return (
          <button key={from} type="button" onClick={() => openGroupText(part)} className={cls}>
            💬 {label} {from}–{from + part.length - 1}
          </button>
        );
      })}
    </>
  );
}

// Text coach group: tick teams (Boys, then Girls; youngest grade first, in the order given) and text their Head Coaches.
export function TextTeamsButton({
  teams,
}: {
  teams: { id: string; name: string; gender: string; level: string; grade: number; headCells: (string | null)[] }[];
}) {
  return (
    <PopUp
      label="💬 Text coach group"
      title="Text coach group"
      className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
    >
      {() => <TeamPicker teams={teams} />}
    </PopUp>
  );
}

// The same picker, opened right on the page (a page's menu) instead of in a pop-up.
export function TextTeamsPanel({
  teams,
}: {
  teams: { id: string; name: string; gender: string; level: string; grade: number; headCells: (string | null)[] }[];
}) {
  return <TeamPicker teams={teams} />;
}

function TeamPicker({
  teams,
}: {
  teams: { id: string; name: string; gender: string; level: string; grade: number; headCells: (string | null)[] }[];
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const genders = ["Boys", "Girls"]
    .map((g) => ({
      gender: g,
      teams: teams.filter((t) => t.gender === g).sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.teams.length);
  const toggle = (ids: string[], on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      for (const id of ids)
        if (on) n.add(id);
        else n.delete(id);
      return n;
    });
  const cells = teams.filter((t) => picked.has(t.id)).flatMap((t) => t.headCells);
  if (!teams.length) return <p className="text-sm text-zinc-500">No teams yet.</p>;
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 px-1 text-sm font-semibold">
        <input
          type="checkbox"
          className="size-4"
          checked={picked.size === teams.length}
          onChange={(e) =>
            toggle(
              teams.map((t) => t.id),
              e.target.checked,
            )
          }
        />
        All teams ({teams.length})
      </label>
      <div className="max-h-[55vh] space-y-3 overflow-y-auto">
        {genders.map((g) => {
          const ids = g.teams.map((t) => t.id);
          const all = ids.every((id) => picked.has(id));
          return (
            <section key={g.gender} className="rounded-xl ring-1 ring-zinc-950/10 dark:ring-white/10">
              <label className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 text-sm font-semibold dark:border-white/5">
                <input type="checkbox" className="size-4" checked={all} onChange={(e) => toggle(ids, e.target.checked)} />
                {g.gender} ({g.teams.length})
              </label>
              <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                {g.teams.map((t) => (
                  <li key={t.id}>
                    <label className="flex items-center gap-2 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={picked.has(t.id)}
                        onChange={(e) => toggle([t.id], e.target.checked)}
                      />
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                      <span className="text-xs text-zinc-500">{t.level}</span>
                      {!t.headCells.some(Boolean) && (
                        <span className="text-xs text-red-600 dark:text-red-400">no Head Coach cell</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <GroupTextButton cells={cells} label="Text Head Coaches" />
    </div>
  );
}
