"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "../../../../client-ui";
import { addPlayerToLeagueTeam, removeLeagueTeamStaff, removePlayerFromLeagueTeam, saveLeagueTeamStaff } from "./actions";

const field =
  "w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-white/15 dark:bg-zinc-900";
const primary = "rounded-full bg-thunder-blue px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50";
const quiet = "rounded-full px-3 py-1 text-xs font-medium text-red-600 ring-1 ring-red-600/30 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10";

// A League team's roster: + Add player right in the card (first and last name, grade, jersey, birthdate). Checked on the
// server (its coach or Scenic City's Directors of Teams).
export function AddLeaguePlayer({ teamId }: { teamId: string }) {
  const router = useRouter();
  const blank = { first: "", last: "", grade: "", jersey: "", birthdate: "" };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  if (!open)
    return (
      <div className="px-4 pb-2">
        <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-thunder-blue dark:text-blue-400">
          + Add player
        </button>
        {msg && <Toast key={msg} message={msg} />}
      </div>
    );
  return (
    <form
      className="mx-4 mb-3 space-y-2 rounded-xl bg-zinc-50 p-3 dark:bg-white/5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await addPlayerToLeagueTeam(teamId, f);
          if (!r.ok) return setError(r.message);
          setMsg(`Added ${f.first} ${f.last}.`);
          setF(blank); // ready for the next one
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <input className={field} placeholder="First name" autoComplete="off" value={f.first} onChange={set("first")} />
        <input className={field} placeholder="Last name" autoComplete="off" value={f.last} onChange={set("last")} />
        <input className={field} placeholder="Grade (K–12)" value={f.grade} onChange={set("grade")} />
        <input className={field} placeholder="Jersey #" inputMode="numeric" maxLength={2} value={f.jersey} onChange={set("jersey")} />
        <input className={`${field} col-span-2`} placeholder="Birthdate (5/3/2014)" value={f.birthdate} onChange={set("birthdate")} />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className={primary}>
          {busy ? "Adding…" : "Add player"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-zinc-500">
          Done
        </button>
      </div>
      {msg && <Toast key={msg} message={msg} />}
    </form>
  );
}

export function RemoveLeaguePlayer({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!sure) return setSure(true);
          start(async () => {
            const r = await removePlayerFromLeagueTeam(id);
            if (!r.ok) return setError(r.message);
            router.refresh();
          });
        }}
        className={quiet}
      >
        {busy ? "Removing…" : sure ? `Yes, remove ${name}` : "Remove"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

const ROLES = [
  { key: "AsstCoach", label: "Assistant Coach" },
  { key: "Manager", label: "Manager" },
  { key: "TeamParent", label: "Team Parent" },
];

// A League team's other staff: + Add staff right in the Staff card (one per role; adding one again replaces it).
export function AddLeagueStaff({ teamId }: { teamId: string }) {
  const router = useRouter();
  const blank = { role: "AsstCoach", first: "", last: "", cell: "", email: "" };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  if (!open)
    return (
      <div className="px-4 pb-2">
        <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-thunder-blue dark:text-blue-400">
          + Add staff
        </button>
        {msg && <Toast key={msg} message={msg} />}
      </div>
    );
  return (
    <form
      className="mx-4 mb-3 space-y-2 rounded-xl bg-zinc-50 p-3 dark:bg-white/5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await saveLeagueTeamStaff(teamId, f);
          if (!r.ok) return setError(r.message);
          setMsg(`Added ${f.first} ${f.last}.`);
          setF(blank);
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <select className={field} value={f.role} onChange={set("role")} aria-label="Role">
        {ROLES.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input className={field} placeholder="First name" autoComplete="off" value={f.first} onChange={set("first")} />
        <input className={field} placeholder="Last name" autoComplete="off" value={f.last} onChange={set("last")} />
        <input className={field} placeholder="Cell" type="tel" inputMode="tel" value={f.cell} onChange={set("cell")} />
        <input className={field} placeholder="Email (optional)" type="email" value={f.email} onChange={set("email")} />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className={primary}>
          {busy ? "Saving…" : "Add staff"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-zinc-500">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function RemoveLeagueStaff({ teamId, role, name }: { teamId: string; role: string; name: string }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!sure) return setSure(true);
          start(async () => {
            const r = await removeLeagueTeamStaff(teamId, role);
            if (!r.ok) return setError(r.message);
            router.refresh();
          });
        }}
        className={quiet}
      >
        {busy ? "Removing…" : sure ? `Yes, remove ${name}` : "Remove"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
