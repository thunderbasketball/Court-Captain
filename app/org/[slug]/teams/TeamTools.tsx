"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, PopUp, Toast, useConfirm } from "../../../client-ui";
import { fieldLabel, inputCls, pillCls, primaryBtn } from "../../../ui";
import { addCoach, addTeam, removeCoach, removeTeam } from "./actions";

const addBtn =
  "shrink-0 rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thunder-blue-dark";

// + Add on the Teams page: a pop-up for the team's name, Boys or Girls, grade (one, or two in a row) and COMP or REC.
export function AddTeamButton({ org, grades }: { org: string; grades: { value: string; label: string }[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <PopUp label="+ Add" title="Add a team" className={addBtn}>
        {(close) => (
          <TeamForm
            org={org}
            grades={grades}
            onAdded={(id, name) => {
              close();
              setMsg(`${name} added.`);
              router.push(`/org/${org}/teams/${id}`);
            }}
          />
        )}
      </PopUp>
      {msg && <Toast key={msg} message={msg} />}
    </>
  );
}

function TeamForm({
  org,
  grades,
  onAdded,
}: {
  org: string;
  grades: { value: string; label: string }[];
  onAdded: (id: string, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"Boys" | "Girls" | "">("");
  const [grade, setGrade] = useState("");
  const [level, setLevel] = useState<"COMP" | "REC" | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await addTeam(org, { name, gender, grade, level });
          if (!r.ok) return setError(r.message);
          onAdded(r.id, name);
        });
      }}
    >
      <label className="block">
        <span className={fieldLabel}>Team name</span>
        <input
          className={inputCls}
          maxLength={60}
          placeholder="e.g. Bolts"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <div>
        <span className={fieldLabel}>Boys or Girls</span>
        <div className="flex gap-2">
          {(["Boys", "Girls"] as const).map((g) => (
            <button key={g} type="button" className={pillCls(gender === g)} onClick={() => setGender(g)}>
              {g}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={fieldLabel}>Grade</span>
          <select className={inputCls} value={grade} onChange={(e) => setGrade(e.target.value)} required>
            <option value="">Pick…</option>
            {grades.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className={fieldLabel}>Level</span>
          <div className="flex gap-2">
            {(["COMP", "REC"] as const).map((l) => (
              <button key={l} type="button" className={pillCls(level === l)} onClick={() => setLevel(l)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Adding…" : "Add team"}
      </button>
    </form>
  );
}

// Delete a team (asks first). Its coaches come off it.
export function DeleteTeamButton({ org, id, name }: { org: string; id: string; name: string }) {
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
          if (
            !(await confirm({
              title: `Delete ${name}?`,
              message: "Are you sure? Its coaches come off the team.",
              confirmLabel: "Delete",
            }))
          )
            return;
          start(async () => {
            const r = await removeTeam(org, id);
            if (!r.ok) return setMsg(r.message);
            router.push(`/org/${org}/teams`);
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

// + Add on a team's Coaches: a pop-up for name, cell and Head or Assistant Coach.
export function AddCoachButton({ org, teamId, hasHead }: { org: string; teamId: string; hasHead: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <PopUp label="+ Add" title="Add a coach" className={addBtn}>
        {(close) => (
          <CoachForm
            org={org}
            teamId={teamId}
            hasHead={hasHead}
            onAdded={(text) => {
              close();
              setMsg(text);
              router.refresh();
            }}
          />
        )}
      </PopUp>
      {msg && <Toast key={msg} message={msg} />}
    </>
  );
}

function CoachForm({
  org,
  teamId,
  hasHead,
  onAdded,
}: {
  org: string;
  teamId: string;
  hasHead: boolean;
  onAdded: (msg: string) => void;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [cell, setCell] = useState("");
  const [role, setRole] = useState(hasHead ? "AsstCoach" : "HeadCoach");
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
      <div className="flex gap-2">
        {!hasHead && (
          <button type="button" className={pillCls(role === "HeadCoach")} onClick={() => setRole("HeadCoach")}>
            Head Coach
          </button>
        )}
        <button type="button" className={pillCls(role === "AsstCoach")} onClick={() => setRole("AsstCoach")}>
          Assistant Coach
        </button>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Adding…" : "Add coach"}
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
