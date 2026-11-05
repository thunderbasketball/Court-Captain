"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GRADES, LEVELS, PREK, gradeSort, teamName, type Gender } from "@/lib/team-names";
import { Alert, PopUp } from "./client-ui";
import { fieldLabel, inputCls, pillCls, primaryBtn } from "./ui";

type Person = { value: string; firstName: string; lastName: string; detail?: string };
type Input = { gender: string; grades: string[]; level: string; headCoach: unknown; altName: string; club?: unknown };
type Club = { value: string; label: string; abbr: string };
type Create = (input: Input) => Promise<{ ok: true; id: string; name: string } | { ok: false; message: string }>;

// "+ Add" on every organization's Teams page (Thunder's too): a pop-up like Thunder's New team page. The name is made
// for you: top grade + gender + Head Coach's last name ("4G Epps"; "4G TBD" until a coach). Grades: one, or two next to
// each other. `create` is the server's (it checks everything again); `href` + id opens the new team (none: stay here).
// `clubs` (Scenic City): pick which outside club the team is for, or type a new one; its Abbreviation leads the name.
// `preK` (teams for Scenic City Leagues, not Thunder's): Pre-K is offered too, always Coed and REC ("PKC Lee").
export default function AddTeamButton({
  people,
  create,
  href,
  clubs,
  preK = false,
}: {
  people: Person[];
  create: Create;
  href?: string;
  clubs?: Club[];
  preK?: boolean;
}) {
  const router = useRouter();
  return (
    <PopUp
      label="+ Add"
      title="Add a team"
      className="shrink-0 rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thunder-blue-dark"
    >
      {(close) => (
        <AddTeamForm
          people={people}
          clubs={clubs}
          preK={preK}
          create={create}
          onAdded={(id) => {
            if (href) return router.push(`${href}${id}`);
            close();
            router.refresh();
          }}
        />
      )}
    </PopUp>
  );
}

const NEW = "new";

function AddTeamForm({
  people,
  clubs,
  preK,
  create,
  onAdded,
}: {
  people: Person[];
  clubs?: Club[];
  preK: boolean;
  create: Create;
  onAdded: (id: string) => void;
}) {
  const [club, setClub] = useState("");
  const [newClub, setNewClub] = useState({ name: "", abbr: "" });
  const [gender, setGender] = useState<Gender | "">("");
  const [grades, setGrades] = useState<string[]>([]);
  const [level, setLevel] = useState<string>("REC");
  const [coach, setCoach] = useState("");
  const [person, setPerson] = useState({ first: "", last: "", cell: "" });
  const [alt, setAlt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // One grade, or two next to each other: tapping a grade that doesn't fit starts over from it.
  const tapGrade = (g: string) => {
    // Pre-K is on its own, Coed and REC; leaving Pre-K leaves Coed too.
    if (g === PREK) {
      setGrades(grades.includes(PREK) ? [] : [PREK]);
      setGender("Coed");
      setLevel("REC");
      return;
    }
    if (gender === "Coed") setGender("");
    setGrades((cur) => {
      if (cur.includes(PREK)) return [g];
      if (cur.includes(g)) return cur.filter((x) => x !== g);
      if (cur.length === 1 && Math.abs(gradeSort(cur[0]) - gradeSort(g)) === 1) return [...cur, g];
      return [g];
    });
  };
  const pickGender = (g: Gender) => {
    setGender(g);
    if (g === "Coed") {
      setGrades([PREK]);
      setLevel("REC");
    } else if (grades.includes(PREK)) setGrades([]);
  };
  const last =
    coach === NEW ? person.last.trim() : coach === "none" ? "TBD" : (people.find((p) => p.value === coach)?.lastName ?? "");
  const abbr = !clubs
    ? ""
    : club === NEW
      ? newClub.abbr.trim().toUpperCase() || "…"
      : (clubs.find((c) => c.value === club)?.abbr ?? "");
  const preview = gender && grades.length && last ? `${abbr ? `${abbr} ` : ""}${teamName(gender, grades, last)}` : "—";
  const clubReady = !clubs || (club && (club !== NEW || newClub.name.trim()));
  const ready = clubReady && gender && grades.length && coach && (coach !== NEW || (person.first && person.last && person.cell));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await create({
            gender,
            grades,
            level,
            headCoach: coach === NEW ? person : coach,
            altName: alt,
            ...(clubs ? { club: club === NEW ? newClub : club } : {}),
          });
          if (!r.ok) return setError(r.message);
          onAdded(r.id);
        });
      }}
    >
      {clubs && (
        <div className="space-y-2">
          <label className="block">
            <span className={fieldLabel}>Organization (an outside club)</span>
            <select className={inputCls} value={club} onChange={(e) => setClub(e.target.value)}>
              <option value="" disabled>
                Choose…
              </option>
              <option value={NEW}>New club…</option>
              {clubs.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label} ({c.abbr})
                </option>
              ))}
            </select>
          </label>
          {club === NEW && (
            <div className="grid grid-cols-3 gap-2">
              <input
                className={`${inputCls} col-span-2`}
                maxLength={60}
                placeholder="Club name"
                value={newClub.name}
                onChange={(e) => setNewClub({ ...newClub, name: e.target.value })}
              />
              <input
                className={inputCls}
                maxLength={6}
                placeholder="Abbr. (HH)"
                value={newClub.abbr}
                onChange={(e) => setNewClub({ ...newClub, abbr: e.target.value })}
              />
            </div>
          )}
        </div>
      )}
      <div>
        <span className={fieldLabel}>Gender</span>
        <div className="flex gap-2">
          {(preK ? (["Boys", "Girls", "Coed"] as const) : (["Boys", "Girls"] as const)).map((g) => (
            <button key={g} type="button" className={pillCls(gender === g)} onClick={() => pickGender(g)}>
              {g === "Coed" ? "Coed (Pre-K)" : g}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={fieldLabel}>Grade (one, or two next to each other)</span>
        <div className="grid grid-cols-7 gap-1.5">
          {(preK ? [PREK, ...GRADES] : GRADES).map((g) => (
            <button
              key={g}
              type="button"
              className={`${pillCls(grades.includes(g))} ${g === PREK ? "col-span-2" : ""}`}
              onClick={() => tapGrade(g)}
            >
              {g === PREK ? "Pre-K" : g}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={fieldLabel}>Level</span>
        <div className="flex gap-2">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              disabled={grades.includes(PREK) && l !== "REC"}
              className={`${pillCls(level === l)} disabled:opacity-40`}
              onClick={() => setLevel(l)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className={fieldLabel}>Head coach</span>
        <select className={inputCls} value={coach} onChange={(e) => setCoach(e.target.value)}>
          <option value="" disabled>
            Choose…
          </option>
          <option value="none">No coach yet (named TBD until one is added)</option>
          <option value={NEW}>New person…</option>
          {people.map((p) => (
            <option key={p.value} value={p.value}>
              {p.lastName}, {p.firstName}
              {p.detail ? ` · ${p.detail}` : ""}
            </option>
          ))}
        </select>
      </label>
      {coach === NEW && (
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputCls}
            placeholder="First name"
            value={person.first}
            onChange={(e) => setPerson({ ...person, first: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder="Last name"
            value={person.last}
            onChange={(e) => setPerson({ ...person, last: e.target.value })}
          />
          <input
            className={`${inputCls} col-span-2`}
            type="tel"
            inputMode="tel"
            placeholder="Cell (423) 555-0123"
            value={person.cell}
            onChange={(e) => setPerson({ ...person, cell: e.target.value })}
          />
        </div>
      )}
      <label className="block">
        <span className={fieldLabel}>Alternate name (optional)</span>
        <input
          className={inputCls}
          maxLength={60}
          placeholder="e.g. Bolts"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
        />
      </label>
      <div className="rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
        <p className="text-xs text-zinc-500">Team name</p>
        <p className="text-lg font-semibold">
          {preview}
          {alt.trim() && <span className="text-sm font-normal text-zinc-500"> · {alt.trim()}</span>}
        </p>
        <p className="text-xs text-zinc-500">If another team has this name, both get a number (1, 2).</p>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy || !ready} className={`${primaryBtn} w-full`}>
        {busy ? "Adding…" : "Add team"}
      </button>
    </form>
  );
}
