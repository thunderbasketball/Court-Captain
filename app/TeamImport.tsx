"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formatCell } from "@/lib/phone";
import { guessColumns, importFields, splitTable, tableText, type ImportField, type ImportRow } from "@/lib/team-import-parse";
import { Alert, PopUp, Toast, useConfirm } from "./client-ui";
import { inputCls, primaryBtn } from "./ui";

type PreviewRow = ImportRow & { status: "new" | "exists" | "error"; gradeLabel: string | null };
type Fail = { ok: false; message: string };
type Preview = (text: string) => Promise<{ ok: true; rows: PreviewRow[]; tooMany: boolean } | Fail>;
type Add = (text: string) => Promise<{ ok: true; added: string[]; skipped: string[] } | Fail>;

// Import teams (Thunder and every organization), in three steps: paste rows from a spreadsheet or choose a CSV file;
// check which column is which (matched by heading or by what's in it); then see exactly what will be added, cleaned up
// ("3 & 4" → 3rd/4th, "R" → REC), edit any row, and add. `preview` and `add` are the server's (it checks everything
// again). `named`: the first field is a name (Scenic City's clubs: `nameLabel` "Organization").
export function ImportTeamsButton({
  preview,
  add,
  help,
  example,
  named = false,
  nameLabel = "Team",
}: {
  preview: Preview;
  add: Add;
  help: ReactNode;
  example: string;
  named?: boolean;
  nameLabel?: string;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <PopUp
        label="Import"
        title="Import teams"
        className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 hover:bg-thunder-blue/5"
      >
        {(close) => (
          <ImportForm
            preview={preview}
            add={add}
            help={help}
            example={example}
            named={named}
            nameLabel={nameLabel}
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

type Step = "paste" | "columns" | "preview";
const pill = (on: boolean) =>
  `shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? "bg-thunder-blue text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`;

function ImportForm({
  preview,
  add,
  help,
  example,
  named,
  nameLabel,
  onDone,
}: {
  preview: Preview;
  add: Add;
  help: ReactNode;
  example: string;
  named: boolean;
  nameLabel: string;
  onDone: (msg: string) => void;
}) {
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  // What they pasted: the heading row (if any), the rows, and which field each column is (they can change it).
  const [heading, setHeading] = useState<string[] | null>(null);
  const [data, setData] = useState<string[][]>([]);
  const [columns, setColumns] = useState<ImportField[]>([]);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [tooMany, setTooMany] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const fieldList = importFields(named, nameLabel);
  const labelOf = (f: ImportField) => fieldList.find((x) => x.key === f)?.label ?? f;
  const clean = () => tableText(data, columns, named, nameLabel);
  const fresh = rows?.filter((r) => r.status === "new") ?? [];

  const toColumns = () => {
    const table = splitTable(text);
    if (!table.length) return setError("Paste your teams or choose a CSV file.");
    const g = guessColumns(table, named);
    const body = (g.header ? table.slice(1) : table).map((r) => r.cells);
    if (!body.length) return setError("There are headings but no teams under them.");
    setHeading(g.header ? table[0].cells : null);
    setData(body);
    setColumns(g.columns);
    setError(null);
    setStep("columns");
  };
  // Every team needs a gender, grade and level (a team name like 4G Epps gives grade and gender); named ones a name.
  const has = (f: ImportField) => columns.includes(f);
  const missing = [
    ...(named && !has("name") ? [nameLabel] : []),
    ...(!has("gender") && !has("team") && !has("grade") ? ["Gender"] : []),
    ...(!has("grade") && !has("team") ? ["Grade"] : []),
    ...(!has("level") ? ["Level"] : []),
  ];
  const runPreview = (table = data) =>
    start(async () => {
      setError(null);
      const r = await preview(tableText(table, columns, named, nameLabel));
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
          <span className="font-semibold">{fresh.length} to add</span>
          {rows.length - fresh.length > 0 && <span className="text-zinc-500"> · {rows.length - fresh.length} skipped</span>}
          {rows.some((r) => r.fixes.length) && (
            <span className="text-amber-700 dark:text-amber-300"> · {rows.filter((r) => r.fixes.length).length} cleaned up</span>
          )}
          {tooMany && <span className="text-red-600"> · only the first 200 rows</span>}
        </p>
        <p className="text-xs text-zinc-500">This is exactly what will be added. Tap Edit on a row to change it.</p>
        <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
          {rows.map((r) => {
            const at = r.line - 2; // row 1 is our headings
            return (
              <li key={r.line} className={`px-3 py-2 text-sm ${r.status === "new" ? "" : "bg-zinc-50 dark:bg-zinc-800/40"}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className={r.status === "new" ? "font-medium" : "text-zinc-500"}>
                    {r.name || `Row ${at + 1}`}
                    <span className="font-normal text-zinc-500">
                      {r.gender && ` · ${r.gender}`}
                      {r.gradeLabel && ` · ${r.gradeLabel}`}
                      {r.level && ` · ${r.level}`}
                      {r.altName && ` · “${r.altName}”`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {editing !== at && (
                      <button type="button" className="text-xs font-medium text-thunder-blue" onClick={() => setEditing(at)}>
                        Edit
                      </button>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        r.status === "new"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                          : r.status === "exists"
                            ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                            : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                      }`}
                    >
                      {r.status === "new" ? "New" : r.status === "exists" ? "Already a team" : "Fix"}
                    </span>
                  </span>
                </div>
                {r.coach && (
                  <p className="text-xs text-zinc-500">
                    Head Coach {r.coach.first} {r.coach.last} ·{" "}
                    {r.coach.cell ? (
                      formatCell(r.coach.cell)
                    ) : (
                      <span className="font-medium text-amber-700 dark:text-amber-300">no cell yet (add it on the team)</span>
                    )}
                    {r.coach.email && <> · {r.coach.email}</>}
                  </p>
                )}
                {r.fixes.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Cleaned up: {r.fixes.join(" · ")}</p>
                )}
                {r.errors.length > 0 && <p className="text-xs text-red-600 dark:text-red-400">{r.errors.join(" · ")}</p>}
                {editing === at && data[at] && (
                  <RowEditor
                    cells={data[at]}
                    columns={columns}
                    labelOf={labelOf}
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
          disabled={busy || !fresh.length}
          className={`${primaryBtn} w-full`}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await add(clean());
              if (!r.ok) return setError(r.message);
              onDone(
                `${r.added.length} team${r.added.length === 1 ? "" : "s"} added${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}.`,
              );
            })
          }
        >
          {busy ? "Working…" : fresh.length ? `Add ${fresh.length} team${fresh.length === 1 ? "" : "s"}` : "Nothing new to add"}
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
              <li key={i} className="rounded-xl p-2.5 ring-1 ring-zinc-950/10 dark:ring-white/10">
                <div className="flex items-center justify-between gap-2">
                  <span className="max-w-[45%] shrink-0 truncate text-sm font-medium">
                    {heading?.[i] ? `“${heading[i]}”` : `Column ${i + 1}`}
                  </span>
                  <select
                    aria-label={`Column ${i + 1} is`}
                    className={`${inputCls} w-auto py-1 text-sm ${c === "skip" ? "text-zinc-500" : ""}`}
                    value={c}
                    onChange={(e) => {
                      const f = e.target.value as ImportField;
                      // A field goes to one column: the column that had it is left out.
                      setColumns(columns.map((x, j) => (j === i ? f : x === f && f !== "skip" ? "skip" : x)));
                    }}
                  >
                    {fieldList.map((f) => (
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
        <button
          type="button"
          disabled={busy || missing.length > 0}
          className={`${primaryBtn} w-full`}
          onClick={() => runPreview()}
        >
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
      <p className="text-sm text-zinc-500">{help}</p>
      <input
        type="file"
        accept=".csv,text/csv,text/plain"
        className="text-sm"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 200_000) return setError("That file is too big. Up to 200 teams.");
          setText(await f.text());
        }}
      />
      <textarea
        className={`${inputCls} min-h-40 font-mono text-xs`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={example}
        spellCheck={false}
      />
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy || !text.trim()} className={`${primaryBtn} w-full`}>
        Next: check columns
      </button>
    </form>
  );
}

// Change one pasted row (the columns being imported), then check it again.
function RowEditor({
  cells,
  columns,
  labelOf,
  busy,
  onSave,
  onCancel,
}: {
  cells: string[];
  columns: ImportField[];
  labelOf: (f: ImportField) => string;
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
            {c === "gender" || c === "level" ? (
              <select className={`${inputCls} py-1 text-sm`} value={draft[i]} onChange={(e) => set(i, e.target.value)}>
                {![...(c === "gender" ? ["Boys", "Girls"] : ["REC", "COMP"]), ""].includes(draft[i]) && (
                  <option value={draft[i]}>{draft[i]}</option>
                )}
                <option value="">—</option>
                {(c === "gender" ? ["Boys", "Girls"] : ["REC", "COMP"]).map((o) => (
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

// Undo an import (asks first): its teams still there are removed; ones registered in a program are kept and named.
export function UndoImportButton({
  undo,
  teams,
  when,
  note,
}: {
  undo: () => Promise<{ ok: true; removed: string[]; kept: string[] } | Fail>;
  teams: number;
  when: string;
  note: string; // which teams are kept, e.g. "Teams registered in a program are kept."
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
        className="shrink-0 text-xs font-medium text-red-600 hover:underline"
        onClick={async () => {
          if (
            !(await confirm({
              title: `Undo the import from ${when}?`,
              message: `Are you sure? Its ${teams} team${teams === 1 ? "" : "s"} still here will be removed, with their coaches. ${note}`,
              confirmLabel: "Undo import",
            }))
          )
            return;
          start(async () => {
            const r = await undo();
            if (!r.ok) return setMsg(r.message);
            setMsg(
              `${r.removed.length} team${r.removed.length === 1 ? "" : "s"} removed.` +
                (r.kept.length ? ` Kept: ${r.kept.join(", ")}. ${note}` : ""),
            );
            router.refresh();
          });
        }}
      >
        Undo
      </button>
      {msg && <Toast key={msg} message={msg} />}
      {dialog}
    </>
  );
}
