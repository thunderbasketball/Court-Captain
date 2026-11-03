"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { gradeLabel } from "@/lib/grades";
import type { RosterCandidate } from "@/lib/rosters";
import { Alert, CloseButton, Toast, dialogCls, useConfirm } from "../../../../client-ui";
import { primaryBtn } from "../../../../ui";
import { addPlayers, removePlayer } from "../actions";

// Director: pick registered players to put on the team. Players who fit the team (gender + grade) show first.
// `canSecond` (Owners, Admins, Directors of Players): picking a player already on a team asks first, then puts them on a
// 2nd team. The server checks again.
export function AddPlayersButton({
  teamId,
  teamName,
  candidates,
  canSecond,
}: {
  teamId: string;
  teamName: string;
  candidates: RosterCandidate[];
  canSecond: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const [picked, setPicked] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  const q = search.trim().toLowerCase();
  const list = candidates.filter(
    (c) => (showAll || c.fits || q) && (!q || `${c.firstName} ${c.lastName}`.toLowerCase().includes(q)),
  );
  const fitting = candidates.filter((c) => c.fits).length;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPicked([]);
          setError(null);
          setSearch("");
          dialog.current?.showModal();
        }}
        className="shrink-0 rounded-full bg-thunder-blue px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-white shadow-sm hover:bg-thunder-blue-dark"
      >
        + Add players
      </button>
      {done && <Toast key={done} message={done} />}
      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        <div className="flex max-h-[85vh] flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Add players</h2>
              <p className="text-sm text-zinc-500">{fitting} registered players fit this team&apos;s gender and grades</p>
            </div>
            <CloseButton onClick={close} />
          </div>
          <input
            className="mt-3 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-base ring-1 ring-zinc-950/10 outline-none focus:ring-2 focus:ring-thunder-blue dark:bg-zinc-900 dark:ring-white/15"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find any registered player…"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              className="size-4 accent-thunder-blue"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Show all registered players
          </label>
          <ul className="mt-3 min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/15">
            {!list.length && <li className="px-3 py-3 text-sm text-zinc-500">No players to add.</li>}
            {list.map((c) => (
              <li key={c.registrantId}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-white/5">
                  <input
                    type="checkbox"
                    className="size-5 accent-thunder-blue"
                    checked={picked.includes(c.registrantId)}
                    onChange={() =>
                      setPicked(
                        picked.includes(c.registrantId)
                          ? picked.filter((x) => x !== c.registrantId)
                          : [...picked, c.registrantId],
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {c.firstName} {c.lastName}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {c.gender} · {gradeLabel(c.grade)}
                      {c.otherTeams.length > 0 && (
                        <span className="text-amber-700 dark:text-amber-400"> · on {c.otherTeams.join(", ")}</span>
                      )}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {error && (
            <div className="mt-3">
              <Alert tone="red">{error}</Alert>
            </div>
          )}
          <button
            type="button"
            disabled={busy || !picked.length}
            className={`${primaryBtn} mt-3`}
            onClick={async () => {
              const onTeams = candidates.filter((c) => picked.includes(c.registrantId) && c.otherTeams.length > 0);
              const second =
                canSecond &&
                onTeams.length > 0 &&
                (await confirm({
                  title: onTeams.length === 1 ? "Put this player on a 2nd team?" : `Put ${onTeams.length} players on a 2nd team?`,
                  message: (
                    <>
                      <ul className="space-y-1">
                        {onTeams.map((c) => (
                          <li key={c.registrantId}>
                            <strong className="font-semibold">
                              {c.firstName} {c.lastName}
                            </strong>{" "}
                            is already on {c.otherTeams.join(", ")}.
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2">
                        They stay on that team and also join <strong className="font-semibold">{teamName}</strong>.
                      </p>
                    </>
                  ),
                  confirmLabel: "Yes, add to a 2nd team",
                  tone: "warning",
                }));
              if (canSecond && onTeams.length > 0 && !second) return;
              start(async () => {
                const r = await addPlayers(teamId, picked, second === true);
                if (!r.ok) return setError(r.message);
                close();
                setDone(`Added ${r.added} player${r.added === 1 ? "" : "s"}.`);
                router.refresh();
              });
            }}
          >
            {busy ? "Adding…" : `Add ${picked.length || ""} player${picked.length === 1 ? "" : "s"}`}
          </button>
        </div>
        {confirmDialog}
      </dialog>
    </>
  );
}

export function RemovePlayerButton({ teamId, registrantId, name }: { teamId: string; registrantId: string; name: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      {confirmDialog}
      <button
        type="button"
        disabled={busy}
        aria-label={`Remove ${name}`}
        className="rounded-full px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
        onClick={async () => {
          const ok = await confirm({
            title: `Remove ${name} from the team?`,
            message: <p>Their past practice check-ins stay saved. You can add them back later.</p>,
            confirmLabel: "Remove",
            tone: "warning",
          });
          if (!ok) return;
          start(async () => {
            await removePlayer(teamId, registrantId);
            router.refresh();
          });
        }}
      >
        Remove
      </button>
    </>
  );
}
