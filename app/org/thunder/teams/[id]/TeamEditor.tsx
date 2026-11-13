"use client";

import { AddPersonIcon, addIconBtn } from "../../../../CardIcons";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GRADES, LEVELS } from "@/lib/team-names";
import type { PersonOption, Role } from "@/lib/teams";
import { addStaff, deleteTeam, removeStaff, updateTeam } from "../actions";
import { fieldLabel, inputCls, pillCls, primaryBtn } from "../../../../ui";
import { Alert, CloseButton, Toast, dialogCls, useConfirm } from "../../../../client-ui";

const ROLE_CHOICES: { role: Role; label: string }[] = [
  { role: "HeadCoach", label: "Head Coach" },
  { role: "AsstCoach", label: "Assistant Coach" },
  { role: "Manager", label: "Manager" },
  { role: "TeamParent", label: "Team Parent" },
];

export function TeamEditForm({
  teamId,
  initial,
}: {
  teamId: string;
  initial: { gender: "Boys" | "Girls"; grades: string[]; level: string; practiceLocations: string; altName: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [gender, setGender] = useState(initial.gender);
  const [grades, setGrades] = useState(initial.grades);
  const [level, setLevel] = useState(initial.level);
  const [locations, setLocations] = useState(initial.practiceLocations);
  const [alt, setAlt] = useState(initial.altName);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 text-sm font-medium text-thunder-blue hover:underline dark:text-blue-400"
      >
        Edit team details
      </button>
    );

  const toggle = (g: string) => setGrades((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
  return (
    <form
      className="mt-5 space-y-5 border-t border-zinc-100 pt-5 dark:border-white/5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await updateTeam(teamId, { gender, grades, level, practiceLocations: locations, altName: alt });
          if (!r.ok) return setError(r.message);
          if ("name" in r && r.name) router.replace(`/org/thunder/teams/${teamId}`);
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <div>
        <span className={fieldLabel}>Gender</span>
        <div className="flex gap-2">
          {(["Boys", "Girls"] as const).map((g) => (
            <button key={g} type="button" className={pillCls(gender === g)} onClick={() => setGender(g)}>
              {g}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={fieldLabel}>Grades</span>
        <div className="grid grid-cols-7 gap-2">
          {GRADES.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={grades.includes(g)}
              className={`${pillCls(grades.includes(g))} px-0`}
              onClick={() => toggle(g)}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={fieldLabel}>Level</span>
        <div className="flex gap-2">
          {LEVELS.map((l) => (
            <button key={l} type="button" className={pillCls(level === l)} onClick={() => setLevel(l)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className={fieldLabel}>Practice locations (comma separated)</span>
        <input
          className={inputCls}
          value={locations}
          onChange={(e) => setLocations(e.target.value)}
          placeholder="Action Church, East Ridge MS"
        />
      </label>
      <label className="block">
        <span className={fieldLabel}>Alternate name (optional)</span>
        <input
          className={inputCls}
          maxLength={60}
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="e.g. Bolts"
        />
      </label>
      <p className="text-xs text-zinc-500">The team name updates to match the grades, gender and head coach.</p>
      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !grades.length} className={primaryBtn}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl px-4 text-sm font-medium text-zinc-600 ring-1 ring-zinc-950/10 dark:text-zinc-300 dark:ring-white/15"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function RemoveStaffButton({
  teamId,
  coachId,
  role,
  label,
}: {
  teamId: string;
  coachId: string;
  role: Role;
  label: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const roleName = ROLE_CHOICES.find((r) => r.role === role)?.label;
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className="rounded-full px-3 py-1 text-xs font-medium text-red-600 ring-1 ring-red-600/20 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
        onClick={async () => {
          const ok = await confirm({
            title: `Remove ${label}?`,
            message: <p>They&apos;ll no longer be {roleName} on this team. You can add them back later.</p>,
            confirmLabel: "Remove",
          });
          if (!ok) return;
          setError(null);
          start(async () => {
            const r = await removeStaff(teamId, { coachId, role });
            if (!r.ok) setError(r.message);
            router.refresh();
          });
        }}
      >
        {busy ? "Removing…" : "Remove"}
      </button>
      {confirmDialog}
      {error && <Toast key={error} message={error} />}
    </>
  );
}

const NEW = "new";

// Add staff (a person-plus icon) on the Staff card; opens the form in a pop-up.
export function AddStaffButton({
  teamId,
  gender,
  grades,
  canSetHead,
  filledRoles,
  users,
  volunteers,
  parents = [],
}: {
  teamId: string;
  gender: "Boys" | "Girls";
  grades: string[];
  canSetHead: boolean;
  filledRoles: Role[];
  users: PersonOption[];
  volunteers: PersonOption[];
  parents?: PersonOption[]; // parents of the players on this team's roster
}) {
  const router = useRouter();
  // One person per role: open roles only. The Director can also replace the head coach.
  const hasHead = filledRoles.includes("HeadCoach");
  const roles = ROLE_CHOICES.filter((r) => (r.role === "HeadCoach" ? canSetHead : !filledRoles.includes(r.role)));
  const [picked, setRole] = useState<Role | null>(null);
  const role =
    picked && roles.some((r) => r.role === picked) ? picked : (roles.find((r) => r.role !== "HeadCoach") ?? roles[0])?.role;
  const pickList = users.length + volunteers.length + parents.length > 0;
  const [person, setPerson] = useState(pickList ? "" : NEW);
  const [p, setP] = useState({ first: "", last: "", cell: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const [confirm, confirmDialog] = useConfirm();

  const matches = (v: PersonOption) => v.gender === gender && grades.includes(v.grade ?? "");
  const option = (o: PersonOption) => (
    <option key={o.value} value={o.value}>
      {o.lastName}, {o.firstName} — {o.detail}
    </option>
  );
  const ready = person === NEW ? p.first && p.last && p.cell : !!person;

  // Every role filled: no button (the Director can still replace the head coach, so they keep it).
  if (!role) return done ? <Toast key={done} message={done} /> : null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          dialog.current?.showModal();
        }}
        aria-label="Add staff"
        title="Add staff"
        className={addIconBtn}
      >
        <AddPersonIcon />
      </button>
      {done && <Toast key={done} message={done} />}
      {confirmDialog}
      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        <form
          className="space-y-5 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setDone(null);
            if (
              role === "HeadCoach" &&
              hasHead &&
              !(await confirm({
                title: "Replace the head coach?",
                message: <p>The current head coach comes off this team, and the team is renamed after the new one.</p>,
                confirmLabel: "Replace head coach",
                tone: "warning",
              }))
            )
              return;
            start(async () => {
              const r = await addStaff(teamId, { role, person: person === NEW ? p : person });
              if (!r.ok) return setError(r.message);
              if ("who" in r)
                setDone(
                  `${r.who} added as ${ROLE_CHOICES.find((x) => x.role === role)?.label}.${r.newLogin ? " They can now log in with PIN 1234." : ""}`,
                );
              setP({ first: "", last: "", cell: "", email: "" });
              setPerson(pickList ? "" : NEW);
              setRole(null);
              close();
              router.refresh();
            });
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Add staff</h2>
            <CloseButton onClick={close} />
          </div>
          <div>
            <span className={fieldLabel}>Role</span>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <button key={r.role} type="button" className={pillCls(role === r.role)} onClick={() => setRole(r.role)}>
                  {r.label}
                </button>
              ))}
            </div>
            {role === "HeadCoach" && hasHead && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">This replaces the current head coach.</p>
            )}
          </div>

          <label className="block">
            <span className={fieldLabel}>Person</span>
            <select className={inputCls} value={person} onChange={(e) => setPerson(e.target.value)}>
              {pickList && <option value="">Choose…</option>}
              <option value={NEW}>+ New person (not in the app yet)</option>
              {parents.length > 0 && <optgroup label="Parents of players on this team">{parents.map(option)}</optgroup>}
              {volunteers.some(matches) && (
                <optgroup label="Volunteers for this team">{volunteers.filter(matches).map(option)}</optgroup>
              )}
              {volunteers.some((v) => !matches(v)) && (
                <optgroup label="Other volunteers">{volunteers.filter((v) => !matches(v)).map(option)}</optgroup>
              )}
              {users.length > 0 && <optgroup label="App users">{users.map(option)}</optgroup>}
            </select>
          </label>

          {person === NEW && (
            <div className="space-y-3 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-800/50">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={fieldLabel}>First name</span>
                  <input
                    className={inputCls}
                    autoComplete="off"
                    value={p.first}
                    onChange={(e) => setP({ ...p, first: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabel}>Last name</span>
                  <input
                    className={inputCls}
                    autoComplete="off"
                    value={p.last}
                    onChange={(e) => setP({ ...p, last: e.target.value })}
                  />
                </label>
              </div>
              <label className="block">
                <span className={fieldLabel}>Cell</span>
                <input
                  className={inputCls}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="(423) 555-1234"
                  value={p.cell}
                  onChange={(e) => setP({ ...p, cell: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={fieldLabel}>Email (for their login code)</span>
                <input
                  className={inputCls}
                  type="email"
                  autoComplete="off"
                  value={p.email}
                  onChange={(e) => setP({ ...p, email: e.target.value })}
                />
              </label>
              <p className="text-xs text-zinc-500">
                If this cell is already in the app, that person is used. Otherwise they get a login with PIN 1234.
              </p>
            </div>
          )}
          {person.startsWith("volunteer:") && (
            <p className="text-xs text-zinc-500">
              This volunteer will get a login (PIN 1234) from their registration cell and email.
            </p>
          )}

          {error && <Alert tone="red">{error}</Alert>}
          <button type="submit" disabled={busy || !ready} className={primaryBtn}>
            {busy ? "Adding…" : "Add to team"}
          </button>
        </form>
      </dialog>
    </>
  );
}

// Directors of Teams: delete this team, after an "Are you sure?" that says what goes with it.
export function DeleteTeamButton({
  teamId,
  name,
  players,
  practices,
}: {
  teamId: string;
  name: string;
  players: number;
  practices: number;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          const what = [
            "its staff",
            `${players} rostered player${players === 1 ? "" : "s"}`,
            "evaluations and uniforms",
            `${practices} upcoming practice${practices === 1 ? "" : "s"} (those times open up)`,
          ].join(", ");
          if (
            !(await confirm({
              title: `Delete ${name}?`,
              message: `Are you sure? This removes ${what}. It can't be undone.`,
              confirmLabel: "Delete team",
            }))
          )
            return;
          start(async () => {
            const r = await deleteTeam(teamId);
            if (!r.ok) return setError(r.message);
            router.replace("/org/thunder?open=teams#teams");
          });
        }}
        className="w-full rounded-full px-4 py-2.5 text-sm font-semibold text-red-600 ring-1 ring-red-600/30 hover:bg-red-50 disabled:opacity-50 dark:ring-red-400/30 dark:hover:bg-red-500/10"
      >
        Delete team
      </button>
      {error && <Toast key={error} message={error} />}
      {confirmDialog}
    </>
  );
}
