"use client";

import { AddPersonIcon, CardPanel, PanelIcon, addIconBtn, closeCardPanel } from "../../../CardIcons";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Toast, useConfirm } from "../../../client-ui";
import { fieldLabel, inputCls, pillCls, primaryBtn } from "../../../ui";
import { addCoach, editTeam, removeCoach, removeTeam, setAltName } from "./actions";
import { GRADES, LEVELS, PREK, gradeSort, type Gender } from "@/lib/team-names";
import type { DeleteBlock } from "@/lib/schedule-removal";
import { DeleteBlockedNote } from "../../../ScheduleRemoval";


// Delete a team (asks first). Its coaches come off it.
// `block`: on an event's schedule, the pop-up says what to do (no Delete); only registered, it says deleting withdraws it.
export function DeleteTeamButton({ org, id, name, block }: { org: string; id: string; name: string; block?: DeleteBlock | null }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className="shrink-0 rounded-full px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-600/30 hover:bg-red-50 dark:hover:bg-red-500/10"
        onClick={async () => {
          if (block?.why === "scheduled") {
            await confirm({ title: `${name} can't be deleted yet`, message: <DeleteBlockedNote block={block} />, confirmLabel: null, tone: "warning" });
            return;
          }
          if (
            !(await confirm({
              title: `Delete ${name}?`,
              message: `Are you sure? Its coaches come off the team.${block ? ` It's registered in ${block.program}; deleting it withdraws it.` : ""}`,
              confirmLabel: "Delete",
              typeToConfirm: name, // the team's name must be typed
            }))
          )
            return;
          start(async () => {
            const r = await removeTeam(org, id);
            if (!r.ok) return setMsg(r.message);
            router.push(`/org/${org}?open=teams#teams`);
          });
        }}
      >
        Delete team
      </button>
      {msg && <Toast key={msg} message={msg} />}
      {dialog}
    </>
  );
}

// Add staff on a team's Staff card: the icon on its title line opens the form at the top of the card (no pop-up).
export const addStaffPanel = (teamId: string) => `add-staff-${teamId}`;
export function AddCoachButton({ teamId }: { teamId: string }) {
  return (
    <PanelIcon id={addStaffPanel(teamId)} label="Add staff" className={addIconBtn}>
      <AddPersonIcon />
    </PanelIcon>
  );
}

// `roles`: the spots this person may fill (its Directors: any; its Head Coach: all but Head Coach; an Assistant Coach: Team
// Manager and Team Parent).
export type StaffSpot = "HeadCoach" | "AsstCoach" | "Manager" | "TeamParent";
export function AddCoachPanel({ org, teamId, hasHead, roles }: { org: string; teamId: string; hasHead: boolean; roles: StaffSpot[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const id = addStaffPanel(teamId);
  return (
    <>
      <CardPanel id={id}>
        <div className="pt-3">
          <CoachForm
            org={org}
            teamId={teamId}
            roles={hasHead ? roles.filter((r) => r !== "HeadCoach") : roles}
            onAdded={(text) => {
              closeCardPanel(id);
              setMsg(text);
              router.refresh();
            }}
          />
        </div>
      </CardPanel>
      {msg && <Toast key={msg} message={msg} />}
    </>
  );
}

function CoachForm({
  org,
  teamId,
  roles,
  onAdded,
}: {
  org: string;
  teamId: string;
  roles: StaffSpot[];
  onAdded: (msg: string) => void;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [cell, setCell] = useState("");
  const [role, setRole] = useState<StaffSpot>(roles[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await addCoach(org, teamId, { first, last, cell, role });
          if (!r.ok) return setError(r.message);
          onAdded(r.newLogin ? `${r.name} added. Their login is their cell; starter PIN 1234.` : `${r.name} added.`);
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={fieldLabel}>First name</span>
          <input className={inputCls} value={first} onChange={(e) => setFirst(e.target.value)} required />
        </label>
        <label className="block">
          <span className={fieldLabel}>Last name</span>
          <input className={inputCls} value={last} onChange={(e) => setLast(e.target.value)} required />
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel}>Cell</span>
        <input
          className={inputCls}
          type="tel"
          inputMode="tel"
          placeholder="(423) 555-0123"
          value={cell}
          onChange={(e) => setCell(e.target.value)}
          required
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {roles.includes("HeadCoach") && (
          <button type="button" className={pillCls(role === "HeadCoach")} onClick={() => setRole("HeadCoach")}>
            Head Coach
          </button>
        )}
        {roles.includes("AsstCoach") && (
          <button type="button" className={pillCls(role === "AsstCoach")} onClick={() => setRole("AsstCoach")}>
            Assistant Coach
          </button>
        )}
        <button type="button" className={pillCls(role === "Manager")} onClick={() => setRole("Manager")}>
          Team Manager
        </button>
        <button type="button" className={pillCls(role === "TeamParent")} onClick={() => setRole("TeamParent")}>
          Team Parent
        </button>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Adding…" : role === "Manager" || role === "TeamParent" ? "Add to staff" : "Add coach"}
      </button>
    </form>
  );
}

// Remove a coach from the team (asks first).
export function RemoveCoachButton({
  org,
  teamId,
  coachId,
  name,
}: {
  org: string;
  teamId: string;
  coachId: string;
  name: string;
}) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className="text-xs font-medium text-red-600 hover:underline"
        onClick={async () => {
          if (
            !(await confirm({
              title: `Remove ${name}?`,
              message: "Are you sure? They come off this team.",
              confirmLabel: "Remove",
            }))
          )
            return;
          start(async () => {
            const r = await removeCoach(org, teamId, coachId);
            setMsg(r.ok ? `${name} removed.` : r.message);
            if (r.ok) router.refresh();
          });
        }}
      >
        Remove
      </button>
      {msg && <Toast key={msg} message={msg} />}
      {dialog}
    </>
  );
}

// Edit on the team's card (Admins and Directors of Teams): its gender, grades, level (REC or COMP) and Alternate name,
// right there (no pop-up). The name follows the rule; a team in a League program that hasn't ended is withdrawn first
// (the server says so).
export function TeamEditButton({
  org,
  id,
  team,
}: {
  org: string;
  id: string;
  team: { gender: Gender; grades: string[]; level: "COMP" | "REC"; altName: string | null; changedBy: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [gender, setGender] = useState<Gender>(team.gender);
  const [grades, setGrades] = useState<string[]>(team.grades);
  const [level, setLevel] = useState<string>(team.level);
  const [alt, setAlt] = useState(team.altName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const reset = () => {
    setGender(team.gender);
    setGrades(team.grades);
    setLevel(team.level);
    setAlt(team.altName ?? "");
    setError(null);
  };
  // One grade, or two next to each other; Pre-K is on its own, Coed and REC.
  const tapGrade = (g: string) => {
    if (g === PREK) {
      setGrades([PREK]);
      setGender("Coed");
      setLevel("REC");
      return;
    }
    if (gender === "Coed") setGender("Boys");
    setGrades((cur) => {
      if (cur.includes(PREK)) return [g];
      if (cur.includes(g)) return cur.length > 1 ? cur.filter((x) => x !== g) : cur;
      if (cur.length === 1 && Math.abs(gradeSort(cur[0]) - gradeSort(g)) === 1) return [...cur, g].sort((x, y) => gradeSort(x) - gradeSort(y));
      return [g];
    });
  };
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => (reset(), setDone(null), setOpen(true))} className="text-sm font-medium text-thunder-blue hover:underline">
          Edit team
        </button>
        {done && <span className="text-sm text-emerald-700 dark:text-emerald-400">{done}</span>}
        {team.changedBy && <span className="text-xs text-zinc-500">Changed by {team.changedBy}</span>}
      </div>
    );
  return (
    <form
      className="space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await editTeam(org, id, { gender, grades, level });
          if (!r.ok) return setError(r.message);
          if (alt.trim() !== (team.altName ?? "")) {
            const a = await setAltName(org, id, alt);
            if (!a.ok) return setError(a.message);
          }
          setOpen(false);
          setDone(`Saved ✓ ${r.name}`);
          router.refresh();
        });
      }}
    >
      <div>
        <span className={fieldLabel}>Gender</span>
        <div className="flex flex-wrap gap-2">
          {(["Boys", "Girls"] as const).map((g) => (
            <button key={g} type="button" className={pillCls(gender === g)} onClick={() => (setGender(g), grades.includes(PREK) && setGrades(["K"]))}>
              {g}
            </button>
          ))}
          {gender === "Coed" && <span className={pillCls(true)}>Coed</span>}
        </div>
      </div>
      <div>
        <span className={fieldLabel}>Grade (one, or two next to each other)</span>
        <div className="flex flex-wrap gap-1.5">
          {[PREK, ...GRADES].map((g) => (
            <button key={g} type="button" className={`${pillCls(grades.includes(g))} min-w-10`} onClick={() => tapGrade(g)}>
              {g === PREK ? "Pre-K" : g}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={fieldLabel}>Level</span>
        <div className="flex gap-2">
          {LEVELS.map((l) => (
            <button key={l} type="button" className={pillCls(level === l)} onClick={() => setLevel(l)} disabled={grades.includes(PREK) && l === "COMP"}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className={fieldLabel}>Alternate name (optional; in the team&apos;s name instead of the organization&apos;s)</span>
        <input className={inputCls} maxLength={60} value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="e.g. Bolts" />
      </label>
      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !grades.length} className={primaryBtn}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          Cancel
        </button>
      </div>
    </form>
  );
}

