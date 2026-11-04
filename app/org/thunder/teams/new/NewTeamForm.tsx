"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GRADES, LEVELS, teamName } from "@/lib/team-names";
import type { PersonOption } from "@/lib/teams";
import { createTeam } from "../actions";
import { card, fieldLabel as label, inputCls, pillCls as pill, primaryBtn } from "../../../../ui";

export default function NewTeamForm({ users, volunteers }: { users: PersonOption[]; volunteers: PersonOption[] }) {
  const router = useRouter();
  const [gender, setGender] = useState<"Boys" | "Girls" | null>(null);
  const [grades, setGrades] = useState<string[]>([]);
  const [level, setLevel] = useState<string>("REC");
  const [headCoach, setHeadCoach] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const toggleGrade = (g: string) => setGrades((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
  const matches = (v: PersonOption) => v.gender === gender && grades.includes(v.grade ?? "");
  const forThisTeam = volunteers.filter(matches);
  const otherVolunteers = volunteers.filter((v) => !matches(v));
  const picked = [...users, ...volunteers].find((o) => o.value === headCoach);
  const preview = gender && grades.length && picked ? teamName(gender, grades, picked.lastName) : null;

  const option = (o: PersonOption) => (
    <option key={o.value} value={o.value}>
      {o.lastName}, {o.firstName} — {o.detail}
    </option>
  );

  return (
    <form
      className={`${card} space-y-6 p-5`}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await createTeam({ gender, grades, level, headCoach });
          if (r.ok) router.push("/org/thunder/teams");
          else setError(r.message);
        });
      }}
    >
      <div>
        <span className={label}>Gender</span>
        <div className="flex gap-2">
          {(["Boys", "Girls"] as const).map((g) => (
            <button key={g} type="button" className={pill(gender === g)} onClick={() => setGender(g)}>
              {g}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className={label}>Grades (one or more)</span>
        <div className="grid grid-cols-7 gap-2">
          {GRADES.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={grades.includes(g)}
              className={`${pill(grades.includes(g))} px-0`}
              onClick={() => toggleGrade(g)}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className={label}>Level</span>
        <div className="flex gap-2">
          {LEVELS.map((l) => (
            <button key={l} type="button" className={pill(level === l)} onClick={() => setLevel(l)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className={label}>Head coach</span>
        <select value={headCoach} onChange={(e) => setHeadCoach(e.target.value)} className={inputCls}>
          <option value="">Choose…</option>
          {forThisTeam.length > 0 && <optgroup label="Volunteers for this team">{forThisTeam.map(option)}</optgroup>}
          {otherVolunteers.length > 0 && <optgroup label="Other volunteers">{otherVolunteers.map(option)}</optgroup>}
          {users.length > 0 && <optgroup label="App users">{users.map(option)}</optgroup>}
        </select>
        {picked?.value.startsWith("volunteer:") && (
          <span className="mt-2 block text-sm text-zinc-500">
            {picked.firstName} will get an app login (starter PIN 1234) using their registration cell and email.
          </span>
        )}
      </label>

      <div className="rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
        <p className="text-xs font-medium text-zinc-500">Team name</p>
        <p className="text-lg font-semibold">{preview ?? "—"}</p>
        <p className="text-xs text-zinc-500">If another team has this name, both get a number (1, 2).</p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-500/10 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <button type="submit" disabled={busy || !preview} className={primaryBtn}>
        {busy ? "Creating…" : "Create team"}
      </button>
    </form>
  );
}
