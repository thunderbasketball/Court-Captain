"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createScenicTeam, deleteScenicTeam, updateScenicTeam } from "../actions";
import { Alert, CloseButton, Toast, dialogCls, useConfirm } from "../../../client-ui";
import { inputCls } from "../../../ui";

type Choice = { value: string; label: string };
export type TeamFields = {
  id: string;
  name: string;
  gender: "Boys" | "Girls" | "Coed";
  level: "COMP" | "REC";
  gradeLow: number;
  grade: number;
  coachFirst: string | null; // null: an organization's team with no coach yet (not editable here)
  coachLast: string | null;
  coachCell: string | null;
};

const blank = { for: "", name: "", gender: "", level: "", grade: "", coachFirst: "", coachLast: "", coachCell: "" };
const navyBtn =
  "rounded-full bg-scenic-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-scenic-navy";

// Add a team (for a partner, or a Solo coach's own) or edit one. The coach's cell becomes their login.
export function TeamEditor({ addFor, grades, team }: { addFor?: Choice[]; grades: Choice[]; team?: TeamFields }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const fromTeam = (t: TeamFields) => ({
    for: "",
    name: t.name,
    gender: t.gender,
    level: t.level,
    grade: t.grade === -1 ? "PK" : t.gradeLow === t.grade ? String(t.grade) : `${t.gradeLow}-${t.grade}`,
    coachFirst: t.coachFirst ?? "",
    coachLast: t.coachLast ?? "",
    coachCell: t.coachCell ?? "",
  });
  const [f, setF] = useState(team ? fromTeam(team) : blank);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const open = () => {
    setF(team ? fromTeam(team) : { ...blank, for: addFor?.length === 1 ? addFor[0].value : "" });
    setError(null);
    dialog.current?.showModal();
  };
  const save = () =>
    start(async () => {
      setError(null);
      const r = team ? await updateScenicTeam(team.id, f) : await createScenicTeam(f);
      if (!r.ok) return setError(r.message);
      close();
      const login = "newLogin" in r && r.newLogin ? ` ${f.coachFirst} logs in with their cell (starter PIN 1234).` : "";
      setDone(`${f.name} saved.${login}`);
      router.refresh();
    });

  return (
    <>
      {team ? (
        <button
          type="button"
          onClick={open}
          className="rounded-full px-3 py-1 text-xs font-medium text-scenic-navy ring-1 ring-scenic-navy/30 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20 dark:hover:bg-zinc-800"
        >
          Edit
        </button>
      ) : (
        <button type="button" onClick={open} className={navyBtn}>
          + Add team
        </button>
      )}
      {done && <Toast key={done} message={done} />}
      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        <form
          className="space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{team ? `Edit ${team.name}` : "Add a team"}</h2>
            <CloseButton onClick={close} />
          </div>
          {!team && addFor && addFor.length > 1 && (
            <label className="block text-sm font-medium">
              Team for
              <select className={`${inputCls} mt-1`} value={f.for} onChange={set("for")} required>
                <option value="" disabled>
                  Pick a partner…
                </option>
                {addFor.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-sm font-medium">
            Team name
            <input
              className={`${inputCls} mt-1`}
              value={f.name}
              onChange={set("name")}
              maxLength={60}
              required
              autoComplete="off"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Gender
              <select className={`${inputCls} mt-1`} value={f.gender} onChange={set("gender")} required>
                <option value="" disabled>
                  Pick…
                </option>
                <option>Boys</option>
                <option>Girls</option>
                <option value="Coed">Coed (Pre-K)</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Grade
              <select className={`${inputCls} mt-1`} value={f.grade} onChange={set("grade")} required>
                <option value="" disabled>
                  Pick…
                </option>
                {grades.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm font-medium">
            Level
            <select className={`${inputCls} mt-1`} value={f.level} onChange={set("level")} required>
              <option value="" disabled>
                Pick…
              </option>
              <option value="COMP">COMP (competitive)</option>
              <option value="REC">REC (recreational)</option>
            </select>
          </label>
          <p className="text-xs text-zinc-500">A two-grade team (e.g. 3rd/4th) is listed and plays with the higher grade.</p>
          <fieldset className="grid grid-cols-2 gap-3">
            <legend className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Coach</legend>
            <label className="block text-sm font-medium">
              First name
              <input
                className={`${inputCls} mt-1`}
                value={f.coachFirst}
                onChange={set("coachFirst")}
                required
                autoComplete="off"
              />
            </label>
            <label className="block text-sm font-medium">
              Last name
              <input className={`${inputCls} mt-1`} value={f.coachLast} onChange={set("coachLast")} required autoComplete="off" />
            </label>
            <label className="col-span-2 block text-sm font-medium">
              Cell (their login)
              <input
                className={`${inputCls} mt-1`}
                value={f.coachCell}
                onChange={set("coachCell")}
                inputMode="tel"
                autoComplete="off"
                required
              />
            </label>
          </fieldset>
          {error && <Alert tone="red">{error}</Alert>}
          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={busy} className={navyBtn}>
              {team ? "Save" : "Add team"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

// Delete, on the team's row: asks "Are you sure?" first.
export function DeleteTeam({ id, name }: { id: string; name: string }) {
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
          if (
            !(await confirm({ title: `Delete ${name}?`, message: "Are you sure? This can't be undone.", confirmLabel: "Delete" }))
          )
            return;
          start(async () => {
            const r = await deleteScenicTeam(id);
            if (r.ok) router.refresh();
            else setError(r.message);
          });
        }}
        className="rounded-full px-3 py-1 text-xs font-medium text-red-600 ring-1 ring-red-600/30 hover:bg-red-50 disabled:opacity-50 dark:ring-red-400/30 dark:hover:bg-red-500/10"
      >
        Delete
      </button>
      {error && <Toast key={error} message={error} />}
      {confirmDialog}
    </>
  );
}
