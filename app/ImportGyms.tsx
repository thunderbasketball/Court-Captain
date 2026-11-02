"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GymImportRow } from "@/lib/gym-import";
import { importGyms, previewGyms } from "./org/thunder/facilities/actions";
import { Alert, PopUp, Toast } from "./client-ui";
import { inputCls, primaryBtn } from "./ui";

// Import gyms (Thunder and every organization), like Import teams: paste rows or choose a CSV file, Preview what will
// happen to each, then confirm to add the new ones.
export default function ImportGymsButton({ org }: { org: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const thunder = org === "thunder";
  return (
    <>
      <PopUp
        label="Import"
        title="Import gyms"
        className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 hover:bg-thunder-blue/5"
      >
        {(close) => (
          <GymImportForm
            org={org}
            thunder={thunder}
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

function GymImportForm({ org, thunder, onDone }: { org: string; thunder: boolean; onDone: (msg: string) => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<GymImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const fresh = rows?.filter((r) => r.status === "new") ?? [];
  const example = thunder
    ? "Gym,Short Name,Courts\nAction Church,,2\nEast Ridge MS,,Goal #1/Goal #2"
    : "Gym,Short Name,Courts\nEast Ridge Community Center,ERCC,2\nEast Ridge MS,ERMS,Main/Aux";

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
                  {r.name || `Row ${r.line}`}
                  {r.short && <span className="font-normal text-zinc-500"> ({r.short})</span>}
                  <span className="block text-xs font-normal text-zinc-500">{r.courts.join(", ")}</span>
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
                  {r.status === "new" ? "New" : r.status === "exists" ? "Already a gym" : "Fix"}
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
              const r = await importGyms(org, text);
              if (!r.ok) return setError(r.message);
              onDone(
                `${r.added.length} gym${r.added.length === 1 ? "" : "s"} added${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}.`,
              );
            })
          }
        >
          {busy ? "Adding…" : fresh.length ? `Add ${fresh.length} gym${fresh.length === 1 ? "" : "s"}` : "Nothing new to add"}
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
          const r = await previewGyms(org, text);
          if (!r.ok) return setError(r.message);
          setRows(r.rows);
        });
      }}
    >
      <p className="text-sm text-zinc-500">
        One gym per row: <span className="font-medium text-zinc-700 dark:text-zinc-300">Gym, Short name, Courts</span>.
        {thunder ? " Short name is optional." : " Short name: up to 8 letters or numbers."} Courts: a number (1–12) or the court
        names separated by &quot;/&quot;. Paste from a spreadsheet or choose a CSV file.
      </p>
      <input
        type="file"
        accept=".csv,text/csv,text/plain"
        className="text-sm"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 200_000) return setError("That file is too big. Up to 200 gyms.");
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
