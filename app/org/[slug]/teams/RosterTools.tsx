"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GRADES } from "@/lib/team-names";
import { Alert, PopUp, Toast, useConfirm } from "../../../client-ui";
import { fieldLabel, inputCls, primaryBtn } from "../../../ui";
import { addPlayer, importPlayers, previewPlayers, removePlayer, setPlayerBirthdate } from "./actions";
import { AddPlayersIcon, ImportIcon, addIconBtn, iconBtn } from "../../../CardIcons";


// + Add player: first, last, grade, birthdate, optional jersey number. The pop-up stays open to add the next one.
export function AddPlayerButton({ org, teamId }: { org: string; teamId: string }) {
  const router = useRouter();
  const [p, setP] = useState({ first: "", last: "", grade: "", jersey: "", birthdate: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <PopUp label={<AddPlayersIcon />} ariaLabel="Add a player" title="Add a player" className={addIconBtn}>
      {() => (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await addPlayer(org, teamId, p);
              if (!r.ok) return setError(r.message);
              setDone(`${p.first} ${p.last} added. Add another, or close.`);
              setP({ first: "", last: "", grade: p.grade, jersey: "", birthdate: "" });
              router.refresh();
            });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={fieldLabel}>First name</span>
              <input className={inputCls} value={p.first} onChange={(e) => setP({ ...p, first: e.target.value })} required />
            </label>
            <label className="block">
              <span className={fieldLabel}>Last name</span>
              <input className={inputCls} value={p.last} onChange={(e) => setP({ ...p, last: e.target.value })} required />
            </label>
            <label className="block">
              <span className={fieldLabel}>Grade</span>
              <select className={inputCls} value={p.grade} onChange={(e) => setP({ ...p, grade: e.target.value })} required>
                <option value="" disabled>
                  Pick…
                </option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>Birthdate</span>
              <input
                className={inputCls}
                type="date"
                min="1990-01-01"
                max="2035-12-31"
                value={p.birthdate}
                onChange={(e) => setP({ ...p, birthdate: e.target.value })}
                required
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>Jersey # (optional)</span>
              <input
                className={inputCls}
                inputMode="numeric"
                maxLength={2}
                value={p.jersey}
                onChange={(e) => setP({ ...p, jersey: e.target.value })}
              />
            </label>
          </div>
          {error && <Alert tone="red">{error}</Alert>}
          {done && <Alert tone="green">{done}</Alert>}
          <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
            {busy ? "Adding…" : "Add player"}
          </button>
        </form>
      )}
    </PopUp>
  );
}

type Row = {
  line: number;
  first: string;
  last: string;
  grade: string;
  jersey: string;
  birthdate: string;
  errors: string[];
  status: "new" | "exists" | "error";
};

// Import players: paste rows (First, Last, Grade, Jersey, Birthdate) or choose a CSV file, Preview, then add the new ones.
export function ImportPlayersButton({ org, teamId }: { org: string; teamId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <PopUp label={<ImportIcon />} ariaLabel="Import players" title="Import players" className={iconBtn}>
        {(close) => (
          <ImportForm
            org={org}
            teamId={teamId}
            onDone={(text) => {
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

function ImportForm({ org, teamId, onDone }: { org: string; teamId: string; onDone: (msg: string) => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const fresh = rows?.filter((r) => r.status === "new") ?? [];
  if (rows)
    return (
      <div className="grid gap-3">
        <p className="text-sm">
          <span className="font-semibold">{fresh.length} new</span>
          {rows.length - fresh.length > 0 && <span className="text-zinc-500"> · {rows.length - fresh.length} skipped</span>}
        </p>
        <ul className="max-h-80 divide-y divide-zinc-100 overflow-y-auto rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
          {rows.map((r) => (
            <li key={r.line} className={`px-3 py-2 text-sm ${r.status === "new" ? "" : "bg-zinc-50 dark:bg-zinc-800/40"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className={r.status === "new" ? "font-medium" : "text-zinc-500"}>
                  {`${r.first} ${r.last}`.trim() || `Row ${r.line}`}
                  <span className="font-normal text-zinc-500">
                    {r.grade && ` · ${r.grade}`}
                    {r.jersey && ` · #${r.jersey.replace(/^#/, "")}`}
                    {r.birthdate ? ` · born ${r.birthdate}` : " · no birthdate"}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    r.status === "new"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : r.status === "exists"
                        ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                  }`}
                >
                  {r.status === "new" ? "New" : r.status === "exists" ? "On the team" : "Fix"}
                </span>
              </div>
              {r.errors.length > 0 && <p className="text-xs text-red-600 dark:text-red-400">{r.errors.join(" · ")}</p>}
            </li>
          ))}
        </ul>
        {error && <Alert tone="red">{error}</Alert>}
        <button
          type="button"
          disabled={busy || !fresh.length}
          className={`${primaryBtn} w-full`}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await importPlayers(org, teamId, text);
              if (!r.ok) return setError(r.message);
              onDone(
                `${r.added.length} player${r.added.length === 1 ? "" : "s"} added${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}.`,
              );
            })
          }
        >
          {busy ? "Adding…" : fresh.length ? `Add ${fresh.length} player${fresh.length === 1 ? "" : "s"}` : "Nothing new to add"}
        </button>
        <button type="button" className="text-sm text-zinc-500" onClick={() => setRows(null)}>
          ← Back to edit
        </button>
      </div>
    );
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await previewPlayers(org, teamId, text);
          if (!r.ok) return setError(r.message);
          setRows(r.rows);
        });
      }}
    >
      <p className="text-sm text-zinc-500">
        One player per row: <span className="font-medium text-zinc-700 dark:text-zinc-300">First, Last, Grade, Jersey, Birthdate</span>{" "}
        (jersey optional; birthdate like 5/3/2014, and players without one are warned about). Paste from a spreadsheet or choose a CSV file.
      </p>
      <input
        type="file"
        accept=".csv,text/csv,text/plain"
        className="text-sm"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setText(await f.text());
        }}
      />
      <textarea
        className={`${inputCls} min-h-40 font-mono text-xs`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"First,Last,Grade,Jersey,Birthdate\nAva,Smith,4,12,5/3/2016\nLiam,Jones,4th,,2015-09-21"}
        spellCheck={false}
      />
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy || !text.trim()} className={`${primaryBtn} w-full`}>
        {busy ? "Checking…" : "Preview"}
      </button>
    </form>
  );
}

export function RemovePlayerButton({
  org,
  teamId,
  playerId,
  name,
}: {
  org: string;
  teamId: string;
  playerId: string;
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
              message: "Are you sure? They come off the roster.",
              confirmLabel: "Remove",
            }))
          )
            return;
          start(async () => {
            const r = await removePlayer(org, teamId, playerId);
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

// A player's birthdate on the roster: shown, or "Birthdate missing" in red; whoever can change the roster fills it in
// (or fixes it) right here.
export function PlayerBirthdate({
  org,
  teamId,
  playerId,
  birthdate,
  canEdit,
}: {
  org: string;
  teamId: string;
  playerId: string;
  birthdate: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(birthdate ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const shown = birthdate
    ? new Date(`${birthdate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : null;
  if (!editing)
    return (
      <span className="flex items-center gap-2 text-xs">
        {shown ? <span className="text-zinc-500">Born {shown}</span> : <span className="font-semibold text-red-600 dark:text-red-400">Birthdate missing</span>}
        {canEdit && (
          <button type="button" onClick={() => setEditing(true)} className="font-medium text-thunder-blue dark:text-blue-400">
            {shown ? "Change" : "Add"}
          </button>
        )}
      </span>
    );
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <input
        type="date"
        min="1990-01-01"
        max="2035-12-31"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-white/15 dark:bg-zinc-900"
      />
      <button
        type="button"
        disabled={busy || !value}
        onClick={() =>
          start(async () => {
            const r = await setPlayerBirthdate(org, teamId, playerId, value);
            if (!r.ok) return setErr(r.message);
            setEditing(false);
            router.refresh();
          })
        }
        className="rounded-full bg-thunder-blue px-3 py-1 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-zinc-500">
        Cancel
      </button>
      {err && <span className="text-red-600 dark:text-red-400">{err}</span>}
    </span>
  );
}
