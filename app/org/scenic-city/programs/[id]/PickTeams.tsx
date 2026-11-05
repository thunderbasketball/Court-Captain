"use client";

// Check boxes by a program's teams, then one action for all of them: Remove from the program (or Restore), for Admins
// and Directors of Scheduling; Withdraw, for Directors of Programs. The server checks the role and every team again.
import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { setTeamsOff, withdrawTeams } from "../../actions";
import { Toast, useConfirm } from "../../../../client-ui";

type Picked = Map<string, boolean>; // team id → taken out of the program now
const Ctx = createContext<{ picked: Picked; set: (teams: { id: string; out: boolean }[], on: boolean) => void } | null>(null);

export function PickTeams({
  programId,
  canRemove,
  canWithdraw,
  children,
}: {
  programId: string;
  canRemove: boolean;
  canWithdraw: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Picked>(new Map());
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const set = (teams: { id: string; out: boolean }[], on: boolean) =>
    setPicked((m) => {
      const next = new Map(m);
      for (const t of teams) {
        if (on) next.set(t.id, t.out);
        else next.delete(t.id);
      }
      return next;
    });
  const ids = [...picked.keys()];
  const inIds = ids.filter((id) => !picked.get(id));
  const outIds = ids.filter((id) => picked.get(id));
  const n = (k: number) => `${k} team${k === 1 ? "" : "s"}`;
  const act = (
    fn: () => Promise<{ ok: true; changed?: number; withdrawn?: number } | { ok: false; message: string }>,
    done: string,
  ) =>
    start(async () => {
      const r = await fn();
      setMsg((m) => ({ text: r.ok ? done.replace("#", n(r.changed ?? r.withdrawn ?? 0)) : r.message, n: (m?.n ?? 0) + 1 }));
      if (r.ok) {
        setPicked(new Map());
        router.refresh();
      }
    });
  const btn = "rounded-full px-3 py-1.5 text-sm font-semibold ring-1 disabled:opacity-50";

  return (
    <Ctx.Provider value={{ picked, set }}>
      {children}
      {ids.length > 0 && (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-white/10">
          <span className="text-sm font-semibold">{n(ids.length)} picked</span>
          <span className="flex-1" />
          {canRemove && inIds.length > 0 && (
            <button
              type="button"
              disabled={busy}
              className={`${btn} text-red-600 ring-red-600/30`}
              onClick={async () => {
                if (
                  await confirm({
                    title: `Take ${n(inIds.length)} out of the program?`,
                    message: "They stay registered and listed (crossed out). You can restore them.",
                    confirmLabel: "Take out",
                  })
                )
                  act(() => setTeamsOff(programId, inIds, true), "# taken out of the program.");
              }}
            >
              Remove from program ({inIds.length})
            </button>
          )}
          {canRemove && outIds.length > 0 && (
            <button
              type="button"
              disabled={busy}
              className={`${btn} text-emerald-700 ring-emerald-600/40 dark:text-emerald-300`}
              onClick={() => act(() => setTeamsOff(programId, outIds, false), "# restored.")}
            >
              Restore ({outIds.length})
            </button>
          )}
          {canWithdraw && (
            <button
              type="button"
              disabled={busy}
              className={`${btn} bg-red-600 text-white ring-red-600`}
              onClick={async () => {
                if (
                  await confirm({
                    title: `Withdraw ${n(ids.length)}?`,
                    message: "Their registrations are deleted: they come out of this program completely, with their matchups.",
                    confirmLabel: "Withdraw",
                  })
                )
                  act(() => withdrawTeams(programId, ids), "# withdrawn.");
              }}
            >
              Withdraw ({ids.length})
            </button>
          )}
          <button
            type="button"
            className={`${btn} text-zinc-600 ring-zinc-300 dark:text-zinc-300`}
            onClick={() => setPicked(new Map())}
          >
            Clear
          </button>
        </div>
      )}
      {msg && <Toast key={msg.n} message={msg.text} />}
      {confirmDialog}
    </Ctx.Provider>
  );
}

// The check box by one team.
export function PickBox({ id, out, name }: { id: string; out: boolean; name: string }) {
  const c = useContext(Ctx);
  if (!c) return null;
  return (
    <input
      type="checkbox"
      aria-label={`Pick ${name}`}
      checked={c.picked.has(id)}
      onChange={(e) => c.set([{ id, out }], e.target.checked)}
      className="mt-1 size-5 shrink-0 accent-scenic-navy"
    />
  );
}

// "All" for a pool: picks (or clears) every team in it.
export function PickAll({ teams }: { teams: { id: string; out: boolean }[] }) {
  const c = useContext(Ctx);
  if (!c || !teams.length) return null;
  const all = teams.every((t) => c.picked.has(t.id));
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
      <input type="checkbox" checked={all} onChange={() => c.set(teams, !all)} className="size-4 accent-scenic-navy" />
      All
    </label>
  );
}
