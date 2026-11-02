"use client";

import { useRef, useState } from "react";
import type { TeamEvalCard } from "@/lib/evaluations";
import { Alert, CloseButton, Toast, dialogCls } from "../../../client-ui";
import { Card } from "../teams/[id]/evaluate/EvalBoard";
import { loadPlayerEvaluations } from "./actions";

// Director: rate a player from the Players page. Ratings belong to a team, so pick one of the teams they can play for.
export default function PlayerEvalButton({ registrantId, name }: { registrantId: string; name: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const [teams, setTeams] = useState<TeamEvalCard[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const picked = teams?.find((t) => t.teamId === teamId);

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          setTeams(null);
          setError(null);
          dialog.current?.showModal();
          const r = await loadPlayerEvaluations(registrantId);
          if (!r.ok) return setError(r.message);
          setTeams(r.teams);
          setTeamId(r.teams[0]?.teamId ?? null);
        }}
        className="shrink-0 rounded-full px-3 py-1 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
      >
        Evaluate
      </button>
      {toast && <Toast key={toast} message={toast} />}
      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Evaluate {name}</h2>
              <p className="text-sm text-zinc-500">Ratings are kept per team. Pick the team you&apos;re rating for.</p>
            </div>
            <CloseButton onClick={close} />
          </div>
          {error && <Alert tone="red">{error}</Alert>}
          {!teams && !error && <p className="text-sm text-zinc-500">Loading…</p>}
          {teams && !teams.length && <p className="text-sm text-zinc-500">No team for this player&apos;s gender and grade yet.</p>}
          {teams && teams.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Team">
              {teams.map((t) => (
                <button
                  key={t.teamId}
                  type="button"
                  aria-pressed={t.teamId === teamId}
                  onClick={() => setTeamId(t.teamId)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    t.teamId === teamId
                      ? "bg-thunder-blue text-white shadow-sm"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {t.teamName}
                </button>
              ))}
            </div>
          )}
          {picked && (
            <Card
              key={picked.teamId}
              teamId={picked.teamId}
              teamName={picked.teamName}
              card={picked.card}
              // Keep the latest fields, so switching teams and back shows what was just saved.
              onChange={(f) =>
                setTeams((list) => list?.map((t) => (t.teamId === picked.teamId ? { ...t, card: { ...t.card, ...f } } : t)) ?? null)
              }
              onError={setToast}
            />
          )}
        </div>
      </dialog>
    </>
  );
}
