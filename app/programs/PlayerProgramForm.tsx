"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlayerProgramFields } from "@/lib/player-programs";
import { Alert } from "../client-ui";
import { fieldLabel, inputCls, primaryBtn } from "../ui";
import { changePlayerProgram, removePlayerProgram } from "./actions";

const EMPTY = { name: "", regOpens: "", regCloses: "", payOpens: "", payCloses: "", seasonFrom: "", startsOn: "", endsOn: "" };

// A player program's form, right in its card (no pop-up): name, registration and payment dates, and the season's
// dates typed in or taken from a team program. `program` to change one; without it, a new one.
export default function PlayerProgramForm({
  org,
  program,
  sources,
  onDone,
  canDelete = false,
}: {
  canDelete?: boolean; // empty (no players, no Sessions): Delete shows
  org: string;
  program?: PlayerProgramFields;
  sources: { id: string; name: string; startsOn: string; endsOn: string }[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState(program ?? EMPTY);
  const [follow, setFollow] = useState(!!program?.seasonFrom || (!program && sources.length > 0));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sure, setSure] = useState(false); // Delete asks right here first
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const date = (k: keyof typeof EMPTY, label: string, required = false) => (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      <input type="date" className={inputCls} value={f[k]} onChange={set(k)} required={required} />
    </label>
  );
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const seasonFrom = follow ? f.seasonFrom || sources[0]?.id || "" : "";
        const r = await changePlayerProgram(org, program?.id ?? null, {
          ...f,
          seasonFrom,
          startsOn: follow ? "" : f.startsOn,
          endsOn: follow ? "" : f.endsOn,
        });
        setBusy(false);
        if (!r.ok) return setMsg({ ok: false, text: r.message });
        setMsg({ ok: true, text: "Saved ✓" });
        if (!program) setF(EMPTY);
        router.refresh();
        onDone?.();
      }}
    >
      <p className="text-sm font-semibold">{program ? `Change ${program.name}` : "New season (players register)"}</p>
      <label className="block">
        <span className={fieldLabel}>Name</span>
        <input className={inputCls} value={f.name} onChange={set("name")} maxLength={80} required placeholder="Spring 2027" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        {date("regOpens", "Registration opens", true)}
        {date("regCloses", "Registration closes (optional)")}
        {date("payOpens", "Payments open (optional)")}
        {date("payCloses", "Payments close (optional)")}
      </div>
      <fieldset className="space-y-2">
        <legend className={fieldLabel}>Season dates</legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {sources.length > 0 && (
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={follow} onChange={() => setFollow(true)} /> From a League, Circuit or Tournament
            </label>
          )}
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!follow} onChange={() => setFollow(false)} /> Type them in
          </label>
        </div>
        {follow ? (
          <select className={inputCls} value={f.seasonFrom || sources[0]?.id || ""} onChange={set("seasonFrom")} aria-label="Season follows">
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.startsOn} – {s.endsOn})
              </option>
            ))}
          </select>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {date("startsOn", "Season starts", true)}
            {date("endsOn", "Season ends", true)}
          </div>
        )}
      </fieldset>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Saving…" : program ? "Save" : "Add program"}
      </button>
      {program && canDelete && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          {sure ? (
            <>
              <span className="text-zinc-600 dark:text-zinc-300">Delete {program.name}?</span>
              <button type="button" onClick={() => setSure(false)} className="rounded-full px-3 py-1 ring-1 ring-zinc-950/10 dark:ring-white/15">
                Keep it
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await removePlayerProgram(org, program.id);
                  setBusy(false);
                  if (!r.ok) return setMsg({ ok: false, text: r.message });
                  router.refresh();
                }}
                className="rounded-full bg-red-600 px-3 py-1 font-semibold text-white"
              >
                Delete
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setSure(true)} className="font-medium text-red-600 dark:text-red-400">
              Delete program
            </button>
          )}
        </div>
      )}
    </form>
  );
}
