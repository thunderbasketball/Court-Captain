"use client";

// Scheduler → Bindings: pick teams (check boxes, by division) and bind them by hand, with an optional reason; Unbind
// takes a binding away (asks first). The server checks the role and the teams again.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Toast, useConfirm } from "../../../client-ui";
import { inputCls } from "../../../ui";
import { bindTeams, unbindTeams } from "../actions";

export type BindChoice = { id: string; name: string; division: string; from: string };

export function BindPicker({ teams }: { teams: BindChoice[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const f = filter.trim().toLowerCase();
  const shown = teams.filter((t) => !f || `${t.name} ${t.from} ${t.division}`.toLowerCase().includes(f));
  const divisions = [...new Set(shown.map((t) => t.division))];
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const names = teams.filter((t) => picked.includes(t.id)).map((t) => t.name);

  const bind = () =>
    start(async () => {
      setError(null);
      const r = await bindTeams(picked, reason);
      if (!r.ok) return setError(r.message);
      setDone(`Bound ${names.join(", ")}.`);
      setPicked([]);
      setReason("");
      router.refresh();
    });

  return (
    <div className="space-y-2">
      {done && <Toast message={done} />}
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find a team…"
        aria-label="Find a team"
        className={inputCls}
      />
      <div className="max-h-80 overflow-y-auto rounded-xl ring-1 ring-zinc-950/10 dark:ring-white/15">
        {!shown.length && <p className="p-3 text-sm text-zinc-500">No teams match.</p>}
        {divisions.map((d) => (
          <fieldset key={d}>
            <legend className="w-full bg-zinc-50 px-3 py-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:bg-white/5">
              {d}
            </legend>
            {shown
              .filter((t) => t.division === d)
              .map((t) => (
                <label key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input type="checkbox" className="size-4" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />
                  <span className="min-w-0">
                    <span className="font-medium">{t.name}</span> <span className="text-zinc-500">· {t.from}</span>
                  </span>
                </label>
              ))}
          </fieldset>
        ))}
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={80}
        placeholder="Reason (optional), e.g. Same family"
        aria-label="Reason"
        className={inputCls}
      />
      {picked.length > 0 && <p className="text-xs text-zinc-500">Picked: {names.join(", ")}</p>}
      {error && <Alert tone="red">{error}</Alert>}
      <button
        type="button"
        disabled={busy || picked.length < 2}
        onClick={bind}
        className="w-full rounded-lg bg-scenic-navy px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Binding…" : picked.length < 2 ? "Pick 2 or more teams" : `Bind ${picked.length} teams`}
      </button>
    </div>
  );
}

export function UnbindButton({ id, teams }: { id: string; teams: string }) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <>
      {confirmDialog}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (
            !(await confirm({
              title: "Unbind these teams?",
              message: `${teams} will no longer be kept together. Matchups already made stay as they are.`,
              confirmLabel: "Unbind",
            }))
          )
            return;
          start(async () => {
            const r = await unbindTeams(id);
            if (!r.ok) return setError(r.message);
            router.refresh();
          });
        }}
        className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-600/30 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:ring-red-400/30 dark:hover:bg-red-500/10"
      >
        {busy ? "…" : "Unbind"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </>
  );
}
