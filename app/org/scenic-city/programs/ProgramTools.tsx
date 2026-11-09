"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  setGradeLevel,
  setRecLimit,
  setSchedulePublished,
  setPaid,
  setProgramLogo,
  setTeamOff,
  withdrawTeam,
} from "../actions";
import { Alert, CloseButton, OnPage, PopUp, Toast, dialogCls, useConfirm } from "../../../client-ui";
import { fieldLabel, inputCls, pillCls } from "../../../ui";
import { GearIcon } from "../../../OrgSettings";
import { REG_OPTIONS, type ProgramOption } from "@/lib/program-options";
import RegisterChoices from "./RegisterChoices";

const KINDS = ["League", "Circuit", "Tournament"] as const;
const GRADES = Array.from({ length: 13 }, (_, g) => g);
const gradeName = (g: number) =>
  g === -1 ? "Pre-K" : g === 0 ? "K" : g === 1 ? "1st" : g === 2 ? "2nd" : g === 3 ? "3rd" : `${g}th`;
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
// The options form: each Registration Option on or off, with its fee (text, dollars) and its own close: with the
// program's registration, on a date, or a number of days before the event.
type CloseMode = "program" | "date" | "days";
type OptionsForm = Record<string, { on: boolean; fee: string; closes: CloseMode; closesOn: string; days: string }>;
const optionsForm = (list: ProgramOption[]): OptionsForm =>
  Object.fromEntries(
    REG_OPTIONS.map((o) => {
      const have = list.find((x) => x.kind === o.key);
      const closes: CloseMode = have?.closesOn ? "date" : have?.closesDaysBefore != null ? "days" : "program";
      return [
        o.key,
        {
          on: !!have,
          fee: dollars(have?.feeCents ?? null),
          closes,
          closesOn: have?.closesOn ?? "",
          days: have?.closesDaysBefore != null ? String(have.closesDaysBefore) : "",
        },
      ];
    }),
  );
const CLOSE_MODES: { key: CloseMode; label: string }[] = [
  { key: "program", label: "With registration" },
  { key: "date", label: "On a date" },
  { key: "days", label: "Days before" },
];

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
      const options = REG_OPTIONS.filter((o) => opts[o.key].on).map((o) => {
        const x = opts[o.key];
        return {
          kind: o.key,
          fee: x.fee,
          closesOn: x.closes === "date" ? x.closesOn : null,
          closesDaysBefore: x.closes === "days" ? x.days : null,
        };
      });
      const r = await saveProgram(program?.id ?? null, { ...f, options });
      if (!r.ok) return setError(r.message);
      close();
      if (program) router.refresh();
      else router.push(`/org/scenic-city/programs/${r.id}`);
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
                  <div key={o.key} className="rounded-xl p-2 ring-1 ring-zinc-950/5 dark:ring-white/10">
                  <div className="flex items-center gap-3">
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
                  {opts[o.key].on && (
                    // Its own close: with the program's registration, on a date, or days before the event.
                    <div className="mt-2 space-y-1.5 pl-6">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-zinc-500">Closes</span>
                        {CLOSE_MODES.map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => setOpts({ ...opts, [o.key]: { ...opts[o.key], closes: m.key } })}
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              opts[o.key].closes === m.key
                                ? "bg-scenic-navy text-white dark:bg-white dark:text-scenic-navy"
                                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      {opts[o.key].closes === "date" && (
                        <input
                          type="date"
                          aria-label={`${o.name} closes on`}
                          className={inputCls}
                          min={f.regOpens || undefined}
                          max={f.regCloses || undefined}
                          value={opts[o.key].closesOn}
                          onChange={(e) => setOpts({ ...opts, [o.key]: { ...opts[o.key], closesOn: e.target.value } })}
                        />
                      )}
                      {opts[o.key].closes === "days" && (
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            className={`${inputCls} w-20`}
                            inputMode="numeric"
                            aria-label={`${o.name} closes days before`}
                            value={opts[o.key].days}
                            onChange={(e) => setOpts({ ...opts, [o.key]: { ...opts[o.key], days: e.target.value } })}
                          />
                          <span className="text-zinc-600 dark:text-zinc-300">
                            days before {o.perDate ? "each Game Day picked" : "the first Game Day"}
                          </span>
                        </label>
                      )}
                    </div>
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

// A program's logo (nothing when it has none).
export function ProgramLogo({ src, className = "size-12" }: { src: string | null; className?: string }) {
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- an uploaded image served by /program-logo
  return <img src={src} alt="" className={`${className} shrink-0 rounded-xl object-contain`} />;
}

// Directors of Programs: add, change or remove the program's logo (PNG, JPEG or WebP, up to 512 KB).
export function ProgramLogoEditor({ id, logo }: { id: string; logo: string | null }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, start] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = (form: FormData) =>
    start(async () => {
      setError(null);
      const r = await setProgramLogo(id, form);
      if (!r.ok) return setError(r.message);
      ref.current?.close();
      setPreview(null);
      router.refresh();
    });
  return (
    <>
      <button
        type="button"
        className={`${smallBtn} text-scenic-navy ring-scenic-navy/30 dark:text-zinc-200 dark:ring-white/20`}
        onClick={() => ref.current?.showModal()}
      >
        {logo ? "Logo" : "+ Logo"}
      </button>
      <dialog ref={ref} className={dialogCls}>
        <form
          className="space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save(new FormData(e.currentTarget));
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Program logo</h2>
            <CloseButton onClick={() => ref.current?.close()} />
          </div>
          <span className={fieldLabel}>PNG, JPEG or WebP, up to 512 KB</span>
          <div className="flex items-center gap-3">
            {preview || logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the chosen file or the current logo
              <img
                src={preview ?? logo!}
                alt=""
                className="size-16 rounded-xl object-contain ring-1 ring-zinc-950/10"
              />
            ) : (
              <span className="grid size-16 place-items-center rounded-xl text-xs text-zinc-400 ring-1 ring-zinc-950/10 ring-dashed">
                None
              </span>
            )}
            <input
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
              className="min-w-0 text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </div>
          {error && <Alert tone="red">{error}</Alert>}
          <button type="submit" disabled={busy} className={`${navyBtn} w-full`}>
            {busy ? "Saving…" : "Save logo"}
          </button>
          {logo && (
            <button
              type="button"
              disabled={busy}
              className="w-full text-sm text-red-600 hover:underline"
              onClick={() => {
                const f = new FormData();
                f.set("remove", "1");
                save(f);
              }}
            >
              Remove logo
            </button>
          )}
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
            router.replace("/org/scenic-city/programs");
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
  league: { options: ProgramOption[]; gameDates: string[]; today: string;
  } | null;
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
  out: boolean; // sitting out now
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
              title: `${name}: sit out ${label}?`,
              message: "They stay listed (crossed out) and aren't scheduled. Back in puts them back.",
              confirmLabel: "Sit out",
            }))
          )
            return;
          start(async () => {
            const r = await setTeamOff(programId, teamId, what, !out);
            setMsg(r.ok ? `${name} ${out ? "back in" : "sitting out"} ${label}.` : r.message);
            if (r.ok) router.refresh();
          });
        }}
      >
        {out ? "Back in" : "Sit out"}
      </button>
      {msg && <Toast key={msg} message={msg} />}
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
            with Pool A. A registering team goes to the smallest pool of its grade and level (a 3rd/4th team plays as 4th). Coed
            Pre-K (ages 3 and 4) is its own division, REC only.
          </p>
          <div className="flex flex-wrap gap-2">
            {["Boys", "Girls"].map((g) => (
              <button
                key={g}
                type="button"
                className={pillCls(f.gender === g)}
                onClick={() => setF({ ...f, gender: g, ...(f.gender === "Coed" ? { from: "", to: "" } : {}) })}
              >
                {g}
              </button>
            ))}
            <button
              type="button"
              className={pillCls(f.gender === "Coed")}
              onClick={() => setF({ gender: "Coed", from: "-1", to: "", levels: ["REC"] })}
            >
              Coed Pre-K
            </button>
            <span className="w-2" />
            {["REC", "COMP"].map((l) => (
              <button
                key={l}
                type="button"
                disabled={f.gender === "Coed" && l === "COMP"}
                className={`${pillCls(f.levels.includes(l))} disabled:opacity-40`}
                onClick={() => setF({ ...f, levels: f.levels.includes(l) ? f.levels.filter((x) => x !== l) : [...f.levels, l] })}
              >
                {l}
              </button>
            ))}
          </div>
          {f.gender === "Coed" ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Pre-K (ages 3 and 4), Coed, REC.</p>
          ) : (
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
          )}
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

const menuItem =
  "block w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800";

// A registered team's "⋯" menu on the program page: Sit out / Back in (Admins and Directors of Scheduling: stays listed,
// crossed out, not scheduled) and Withdraw (Directors of Programs, or the team's own coach while registration is open:
// its registration is deleted). Each asks first; the server checks the role again.
export function TeamMenu({
  programId,
  teamId,
  name,
  canSitOut,
  out,
  canWithdraw,
  paid,
}: {
  programId: string;
  teamId: string;
  name: string;
  canSitOut: boolean;
  out: boolean; // sitting out now
  canWithdraw: boolean;
  paid: boolean | null; // Directors of Programs, when the program charges: Mark paid / Mark unpaid (null: not shown)
}) {
  const router = useRouter();
  // Where the menu shows (drawn on top of the page, under the ⋯ button, or above it near the bottom of the screen); null: closed.
  const [at, setAt] = useState<{ top?: number; bottom?: number; right: number;
  } | null>(null);
  const open = !!at;
  const setOpen = (on: boolean) => {
    const r = button.current?.getBoundingClientRect();
    if (!on || !r) return setAt(null);
    const right = window.innerWidth - r.right;
    setAt(r.bottom + 180 > window.innerHeight ? { bottom: window.innerHeight - r.top + 6, right } : { top: r.bottom + 6, right });
  };
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) =>
      !menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node) && setAt(null);
    const close = () => setAt(null);
    document.addEventListener("pointerdown", away);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  if (!canSitOut && !canWithdraw && paid === null) return null;

  const togglePaid = () => {
    setOpen(false);
    start(async () => {
      const r = await setPaid(programId, teamId, !paid);
      setMsg(r.ok ? `${name} marked ${paid ? "unpaid" : "paid"}.` : r.message);
      if (r.ok) router.refresh();
    });
  };

  const sitOut = async () => {
    setOpen(false);
    if (
      !out &&
      !(await confirm({
        title: `${name}: sit out the program?`,
        message: "They stay listed (crossed out) with their registration, and aren't scheduled. Back in puts them back.",
        confirmLabel: "Sit out",
      }))
    )
      return;
    start(async () => {
      const r = await setTeamOff(programId, teamId, "program", !out);
      setMsg(r.ok ? `${name} ${out ? "is back in" : "is sitting out"}.` : r.message);
      if (r.ok) router.refresh();
    });
  };
  const withdraw = async () => {
    setOpen(false);
    if (
      !(await confirm({
        title: `Withdraw ${name}?`,
        message: "Its registration in this program is deleted: dates, pool and fee. To come back it registers again.",
        confirmLabel: "Withdraw",
        tone: "danger",
      }))
    )
      return;
    start(async () => {
      const r = await withdrawTeam(programId, teamId);
      setMsg(r.ok ? `${name} withdrawn.` : r.message);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${name}`}
        disabled={busy}
        onClick={() => setOpen(!open)}
        className="rounded-full px-3 py-1 text-base leading-none font-semibold text-zinc-600 ring-1 ring-zinc-950/15 disabled:opacity-50 dark:text-zinc-300 dark:ring-white/20"
      >
        ⋯
      </button>
      {at && (
        <OnPage>
          <div
            ref={menu}
            role="menu"
            style={at}
            className="fixed z-50 w-64 max-w-[calc(100vw-2rem)] rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15"
          >
            {paid !== null && (
              <button type="button" role="menuitem" className={menuItem} onClick={togglePaid}>
                <span className="font-semibold">{paid ? "Mark unpaid" : "Mark paid"}</span>
                <span className="block text-xs text-zinc-500">
                  {paid ? "Paid now." : "UNPAID shows behind the team until it's paid."}
                </span>
              </button>
            )}
            {canSitOut && (
              <button type="button" role="menuitem" className={menuItem} onClick={sitOut}>
                <span className="font-semibold">{out ? "Back in" : "Sit out"}</span>
                <span className="block text-xs text-zinc-500">
                  {out ? "Put them back in the program to be scheduled." : "Stays listed, crossed out; not scheduled."}
                </span>
              </button>
            )}
            {canWithdraw && (
              <button type="button" role="menuitem" className={menuItem} onClick={withdraw}>
                <span className="font-semibold text-red-600 dark:text-red-400">Withdraw</span>
                <span className="block text-xs text-zinc-500">Delete the registration: dates, pool and fee.</span>
              </button>
            )}
          </div>
        </OnPage>
      )}
      {msg && <Toast key={msg} message={msg} />}
      {confirmDialog}
    </div>
  );
}

// Publish schedule (Directors of Programs, Leagues): the schedule shows on the public League page, or is taken back.
export function PublishSchedule({ programId, by, who }: { programId: string; by: string | null; who: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const on = by !== null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (
            !(await confirm(
              on
                ? {
                    title: "Unpublish the schedule?",
                    message: "The public League page stops showing the schedule (teams still show).",
                    confirmLabel: "Unpublish",
                  }
                : {
                    title: "Publish the schedule?",
                    message:
                      "Anyone with the League page link sees every game: dates, times, gyms and teams. No contact info.",
                    confirmLabel: "Publish",
                  },
            ))
          )
            return;
          start(async () => {
            const r = await setSchedulePublished(programId, !on);
            if (r.ok) router.refresh();
            else setMsg(r.message);
          });
        }}
        className={`rounded-full px-3 py-1.5 font-medium ring-1 disabled:opacity-50 ${
          on
            ? "bg-emerald-50 text-emerald-800 ring-emerald-600/30 dark:bg-emerald-500/10 dark:text-emerald-300"
            : "text-zinc-700 ring-zinc-950/15 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20"
        }`}
      >
        {on ? "Schedule published ✓" : "Publish schedule"}
      </button>
      <a href={`/league/scenic-city?l=${programId}`} target="_blank" className="text-thunder-blue hover:underline">
        Public page ↗
      </a>
      {on && who && <span className="text-xs text-zinc-400">by {by}</span>}
      {msg && <Toast key={msg} message={msg} />}
      {confirmDialog}
    </div>
  );
}

export type GradeChip = { grade: number; on: boolean; teams: number };
export type GradeRow = { gender: "Boys" | "Girls" | "Coed"; level: "REC" | "COMP"; grades: GradeChip[] };

// Directors of Programs: which grades the program accepts in REC and in COMP, Boys and Girls separately. Each chip is a
// grade in one of the gender's divisions; tap to turn it on or off (off is refused while teams are in it).
export function GradesAccepted({ programId, rows }: { programId: string; rows: GradeRow[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={`${row.gender}-${row.level}`}>
          <p className={fieldLabel}>
            {row.gender} {row.level}
          </p>
          {row.grades.length ? (
            <div className="flex flex-wrap gap-1.5">
              {row.grades.map((c) => (
                <button
                  key={c.grade}
                  type="button"
                  disabled={busy}
                  aria-pressed={c.on}
                  title={c.teams ? `${c.teams} team${c.teams === 1 ? "" : "s"}` : undefined}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const r = await setGradeLevel(programId, {
                        gender: row.gender,
                        grade: c.grade,
                        level: row.level,
                        on: !c.on,
                      });
                      if (r.ok) router.refresh();
                      else setError(r.message);
                    })
                  }
                  className={`${pillCls(c.on)} min-w-11 px-3 py-1.5 disabled:opacity-60`}
                >
                  {c.grade === -1 ? "Pre-K" : c.grade === 0 ? "K" : c.grade}
                  {c.teams > 0 && <span className="ml-1 text-xs opacity-75">·{c.teams}</span>}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No {row.gender} divisions yet.</p>
          )}
        </div>
      ))}
      <p className="text-xs text-zinc-500">
        Blue = accepted. ·2 = teams in it. Coed is Pre-K, REC only. A grade not shown needs a division first.
      </p>
      {error && <Toast key={error} message={error} />}
    </div>
  );
}

// Directors of Programs: the program's gear: Edit (dates, registration, options), Logo, Grades accepted, Delete.
export function ProgramSettings({
  program,
  logo,
  teams,
  grades,
  rec,
}: {
  program: ProgramFields;
  logo: string | null;
  teams: number;
  grades: GradeRow[] | null; // null: no divisions yet
  rec: RecLimitView;
}) {
  return (
    <PopUp
      label={<GearIcon className="size-5" />}
      ariaLabel={`${program.name} settings`}
      title={`${program.name} settings`}
      className="shrink-0 rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {() => (
        <ul className="divide-y divide-zinc-100 dark:divide-white/5">
          <li className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">Type, name, dates, registration and options</span>
            <ProgramEditor program={program} />
          </li>
          <li className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">The program&apos;s logo</span>
            <ProgramLogoEditor id={program.id} logo={logo} />
          </li>
          <li className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              Grades accepted
              <span className="block text-xs text-zinc-500">
                {grades ? gradesSummary(grades) : "Add a division first"}
              </span>
            </span>
            {grades && (
              <PopUp label="Edit" title="Grades accepted" className={editBtn}>
                {() => <GradesAccepted programId={program.id} rows={grades} />}
              </PopUp>
            )}
          </li>
          <li className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              REC open to
              <span className="block text-xs text-zinc-500">
                {rec.limited
                  ? `${rec.partners.length} invited organization${rec.partners.length === 1 ? "" : "s"}`
                  : "Everyone"}
              </span>
            </span>
            <PopUp label="Edit" title="REC open to" className={editBtn}>
              {(close) => <RecLimitEditor programId={program.id} rec={rec} onSaved={close} />}
            </PopUp>
          </li>
          {/* Delete only with no teams registered (the server refuses it too). */}
          {teams === 0 && (
            <li className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-sm text-zinc-600 dark:text-zinc-300">Delete the program</span>
              <DeleteProgram id={program.id} name={program.name} teams={0} />
            </li>
          )}
        </ul>
      )}
    </PopUp>
  );
}

const editBtn = `${smallBtn} text-scenic-navy ring-scenic-navy/30 dark:text-zinc-200 dark:ring-white/20`;

// One line for the gear: the grades on per row that has any ("Boys REC K–9 · Boys COMP 2–9 …").
function gradesSummary(rows: GradeRow[]) {
  const name = (g: number) => (g === -1 ? "Pre-K" : g === 0 ? "K" : String(g));
  const parts = rows.flatMap((r) => {
    const on = r.grades.filter((c) => c.on).map((c) => c.grade);
    if (!on.length) return [];
    const runs: string[] = [];
    for (let i = 0; i < on.length; i++) {
      let j = i;
      while (j + 1 < on.length && on[j + 1] === on[j] + 1) j++;
      runs.push(i === j ? name(on[i]) : `${name(on[i])}–${name(on[j])}`);
      i = j;
    }
    return [`${r.gender === "Coed" ? "Coed" : r.gender} ${r.level} ${runs.join(", ")}`];
  });
  return parts.length ? parts.join(" · ") : "None yet";
}

export type RecLimitView = {
  limited: boolean;
  by: string | null; // who limited it (shown to Owners and Admins)
  partners: string[];
  choices: { id: string; name: string }[];
};

// Directors of Programs: REC open to everyone, or only the organizations picked. COMP stays open to all; stand-alone
// teams can't register REC while it's limited. Teams already registered stay.
function RecLimitEditor({ programId, rec, onSaved }: { programId: string; rec: RecLimitView; onSaved: () => void }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [limited, setLimited] = useState(rec.limited);
  // Only organizations still on the list (one that lost CourtOrg or CourtSync drops off when saved).
  const [picked, setPicked] = useState<string[]>(rec.partners.filter((x) => rec.choices.some((c) => c.id === x)));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed =
    limited !== rec.limited || (limited && (picked.length !== rec.partners.length || picked.some((x) => !rec.partners.includes(x))));
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setMsg(null);
          const r = await setRecLimit(programId, limited, limited ? picked : []);
          if (!r.ok) return setMsg({ ok: false, text: r.message });
          router.refresh();
          onSaved();
        });
      }}
    >
      <div className="flex gap-2">
        <button type="button" className={`${pillCls(!limited)} px-3 py-1.5`} onClick={() => setLimited(false)}>
          Everyone
        </button>
        <button type="button" className={`${pillCls(limited)} px-3 py-1.5`} onClick={() => setLimited(true)}>
          Only these organizations
        </button>
      </div>
      {limited && !rec.choices.length && (
        <p className="text-sm text-zinc-500">No organization has CourtOrg and CourtSync yet.</p>
      )}
      {limited && rec.choices.length > 0 && (
        <ul className="max-h-56 divide-y divide-zinc-100 overflow-y-auto rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
          {rec.choices.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={picked.includes(c.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))}
                />
                {c.name}
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-zinc-500">
        Organizations with CourtOrg and CourtSync. COMP stays open to all. While REC is limited, stand-alone teams can&apos;t
        register REC. Teams already registered stay.
        {rec.by && ` Limited by ${rec.by}.`}
      </p>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <button type="submit" disabled={busy || !changed || (limited && !picked.length)} className={navyBtn}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
