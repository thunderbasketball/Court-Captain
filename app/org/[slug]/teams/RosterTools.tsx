"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GRADES } from "@/lib/team-names";
import { COLUMN_KINDS, COLUMN_LABEL, guessColumns, splitRows, type ColumnKind } from "@/lib/roster-columns";
import { Alert, PopUp, Toast, useConfirm } from "../../../client-ui";
import { fieldLabel, inputCls, primaryBtn } from "../../../ui";
import { addPlayer, importPlayers, previewPlayers, recheckPlayers, removePlayer, setPlayerBirthdate, setPlayerInfo } from "./actions";
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

const plain = ({ line, first, last, grade, jersey, birthdate }: Row) => ({ line, first, last, grade, jersey, birthdate });

// One Preview row opened: its five fields to change; Save checks it again (and every row), Remove leaves it out.
function RowEditor({
  row,
  busy,
  onSave,
  onRemove,
  onCancel,
}: {
  row: Row;
  busy: boolean;
  onSave: (r: Pick<Row, "first" | "last" | "grade" | "jersey" | "birthdate">) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState({ first: row.first, last: row.last, grade: row.grade, jersey: row.jersey, birthdate: row.birthdate });
  const gradeKnown = (GRADES as readonly string[]).includes(p.grade);
  return (
    <form
      className="grid gap-2 border-t border-zinc-100 px-3 py-3 dark:border-white/5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(p);
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={fieldLabel}>First name</span>
          <input className={inputCls} value={p.first} onChange={(e) => setP({ ...p, first: e.target.value })} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Last name</span>
          <input className={inputCls} value={p.last} onChange={(e) => setP({ ...p, last: e.target.value })} />
        </label>
        <label className="block">
          <span className={fieldLabel}>Grade</span>
          <select className={inputCls} value={gradeKnown ? p.grade : ""} onChange={(e) => setP({ ...p, grade: e.target.value })}>
            <option value="">{p.grade && !gradeKnown ? `“${p.grade}”: pick one` : "Pick…"}</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g === "K" ? "K" : g}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Jersey (optional)</span>
          <input className={inputCls} inputMode="numeric" value={p.jersey} onChange={(e) => setP({ ...p, jersey: e.target.value })} />
        </label>
        <label className="col-span-2 block">
          <span className={fieldLabel}>Birthdate</span>
          <input className={inputCls} placeholder="5/3/2016" value={p.birthdate} onChange={(e) => setP({ ...p, birthdate: e.target.value })} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={`${primaryBtn} flex-1`}>
          {busy ? "Checking…" : "Save"}
        </button>
        <button type="button" className="text-sm text-zinc-500" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" disabled={busy} className="text-sm text-red-600 dark:text-red-400" onClick={onRemove}>
          Leave out
        </button>
      </div>
    </form>
  );
}

// Import players: paste rows (First, Last, Grade, Jersey, Birthdate) or choose a CSV file, Preview, then add the new ones.
// `org` null: a League team kept by the League (FastBreak, a club, Solo).
export function ImportPlayersButton({ org, teamId }: { org: string | null; teamId: string }) {
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

function ImportForm({ org, teamId, onDone }: { org: string | null; teamId: string; onDone: (msg: string) => void }) {
  const [text, setTextRaw] = useState("");
  // Which column holds what: guessed from the rows each time they change, then changed by hand as needed.
  const [layout, setLayout] = useState<{ columns: ColumnKind[]; header: boolean }>({ columns: [], header: false });
  const setText = (t: string) => {
    setTextRaw(t);
    const g = guessColumns(splitRows(t));
    setLayout((old) => (old.columns.length === g.columns.length && t.trim() && text.trim() ? old : g));
  };
  const sample = splitRows(text).slice(0, 4);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [open, setOpen] = useState<number | null>(null);
  const fresh = rows?.filter((r) => r.status === "new") ?? [];
  // A row fixed (or taken out) by hand: all rows checked again on the server, the next one to fix opened.
  const recheck = (next: Row[]) =>
    start(async () => {
      setError(null);
      if (!next.length) return setRows(null);
      const r = await recheckPlayers(org, teamId, next.map(plain));
      if (!r.ok) return setError(r.message);
      setRows(r.rows);
      const nextFix = r.rows.findIndex((x) => x.status === "error");
      setOpen(nextFix >= 0 ? nextFix : null);
    });
  if (rows)
    return (
      <div className="grid gap-3">
        <p className="text-sm">
          <span className="font-semibold">{fresh.length} new</span>
          {rows.length - fresh.length > 0 && <span className="text-zinc-500"> · {rows.length - fresh.length} skipped</span>}
        </p>
        <ul className="max-h-[28rem] divide-y divide-zinc-100 overflow-y-auto rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
          {rows.map((r, i) => (
            <li key={`${r.line}-${i}`} className={`text-sm ${r.status === "new" ? "" : "bg-zinc-50 dark:bg-zinc-800/40"}`}>
              <button
                type="button"
                className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span className={r.status === "new" ? "font-medium" : "text-zinc-500"}>
                  {`${r.first} ${r.last}`.trim() || `Row ${r.line}`}
                  <span className="font-normal text-zinc-500">
                    {r.grade && ` · ${r.grade}`}
                    {r.jersey && ` · #${r.jersey.replace(/^#/, "")}`}
                    {r.birthdate ? ` · born ${r.birthdate}` : " · no birthdate"}
                  </span>
                  {r.errors.length > 0 && <span className="block text-xs font-normal text-red-600 dark:text-red-400">{r.errors.join(" · ")}</span>}
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
                  {r.status === "new" ? "New" : r.status === "exists" ? "On the team" : open === i ? "Fix ▾" : "Fix ›"}
                </span>
              </button>
              {open === i && (
                <RowEditor
                  row={r}
                  busy={busy}
                  onCancel={() => setOpen(null)}
                  onRemove={() => recheck(rows.filter((_, j) => j !== i))}
                  onSave={(fixed) => recheck(rows.map((x, j) => (j === i ? { ...x, ...fixed } : x)))}
                />
              )}
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
              const r = await importPlayers(org, teamId, rows.map(plain));
              if (!r.ok) return setError(r.message);
              onDone(
                `${r.added.length} player${r.added.length === 1 ? "" : "s"} added${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}.`,
              );
            })
          }
        >
          {busy ? "Adding…" : fresh.length ? `Add ${fresh.length} player${fresh.length === 1 ? "" : "s"}` : "Nothing new to add"}
        </button>
        <button type="button" className="text-sm text-zinc-500" onClick={() => {
            setRows(null);
            setOpen(null);
          }}>
          ← Back to the rows and columns
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
          const r = await previewPlayers(org, teamId, text, layout);
          if (!r.ok) return setError(r.message);
          setRows(r.rows);
          const firstFix = r.rows.findIndex((x) => x.status === "error");
          setOpen(firstFix >= 0 && r.rows.filter((x) => x.status === "error").length <= 3 ? firstFix : null);
        });
      }}
    >
      <p className="text-sm text-zinc-500">
        One player per row, in any column order: names, grade, jersey (optional) and birthdate (like 5/3/2014; players without one are
        warned about). Paste from a spreadsheet or choose a CSV file, then say what each column holds.
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
        placeholder={"Ava Smith\t5/3/2016\t4\t12\nLiam Jones\t9/21/2015\t4th"}
        spellCheck={false}
      />
      {layout.columns.length > 0 && sample.length > 0 && (
        <div className="grid gap-2">
          <p className={fieldLabel}>What&apos;s in each column?</p>
          {layout.columns.map((kind, i) => {
            const eg = sample.slice(layout.header ? 1 : 0).find((r) => r[i]?.trim())?.[i];
            return (
              <label key={i} className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="text-zinc-500">Column {i + 1}</span>
                  {layout.header && sample[0]?.[i] && <span className="font-medium"> · {sample[0][i]}</span>}
                  {eg && <span className="text-zinc-500"> · e.g. {eg}</span>}
                </span>
                <select
                  className={`${inputCls} w-36`}
                  value={kind}
                  onChange={(e) =>
                    setLayout((l) => ({ ...l, columns: l.columns.map((c, j) => (j === i ? (e.target.value as ColumnKind) : c)) }))
                  }
                >
                  {COLUMN_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {COLUMN_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={layout.header} onChange={(e) => setLayout((l) => ({ ...l, header: e.target.checked }))} />
            The first row is column names (skip it)
          </label>
        </div>
      )}
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
  org: string | null; // null: a League team kept by the League
 
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

// A player's name and grade, in their opened row: Edit name or grade opens the fields right there.
export function PlayerInfo({
  org,
  teamId,
  player,
}: {
  org: string | null; // null: a League team kept by the League
  teamId: string;
  player: { id: string; first: string; last: string; grade: number | null };
}) {
  const router = useRouter();
  const was = { first: player.first, last: player.last, grade: player.grade === null ? "" : player.grade === 0 ? "K" : String(player.grade) };
  const gradeKnown = (GRADES as readonly string[]).includes(was.grade);
  const [editing, setEditing] = useState(false);
  const [p, setP] = useState(was);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!editing)
    return (
      <button type="button" onClick={() => setEditing(true)} className="block text-xs font-medium text-thunder-blue dark:text-blue-400">
        Edit name or grade
      </button>
    );
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setErr(null);
          const r = await setPlayerInfo(org, teamId, player.id, { ...p, grade: (GRADES as readonly string[]).includes(p.grade) ? p.grade : "" });
          if (!r.ok) return setErr(r.message);
          setEditing(false);
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-[1fr_1fr_5rem] gap-2">
        <input aria-label="First name" className={inputCls} value={p.first} onChange={(e) => setP({ ...p, first: e.target.value })} required />
        <input aria-label="Last name" className={inputCls} value={p.last} onChange={(e) => setP({ ...p, last: e.target.value })} required />
        <select aria-label="Grade" className={inputCls} value={p.grade} onChange={(e) => setP({ ...p, grade: e.target.value })}>
          {!gradeKnown && <option value={was.grade}>{was.grade === "-1" ? "Pre-K" : "Grade"}</option>}
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded-full bg-thunder-blue px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="text-xs text-zinc-500"
          onClick={() => {
            setP(was);
            setEditing(false);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
