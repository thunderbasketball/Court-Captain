"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDivision,
  addPool,
  deleteProgram,
  moveTeam,
  registerTeam,
  removeDivision,
  removePool,
  saveProgram,
  setPaid,
  withdrawTeam,
} from "../actions";
import { Alert, CloseButton, Toast, dialogCls, useConfirm } from "../../client-ui";
import { fieldLabel, inputCls, pillCls } from "../../ui";

const KINDS = ["League", "Circuit", "Tournament"] as const;
const GRADES = Array.from({ length: 13 }, (_, g) => g);
const gradeName = (g: number) => (g === 0 ? "K" : g === 1 ? "1st" : g === 2 ? "2nd" : g === 3 ? "3rd" : `${g}th`);
const navyBtn =
  "rounded-full bg-scenic-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-scenic-navy";
const smallBtn = "rounded-full px-3 py-1 text-xs font-medium ring-1 disabled:opacity-50";

export type ProgramFields = {
  id: string;
  kind: string;
  name: string;
  startsOn: string;
  endsOn: string;
  regOpens: string;
  regCloses: string;
  feeCents: number | null;
};

// Directors of Programs: new program, or edit its details. Divisions are set up on the program page.
export function ProgramEditor({ program }: { program?: ProgramFields }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const start0 = () =>
    program
      ? { ...program, fee: program.feeCents === null ? "" : (program.feeCents / 100).toFixed(2) }
      : { kind: "League", name: "", startsOn: "", endsOn: "", regOpens: "", regCloses: "", fee: "" };
  const [f, setF] = useState(start0);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: "name" | "startsOn" | "endsOn" | "regOpens" | "regCloses" | "fee") => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveProgram(program?.id ?? null, f);
      if (!r.ok) return setError(r.message);
      close();
      if (program) router.refresh();
      else router.push(`/scenic/programs/${r.id}`);
    });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setF(start0());
          setError(null);
          dialog.current?.showModal();
        }}
        className={program ? `${smallBtn} text-scenic-navy ring-scenic-navy/30 dark:text-zinc-200 dark:ring-white/20` : navyBtn}
      >
        {program ? "Edit" : "+ New program"}
      </button>
      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{program ? `Edit ${program.name}` : "New program"}</h2>
            <CloseButton onClick={close} />
          </div>
          <div>
            <span className={fieldLabel}>Type</span>
            <div className="flex gap-2">
              {KINDS.map((k) => (
                <button key={k} type="button" className={pillCls(f.kind === k)} onClick={() => setF({ ...f, kind: k })}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={fieldLabel}>Name</span>
            <input
              className={inputCls}
              value={f.name}
              onChange={set("name")}
              maxLength={60}
              required
              placeholder="Winter League 2027"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabel}>Starts</span>
              <input type="date" className={inputCls} value={f.startsOn} onChange={set("startsOn")} required />
            </label>
            <label className="block">
              <span className={fieldLabel}>Ends</span>
              <input type="date" className={inputCls} value={f.endsOn} onChange={set("endsOn")} required />
            </label>
            <label className="block">
              <span className={fieldLabel}>Registration opens</span>
              <input type="date" className={inputCls} value={f.regOpens} onChange={set("regOpens")} required />
            </label>
            <label className="block">
              <span className={fieldLabel}>Registration closes</span>
              <input type="date" className={inputCls} value={f.regCloses} onChange={set("regCloses")} required />
            </label>
          </div>
          <label className="block">
            <span className={fieldLabel}>Fee per team (optional)</span>
            <input className={inputCls} value={f.fee} onChange={set("fee")} inputMode="decimal" placeholder="150.00" />
          </label>
          {error && <Alert tone="red">{error}</Alert>}
          <button type="submit" disabled={busy} className={`${navyBtn} w-full py-2.5`}>
            {program ? "Save" : "Create program"}
          </button>
        </form>
      </dialog>
    </>
  );
}

export function DeleteProgram({ id, name, teams }: { id: string; name: string; teams: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className={`${smallBtn} text-red-600 ring-red-600/30 hover:bg-red-50 dark:ring-red-400/30 dark:hover:bg-red-500/10`}
        onClick={async () => {
          const msg = `Are you sure? ${teams ? `Its ${teams} team registration${teams === 1 ? "" : "s"} go too (the teams stay). ` : ""}This can't be undone.`;
          if (!(await confirm({ title: `Delete ${name}?`, message: msg, confirmLabel: "Delete" }))) return;
          start(async () => {
            const r = await deleteProgram(id);
            if (!r.ok) return setError(r.message);
            router.replace("/scenic/programs");
          });
        }}
      >
        Delete
      </button>
      {error && <Toast key={error} message={error} />}
      {confirmDialog}
    </>
  );
}

// Pick one of your teams and register it; it shows which division it joins.
export function RegisterTeam({
  programId,
  teams,
}: {
  programId: string;
  teams: { teamId: string; name: string; division: string }[];
}) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const chosen = teams.find((t) => t.teamId === pick);
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await registerTeam(programId, pick);
          if (!r.ok) return setError(r.message);
          setDone(`${chosen?.name ?? "Team"} is in ${r.division}.`);
          setPick("");
          router.refresh();
        });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <select className={`${inputCls} min-w-0 flex-1 py-2`} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="" disabled>
            Pick one of your teams…
          </option>
          {teams.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {t.name} → {t.division}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !pick} className={navyBtn}>
          Register
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {done && <Toast key={done} message={done} />}
    </form>
  );
}

export function PaidButton({ programId, teamId, paid }: { programId: string; teamId: string; paid: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        title={paid ? "Mark unpaid" : "Mark paid"}
        onClick={() =>
          start(async () => {
            const r = await setPaid(programId, teamId, !paid);
            if (r.ok) router.refresh();
            else setError(r.message);
          })
        }
        className={`${smallBtn} ${
          paid
            ? "bg-emerald-50 text-emerald-700 ring-emerald-600/30 dark:bg-emerald-500/10 dark:text-emerald-300"
            : "text-amber-700 ring-amber-600/30 dark:text-amber-300"
        }`}
      >
        {paid ? "✓ Paid" : "Unpaid"}
      </button>
      {error && <Toast key={error} message={error} />}
    </>
  );
}

export function WithdrawTeam({ programId, teamId, name }: { programId: string; teamId: string; name: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className={`${smallBtn} text-red-600 ring-red-600/30 hover:bg-red-50 dark:ring-red-400/30 dark:hover:bg-red-500/10`}
        onClick={async () => {
          if (
            !(await confirm({
              title: `Withdraw ${name}?`,
              message: "Are you sure? It comes out of this program.",
              confirmLabel: "Withdraw",
            }))
          )
            return;
          start(async () => {
            const r = await withdrawTeam(programId, teamId);
            if (r.ok) router.refresh();
            else setError(r.message);
          });
        }}
      >
        Withdraw
      </button>
      {error && <Toast key={error} message={error} />}
      {confirmDialog}
    </>
  );
}

// Directors of Programs: add a division (gender, grades from–to, and its levels). Each grade gets a group per level
// (e.g. K REC, 2nd COMP), each with Pool A.
export function AddDivision({ programId }: { programId: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const [f, setF] = useState({ gender: "", from: "", to: "", levels: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setDone(null);
          dialog.current?.showModal();
        }}
        className={`${smallBtn} ml-auto bg-scenic-navy text-white ring-scenic-navy dark:bg-white dark:text-scenic-navy dark:ring-white`}
      >
        + Add division
      </button>
      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        <form
          className="grid gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await addDivision(programId, {
                gender: f.gender,
                from: Number(f.from),
                to: Number(f.to || f.from),
                levels: f.levels,
              });
              if (!r.ok) return setError(r.message);
              setDone(`${r.label} added. Add another, or close.`);
              setF({ ...f, from: "", to: "" });
              router.refresh();
            });
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Add a division</h2>
            <CloseButton onClick={close} />
          </div>
          <p className="text-sm text-zinc-500">
            A division is a gender and a group of grades (e.g. Boys K–1st). Each grade gets a group for each level you pick, each
            with Pool A. A registering team goes to the smallest pool of its grade and level (a 3rd/4th team plays as 4th).
          </p>
          <div className="flex flex-wrap gap-2">
            {["Boys", "Girls"].map((g) => (
              <button key={g} type="button" className={pillCls(f.gender === g)} onClick={() => setF({ ...f, gender: g })}>
                {g}
              </button>
            ))}
            <span className="w-2" />
            {["REC", "COMP"].map((l) => (
              <button
                key={l}
                type="button"
                className={pillCls(f.levels.includes(l))}
                onClick={() => setF({ ...f, levels: f.levels.includes(l) ? f.levels.filter((x) => x !== l) : [...f.levels, l] })}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabel}>From grade</span>
              <select
                className={inputCls}
                value={f.from}
                onChange={(e) => setF({ ...f, from: e.target.value, to: f.to && f.to < e.target.value ? "" : f.to })}
                required
              >
                <option value="" disabled>
                  Pick…
                </option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {gradeName(g)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>To grade</span>
              <select className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
                <option value="">Same</option>
                {GRADES.filter((g) => f.from === "" || g > Number(f.from)).map((g) => (
                  <option key={g} value={g}>
                    {gradeName(g)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy || !f.gender || !f.levels.length || f.from === ""} className={navyBtn}>
              Add division
            </button>
            <button type="button" onClick={close} className="text-sm text-zinc-500">
              Done
            </button>
          </div>
          {done && <Alert tone="green">{done}</Alert>}
        </form>
      </dialog>
    </>
  );
}

export function RemoveDivision({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className={`${smallBtn} text-red-600 ring-red-600/30 hover:bg-red-50 dark:ring-red-400/30 dark:hover:bg-red-500/10`}
        onClick={async () => {
          if (!(await confirm({ title: `Remove ${label}?`, message: "Are you sure?", confirmLabel: "Remove" }))) return;
          start(async () => {
            const r = await removeDivision(id);
            if (r.ok) router.refresh();
            else setError(r.message);
          });
        }}
      >
        Remove division
      </button>
      {error && <Toast key={error} message={error} />}
      {confirmDialog}
    </>
  );
}

// Directors of Programs: the next pool for a grade group (Pool B, Pool C…).
export function AddPool({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await addPool(groupId);
            if (r.ok) router.refresh();
            else setError(r.message);
          })
        }
        className={`${smallBtn} text-scenic-navy ring-scenic-navy/30 dark:text-zinc-200 dark:ring-white/20`}
      >
        + Pool
      </button>
      {error && <Toast key={error} message={error} />}
    </>
  );
}

export function RemovePool({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Remove ${name}`}
        onClick={() =>
          start(async () => {
            const r = await removePool(id);
            if (r.ok) router.refresh();
            else setError(r.message);
          })
        }
        className="text-xs font-medium text-red-600 hover:underline"
      >
        Remove
      </button>
      {error && <Toast key={error} message={error} />}
    </>
  );
}

// Directors of Programs: move a team to another pool in its grade group.
export function MoveTeam({
  programId,
  teamId,
  pools,
}: {
  programId: string;
  teamId: string;
  pools: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <select
        aria-label="Move to pool"
        disabled={busy}
        value=""
        onChange={(e) => {
          const to = e.target.value;
          start(async () => {
            const r = await moveTeam(programId, teamId, to);
            if (r.ok) router.refresh();
            else setError(r.message);
          });
        }}
        className="rounded-full bg-white px-2 py-1 text-xs ring-1 ring-zinc-950/15 dark:bg-zinc-900 dark:ring-white/20"
      >
        <option value="" disabled>
          Move to…
        </option>
        {pools.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {error && <Toast key={error} message={error} />}
    </>
  );
}
