"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeCardPanel } from "../CardIcons";
import { addOfficialAction, importOfficialsAction, previewOfficialsAction, removeOfficialAction, setOfficialLevelAction } from "./actions";
import type { OfficialImportRow } from "@/lib/officials";
import { OFFICIAL_LEVELS } from "@/lib/official-levels";
import { OFFICIAL_FIELDS, guessOfficialColumns, officialTableText, type OfficialField } from "@/lib/official-import-parse";
import { splitTable } from "@/lib/team-import-parse";
import { formatCell } from "@/lib/phone";
import { Alert } from "../client-ui";
import { inputCls, primaryBtn } from "../ui";

const input = "min-w-0 rounded-lg bg-white px-3 py-2 text-base ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15";

// The + on the Officials card opens this at the top of the card: first, last, cell (the last 7 digits are their User ID),
// email and Level (both optional). Someone with that cell is added as is; anyone else gets a login (they finish it at
// first sign-in).
export function AddOfficialForm({ org, panel }: { org: string; panel: string }) {
  const router = useRouter();
  const blank = { first: "", last: "", cell: "", email: "", level: "" };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addOfficialAction(org, f);
          setMsg(
            r.ok
              ? { ok: true, text: `${r.name} added${r.newLogin ? " (a new login: they sign in with their cell)" : ""}.` }
              : { ok: false, text: r.message },
          );
          if (r.ok) {
            setF(blank);
            router.refresh();
            setTimeout(() => closeCardPanel(panel), 1500); // a moment to read it, then the panel closes
          }
        });
      }}
    >
      <p className="text-sm font-semibold">Add an official</p>
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="First name" aria-label="First name" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} />
        <input className={input} placeholder="Last name" aria-label="Last name" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} />
        <input
          className={`${input} col-span-2`}
          placeholder="Cell"
          aria-label="Cell"
          inputMode="tel"
          value={f.cell}
          onChange={(e) => setF({ ...f, cell: e.target.value })}
        />
        <input
          className={`${input} col-span-2`}
          placeholder="Email (optional)"
          aria-label="Email"
          type="email"
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
        />
        <select className={`${input} col-span-2`} aria-label="Level" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>
          <option value="">Level…</option>
          {OFFICIAL_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l === "Recruit" ? "Recruit (can't be scheduled yet)" : l}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={busy || !f.first.trim() || !f.last.trim() || !f.cell.trim()}
        className="rounded-full bg-thunder-blue px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add official"}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
    </form>
  );
}

// Remove, asking right here first.
export function RemoveOfficial({ org, coachId, name }: { org: string; coachId: string; name: string }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!sure)
    return (
      <button type="button" onClick={() => setSure(true)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
        Remove
      </button>
    );
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span>Remove {name} from your officials?</span>
      <button type="button" onClick={() => setSure(false)} className="rounded-full px-2.5 py-1 ring-1 ring-zinc-950/10 dark:ring-white/15">
        Keep
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await removeOfficialAction(org, coachId);
            if (r.ok) router.refresh();
            else setMsg(r.message);
          })
        }
        className="rounded-full bg-red-600 px-2.5 py-1 font-semibold text-white disabled:opacity-50"
      >
        Remove
      </button>
      {msg && <span className="text-red-600 dark:text-red-400">{msg}</span>}
    </span>
  );
}

// Import a list (under Add an official, in the same + panel), in three steps like the teams import: paste rows from a
// spreadsheet or choose a CSV file; check which column is which (matched by heading or by what's in it); then see exactly
// what will be added, cleaned up ("SMITH" → Smith, "cert" → Certified), edit any row, and add. The server checks it all
// again.
export function ImportOfficialsForm({ org }: { org: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0); // a fresh form after each import
  const [done, setDone] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-thunder-blue hover:underline dark:text-blue-400">
        Or import a list (paste or CSV file) ›
      </button>
    );
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Import officials</p>
        <button type="button" onClick={() => (setOpen(false), setDone(null), setRound((n) => n + 1))} className="text-sm text-zinc-500">
          Close
        </button>
      </div>
      {done && <Alert tone="green">{done}</Alert>}
      <ImportSteps
        key={round}
        org={org}
        onDone={(text) => {
          setDone(text);
          setRound((n) => n + 1);
          router.refresh();
        }}
      />
    </div>
  );
}

type Step = "paste" | "columns" | "preview";
const pill = (on: boolean) =>
  `shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? "bg-thunder-blue text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`;
const labelOf = (f: OfficialField) => OFFICIAL_FIELDS.find((x) => x.key === f)?.label ?? f;
const STATUS = {
  new: ["New", "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"],
  update: ["Update level", "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"],
  exists: ["Already an official", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"],
  error: ["Fix", "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"],
} as const;

function ImportSteps({ org, onDone }: { org: string; onDone: (msg: string) => void }) {
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [heading, setHeading] = useState<string[] | null>(null);
  const [data, setData] = useState<string[][]>([]);
  const [columns, setColumns] = useState<OfficialField[]>([]);
  const [rows, setRows] = useState<OfficialImportRow[] | null>(null);
  const [tooMany, setTooMany] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const fresh = rows?.filter((r) => r.status === "new").length ?? 0;
  const updates = rows?.filter((r) => r.status === "update").length ?? 0;
  const has = (f: OfficialField) => columns.includes(f);
  const missing = [...(!has("name") && !(has("first") && has("last")) ? ["First and Last Name (or Full Name)"] : []), ...(!has("cell") ? ["Cell"] : [])];

  const toColumns = () => {
    const table = splitTable(text);
    if (!table.length) return setError("Paste your officials or choose a CSV file.");
    const g = guessOfficialColumns(table);
    const body = (g.header ? table.slice(1) : table).map((r) => r.cells);
    if (!body.length) return setError("There are headings but no officials under them.");
    setHeading(g.header ? table[0].cells : null);
    setData(body);
    setColumns(g.columns);
    setError(null);
    setStep("columns");
  };
  const runPreview = (table = data) =>
    start(async () => {
      setError(null);
      const r = await previewOfficialsAction(org, officialTableText(table, columns));
      if (!r.ok) return setError(r.message);
      setRows(r.rows);
      setTooMany(r.tooMany);
      setEditing(null);
      setStep("preview");
    });

  const steps = (
    <div className="flex items-center gap-1.5" aria-hidden>
      <span className={pill(step === "paste")}>1 Paste</span>
      <span className={pill(step === "columns")}>2 Columns</span>
      <span className={pill(step === "preview")}>3 Check &amp; add</span>
    </div>
  );

  if (step === "preview" && rows)
    return (
      <div className="grid gap-3">
        {steps}
        <p className="text-sm">
          <span className="font-semibold">{fresh} to add</span>
          {updates > 0 && <span className="font-semibold"> · {updates} level{updates === 1 ? "" : "s"} to update</span>}
          {rows.length - fresh - updates > 0 && <span className="text-zinc-500"> · {rows.length - fresh - updates} skipped</span>}
          {rows.some((r) => r.fixes.length) && (
            <span className="text-amber-700 dark:text-amber-300"> · {rows.filter((r) => r.fixes.length).length} cleaned up</span>
          )}
          {tooMany && <span className="text-red-600"> · only the first 300 rows</span>}
        </p>
        <p className="text-xs text-zinc-500">This is exactly what will be added. Tap Edit on a row to change it.</p>
        <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto rounded-xl bg-white ring-1 ring-zinc-950/10 dark:divide-white/5 dark:bg-zinc-900 dark:ring-white/10">
          {rows.map((r) => {
            const at = r.line - 2; // row 1 is our headings
            const active = r.status === "new" || r.status === "update";
            return (
              <li key={r.line} className={`px-3 py-2 text-sm ${active ? "" : "bg-zinc-50 dark:bg-zinc-800/40"}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className={active ? "font-medium" : "text-zinc-500"}>
                    {`${r.first} ${r.last}`.trim() || `Row ${at + 1}`}
                    {r.level && <span className="font-normal text-zinc-500"> · {r.level}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {editing !== at && (
                      <button type="button" className="text-xs font-medium text-thunder-blue" onClick={() => setEditing(at)}>
                        Edit
                      </button>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
                  </span>
                </div>
                {r.cell && (
                  <p className="text-xs text-zinc-500">
                    {formatCell(r.cell)} · User ID {r.cell.slice(-7)} · {r.email ?? "no email (they add it at first login)"}
                  </p>
                )}
                {r.level === "Recruit" && <p className="text-xs text-amber-700 dark:text-amber-400">Recruits can&apos;t be scheduled to officiate games.</p>}
                {r.fixes.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">Cleaned up: {r.fixes.join(" · ")}</p>}
                {r.errors.length > 0 && <p className="text-xs text-red-600 dark:text-red-400">{r.errors.join(" · ")}</p>}
                {editing === at && data[at] && (
                  <RowEditor
                    cells={data[at]}
                    columns={columns}
                    busy={busy}
                    onCancel={() => setEditing(null)}
                    onSave={(cells) => {
                      const next = data.map((row, i) => (i === at ? cells : row));
                      setData(next);
                      runPreview(next);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
        {error && <Alert tone="red">{error}</Alert>}
        <button
          type="button"
          disabled={busy || !(fresh + updates)}
          className={`${primaryBtn} w-full`}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await importOfficialsAction(org, officialTableText(data, columns));
              if (!r.ok) return setError(r.message);
              onDone(
                `${r.added} official${r.added === 1 ? "" : "s"} added${r.newLogins ? ` (${r.newLogins} new login${r.newLogins === 1 ? "" : "s"}: they sign in with their cell)` : ""}${r.updated ? `, ${r.updated} level${r.updated === 1 ? "" : "s"} updated` : ""}${r.skipped ? `, ${r.skipped} skipped` : ""}.`,
              );
            })
          }
        >
          {busy
            ? "Working…"
            : fresh + updates
              ? [fresh && `Add ${fresh} official${fresh === 1 ? "" : "s"}`, updates && `update ${updates} level${updates === 1 ? "" : "s"}`]
                  .filter(Boolean)
                  .join(", ")
              : "Nothing new to add"}
        </button>
        <button type="button" className="text-sm text-zinc-500" onClick={() => setStep("columns")}>
          ← Back to columns
        </button>
      </div>
    );

  if (step === "columns")
    return (
      <div className="grid gap-3">
        {steps}
        <p className="text-sm text-zinc-500">
          We matched each column{heading ? " by its heading" : " by what's in it"}. Check them, and change any that are wrong.
        </p>
        <ul className="grid gap-2">
          {columns.map((c, i) => {
            const samples = data
              .map((r) => r[i] ?? "")
              .filter(Boolean)
              .slice(0, 3);
            return (
              <li key={i} className="rounded-xl bg-white p-2.5 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
                <div className="flex items-center justify-between gap-2">
                  <span className="max-w-[45%] shrink-0 truncate text-sm font-medium">{heading?.[i] ? `“${heading[i]}”` : `Column ${i + 1}`}</span>
                  <select
                    aria-label={`Column ${i + 1} is`}
                    className={`${inputCls} w-auto py-1 text-sm ${c === "skip" ? "text-zinc-500" : ""}`}
                    value={c}
                    onChange={(e) => {
                      const f = e.target.value as OfficialField;
                      setColumns(columns.map((x, j) => (j === i ? f : x === f && f !== "skip" ? "skip" : x)));
                    }}
                  >
                    {OFFICIAL_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-500">{samples.length ? samples.join(" · ") : "(empty)"}</p>
              </li>
            );
          })}
        </ul>
        {missing.length > 0 && <Alert tone="red">Pick a column for: {missing.join(", ")}.</Alert>}
        {error && <Alert tone="red">{error}</Alert>}
        <button type="button" disabled={busy || missing.length > 0} className={`${primaryBtn} w-full`} onClick={() => runPreview()}>
          {busy ? "Checking…" : `See what will be imported (${data.length} row${data.length === 1 ? "" : "s"})`}
        </button>
        <button type="button" className="text-sm text-zinc-500" onClick={() => setStep("paste")}>
          ← Back to edit
        </button>
      </div>
    );

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        toColumns();
      }}
    >
      {steps}
      <p className="text-sm text-zinc-500">
        One official per row: <span className="font-medium text-zinc-700 dark:text-zinc-300">First, Last, Cell, Email, Level</span>. Paste
        from a spreadsheet or choose a CSV file; columns in any order, with or without headings. Email may be blank (they add it at
        first login). Level: Certified, Experienced, Student or Recruit (Recruits can&apos;t be scheduled to officiate games).
      </p>
      <input
        type="file"
        accept=".csv,text/csv,text/plain"
        className="text-sm"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 200_000) return setError("That file is too big. Up to 300 officials.");
          setText(await f.text());
        }}
      />
      <textarea
        className={`${inputCls} min-h-40 font-mono text-xs`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"First\tLast\tCell\tEmail\tLevel\nPat\tJones\t423-555-0101\tpat@example.com\tCertified\nLee\tKim\t(423) 555-0102\t\tStudent"}
        spellCheck={false}
        aria-label="Officials to import"
      />
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={!text.trim()} className={`${primaryBtn} w-full`}>
        Next: check columns
      </button>
    </form>
  );
}

// Change one pasted row (the columns being imported), then check it again.
function RowEditor({
  cells,
  columns,
  busy,
  onSave,
  onCancel,
}: {
  cells: string[];
  columns: OfficialField[];
  busy: boolean;
  onSave: (cells: string[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => columns.map((_, i) => cells[i] ?? ""));
  const set = (i: number, v: string) => setDraft(draft.map((x, j) => (j === i ? v : x)));
  return (
    <div className="mt-2 grid gap-2 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/50">
      {columns.map((c, i) =>
        c === "skip" ? null : (
          <label key={i} className="grid gap-0.5 text-xs text-zinc-500">
            {labelOf(c)}
            {c === "level" ? (
              <select className={`${inputCls} py-1 text-sm`} value={draft[i]} onChange={(e) => set(i, e.target.value)}>
                {![...OFFICIAL_LEVELS, ""].includes(draft[i] as never) && <option value={draft[i]}>{draft[i]}</option>}
                <option value="">—</option>
                {OFFICIAL_LEVELS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input className={`${inputCls} py-1 text-sm`} value={draft[i]} onChange={(e) => set(i, e.target.value)} />
            )}
          </label>
        ),
      )}
      <div className="flex justify-end gap-3">
        <button type="button" className="text-sm text-zinc-500" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" disabled={busy} className="text-sm font-semibold text-thunder-blue" onClick={() => onSave(draft)}>
          {busy ? "Checking…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// An official's Level, changed right on their row (saves when picked; Recruits can't be scheduled to officiate games).
export function OfficialLevel({ org, coachId, level }: { org: string; coachId: string; level: string | null }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="text-zinc-500" htmlFor={`level-${coachId}`}>
        Level
      </label>
      <select
        id={`level-${coachId}`}
        className={`${input} py-1`}
        disabled={busy}
        defaultValue={level ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          start(async () => {
            const r = await setOfficialLevelAction(org, coachId, v);
            setMsg(r.ok ? { ok: true, text: "Saved ✓" } : { ok: false, text: r.message });
            if (r.ok) router.refresh();
          });
        }}
      >
        <option value="">Not set</option>
        {OFFICIAL_LEVELS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      {level === "Recruit" && <span className="text-xs text-amber-700 dark:text-amber-400">Can&apos;t be scheduled to officiate games</span>}
      {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</span>}
    </div>
  );
}
