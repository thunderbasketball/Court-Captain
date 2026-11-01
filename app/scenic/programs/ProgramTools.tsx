"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDivision,
  addPool,
  copyDivisions,
  deleteProgram,
  moveTeam,
  registerTeam,
  removeDivision,
  removePool,
  saveProgram,
  setPaid,
  setTeamOff,
  withdrawTeam,
} from "../actions";
import { Alert, CloseButton, PopUp, Toast, dialogCls, useConfirm } from "../../client-ui";
import { fieldLabel, inputCls, pillCls } from "../../ui";
import { REG_OPTIONS, type ProgramOption } from "@/lib/program-options";
import RegisterChoices from "./RegisterChoices";

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
  options: ProgramOption[];
};

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
// The options form: each Registration Option on or off, with its fee (text, dollars).
type OptionsForm = Record<string, { on: boolean; fee: string }>;
const optionsForm = (list: ProgramOption[]): OptionsForm =>
  Object.fromEntries(
    REG_OPTIONS.map((o) => {
      const have = list.find((x) => x.kind === o.key);
      return [o.key, { on: !!have, fee: dollars(have?.feeCents ?? null) }];
    }),
  );

// Directors of Programs: new program, or edit its details. Divisions are set up on the program page.
export function ProgramEditor({ program }: { program?: ProgramFields }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const start0 = () =>
    program
      ? { ...program, fee: dollars(program.feeCents) }
      : { kind: "League", name: "", startsOn: "", endsOn: "", regOpens: "", regCloses: "", fee: "" };
  const [f, setF] = useState(start0);
  const [opts, setOpts] = useState(() => optionsForm(program?.options ?? [{ kind: "all_season", feeCents: null }]));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: "name" | "startsOn" | "endsOn" | "regOpens" | "regCloses" | "fee") => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const save = () =>
    start(async () => {
      setError(null);
      const options = REG_OPTIONS.filter((o) => opts[o.key].on).map((o) => ({ kind: o.key, fee: opts[o.key].fee }));
      const r = await saveProgram(program?.id ?? null, { ...f, options });
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
          setOpts(optionsForm(program?.options ?? [{ kind: "all_season", feeCents: null }]));
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
          {f.kind === "League" ? (
            <fieldset>
              <legend className={fieldLabel}>Registration Options</legend>
              <p className="-mt-1 mb-2 text-xs text-zinc-500">
                A team checks the ones it wants when it registers. GG = games guaranteed that day.
              </p>
              <div className="space-y-2">
                {REG_OPTIONS.map((o) => (
                  <div key={o.key} className="flex items-center gap-3 rounded-xl p-2 ring-1 ring-zinc-950/5 dark:ring-white/10">
                    <label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4"
                        checked={opts[o.key].on}
                        onChange={(e) => setOpts({ ...opts, [o.key]: { ...opts[o.key], on: e.target.checked } })}
                      />
                      <span>
                        <span className="font-medium">{o.name}</span>
                        <span className="block text-xs text-zinc-500">{o.about}</span>
                      </span>
                    </label>
                    {opts[o.key].on && (
                      <label className="w-28 shrink-0">
                        <span className="sr-only">{o.name} fee</span>
                        <input
                          className={inputCls}
                          value={opts[o.key].fee}
                          onChange={(e) => setOpts({ ...opts, [o.key]: { ...opts[o.key], fee: e.target.value } })}
                          inputMode="decimal"
                          placeholder={o.perDate ? "$ / date" : "$ / team"}
                        />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            </fieldset>
          ) : (
            <label className="block">
              <span className={fieldLabel}>Fee per team (optional)</span>
              <input className={inputCls} value={f.fee} onChange={set("fee")} inputMode="decimal" placeholder="150.00" />
            </label>
          )}
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
// Register one of your teams: pick it; for a League, then pick ALL Season and/or Single Day dates.
export function RegisterTeam({
  programId,
  teams,
  league,
}: {
  programId: string;
  teams: { teamId: string; name: string; division: string }[];
  league: { options: ProgramOption[]; gameDates: string[]; today: string } | null;
}) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const chosen = teams.find((t) => t.teamId === pick);
  if (league)
    return (
      <div className="grid gap-3">
        <select className={`${inputCls} py-2`} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="" disabled>
            Pick one of your teams…
          </option>
          {teams.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {t.name} → {t.division}
            </option>
          ))}
        </select>
        {chosen && (
          <RegisterChoices
            key={chosen.teamId}
            options={league.options}
            gameDates={league.gameDates}
            today={league.today}
            entry={null}
            save={async (choice) => {
              const r = await registerTeam(programId, chosen.teamId, choice);
              if (!r.ok) return r;
              setDone(`${chosen.name} is in ${r.division}.`);
              setPick("");
              router.refresh();
              return { ok: true as const };
            }}
          />
        )}
        {done && <Toast key={done} message={done} />}
      </div>
    );
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

// Admins and Directors of Scheduling: take a team out of a Game Day, the Brackets or the whole program (asks first), or
// restore it. It stays listed, crossed out.
export function TeamOffButton({
  programId,
  teamId,
  name,
  what,
  label,
  out,
}: {
  programId: string;
  teamId: string;
  name: string;
  what: string; // a date, "brackets" or "program"
  label: string; // "Dec 5", "the Brackets", "the program"
  out: boolean; // taken out now
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className={`${smallBtn} ${out ? "text-emerald-700 ring-emerald-600/40 dark:text-emerald-300" : "text-red-600 ring-red-600/30"}`}
        onClick={async () => {
          if (
            !out &&
            !(await confirm({
              title: `Take ${name} out of ${label}?`,
              message: "They stay listed (crossed out). You can restore them.",
              confirmLabel: "Take out",
            }))
          )
            return;
          start(async () => {
            const r = await setTeamOff(programId, teamId, what, !out);
            setMsg(r.ok ? `${name} ${out ? "restored to" : "taken out of"} ${label}.` : r.message);
            if (r.ok) router.refresh();
          });
        }}
      >
        {out ? "Restore" : "Remove"}
      </button>
      {msg && <Toast key={msg} message={msg} />}
      {confirmDialog}
    </>
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
// `others`: programs with divisions to copy from.
export function AddDivision({
  programId,
  others,
}: {
  programId: string;
  others: { id: string; name: string; divisions: number }[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const [f, setF] = useState({ gender: "", from: "", to: "", levels: [] as string[] });
  // The picker (a pop-up over this one): tap a program to copy its divisions.
  const copy = (fromId: string, closePicker: () => void) =>
    start(async () => {
      setError(null);
      closePicker();
      const r = await copyDivisions(programId, fromId);
      if (!r.ok) return setError(r.message);
      setDone(
        [
          r.copied.length ? `Copied ${r.copied.join(", ")}.` : "Nothing copied.",
          r.skipped.length ? `Skipped (overlaps a division here): ${r.skipped.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      router.refresh();
    });
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
          {others.length > 0 && (
            <PopUp
              label="Copy from another program"
              title="Copy divisions from…"
              className={`${smallBtn} justify-self-start px-4 py-2 text-sm text-scenic-navy ring-scenic-navy/30 dark:text-zinc-200 dark:ring-white/20`}
              note="Copies its divisions, grade groups and pools (no teams). Divisions that overlap ones here are skipped."
            >
              {(closePicker) => (
                <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                  {others.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => copy(o.id, closePicker)}
                        className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm hover:text-scenic-navy disabled:opacity-50"
                      >
                        <span className="font-medium">{o.name}</span>
                        <span className="shrink-0 text-zinc-500">
                          {o.divisions} division{o.divisions === 1 ? "" : "s"} →
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </PopUp>
          )}
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
