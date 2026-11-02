"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ImportRow } from "@/lib/team-import-parse";
import { Alert, PopUp, Toast, useConfirm } from "./client-ui";
import { inputCls, primaryBtn } from "./ui";

type PreviewRow = ImportRow & { status: "new" | "exists" | "error"; gradeLabel: string | null };
type Fail = { ok: false; message: string };
type Preview = (text: string) => Promise<{ ok: true; rows: PreviewRow[]; tooMany: boolean } | Fail>;
type Add = (text: string) => Promise<{ ok: true; added: string[]; skipped: string[] } | Fail>;

// Import teams (Thunder and every organization): paste rows from a spreadsheet or choose a CSV file, Preview what will
// happen to each row, then confirm to add the new ones. `preview` and `add` are the server's (it checks everything again).
export function ImportTeamsButton({
  preview,
  add,
  help,
  example,
}: {
  preview: Preview;
  add: Add;
  help: ReactNode;
  example: string;
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

function ImportForm({
  preview,
  add,
  help,
  example,
  onDone,
}: {
  preview: Preview;
  add: Add;
  help: ReactNode;
  example: string;
  onDone: (msg: string) => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [tooMany, setTooMany] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const fresh = rows?.filter((r) => r.status === "new") ?? [];

  if (rows)
    return (
      <div className="grid gap-3">
        <p className="text-sm">
          <span className="font-semibold">{fresh.length} new</span>
          {rows.length - fresh.length > 0 && <span className="text-zinc-500"> · {rows.length - fresh.length} skipped</span>}
          {tooMany && <span className="text-red-600"> · only the first 200 rows</span>}
        </p>
        <ul className="max-h-80 divide-y divide-zinc-100 overflow-y-auto rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
          {rows.map((r) => (
            <li key={r.line} className={`px-3 py-2 text-sm ${r.status === "new" ? "" : "bg-zinc-50 dark:bg-zinc-800/40"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className={r.status === "new" ? "font-medium" : "text-zinc-500"}>
                  {r.name || `Row ${r.line}`}
                  <span className="font-normal text-zinc-500">
                    {r.gender && ` · ${r.gender}`}
                    {r.gradeLabel && ` · ${r.gradeLabel}`}
                    {r.level && ` · ${r.level}`}
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
                  {r.status === "new" ? "New" : r.status === "exists" ? "Already a team" : "Fix"}
                </span>
              </div>
              {r.coach && r.status === "new" && (
                <p className="text-xs text-zinc-500">
                  Head Coach {r.coach.first} {r.coach.last}
                </p>
              )}
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
              const r = await add(text);
              if (!r.ok) return setError(r.message);
              onDone(
                `${r.added.length} team${r.added.length === 1 ? "" : "s"} added${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}.`,
              );
            })
          }
        >
          {busy ? "Adding…" : fresh.length ? `Add ${fresh.length} team${fresh.length === 1 ? "" : "s"}` : "Nothing new to add"}
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
          const r = await preview(text);
          if (!r.ok) return setError(r.message);
          setRows(r.rows);
          setTooMany(r.tooMany);
        });
      }}
    >
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
        {busy ? "Checking…" : "Preview"}
      </button>
    </form>
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
