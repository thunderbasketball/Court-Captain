"use client";

import { useRef, useState, useTransition } from "react";
import type { PlayerTeam } from "@/lib/player-team";
import { formatCell } from "@/lib/phone";
import { TZ } from "@/lib/time";
import { actAs } from "./act-as/actions";
import { Alert, CloseButton, Toast, dialogCls } from "./client-ui";
import { RoleDot } from "./Contacts";
import { loadPlayerTeam } from "./org/thunder/players/actions";

export const eyeBtn =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-500 ring-1 ring-zinc-950/15 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:ring-white/20 dark:hover:bg-white/10 dark:hover:text-white";

function Eye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className="size-4">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

// A group of people: a player's team (not View as).
function TeamIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className="size-4">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"
      />
    </svg>
  );
}

// Admins: open the app as this person, view only (the server checks they are an Admin of an organization this person is in).
export function ViewAsButton({ coachId, name }: { coachId: string; name: string }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`View the app as ${name} (view only)`}
        title={`View the app as ${name} (view only)`}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await actAs(coachId);
            if (r && !r.ok) setError(r.message);
          })
        }
        className={eyeBtn}
      >
        <Eye />
      </button>
      {error && <Toast key={error} message={error} />}
    </>
  );
}

const when = (d: Date) =>
  new Date(d).toLocaleString("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Director: a player has no login, so their 👁 shows the team they're on (staff and next practices).
export function PlayerTeamButton({ registrantId, name }: { registrantId: string; name: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const [team, setTeam] = useState<PlayerTeam | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={`${name}'s team`}
        title={`${name}'s team`}
        onClick={async () => {
          setTeam(undefined);
          setError(null);
          dialog.current?.showModal();
          const r = await loadPlayerTeam(registrantId);
          if (r.ok) setTeam(r.team);
          else setError(r.message);
        }}
        className={eyeBtn}
      >
        <TeamIcon />
      </button>
      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{name}</h2>
              <p className="text-sm text-zinc-500">{team ? `${team.name} · ${team.level}` : "Team"}</p>
            </div>
            <CloseButton onClick={close} />
          </div>
          {error && <Alert tone="red">{error}</Alert>}
          {team === undefined && !error && <p className="text-sm text-zinc-500">Loading…</p>}
          {team === null && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/10 dark:text-amber-300">
              No Active Team Assigned
            </p>
          )}
          {team && (
            <>
              <section>
                <h3 className="mb-1 text-xs font-bold tracking-wide text-zinc-500 uppercase">Staff</h3>
                {team.staff.length ? (
                  <ul className="space-y-1.5">
                    {team.staff.map((s) => (
                      <li key={s.role} className="flex items-center gap-2 text-sm">
                        <RoleDot role={s.role} />
                        <span className="font-medium">{s.name}</span>
                        {/^\d{10}$/.test(s.cell) && (
                          <a href={`tel:+1${s.cell}`} className="text-thunder-blue dark:text-blue-400">
                            {formatCell(s.cell)}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-zinc-500">No staff yet.</p>
                )}
              </section>
              <section>
                <h3 className="mb-1 text-xs font-bold tracking-wide text-zinc-500 uppercase">Next practices</h3>
                {team.practices.length ? (
                  <ul className="space-y-1 text-sm">
                    {team.practices.map((p) => (
                      <li key={String(p.at) + p.court}>
                        {when(p.at)} · {p.gym} {p.court}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-zinc-500">None booked.</p>
                )}
              </section>
              <p className="text-xs text-zinc-400">
                Rostered by {team.rosteredBy}, {new Date(team.rosteredAt).toLocaleDateString("en-US", { timeZone: TZ })}
              </p>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
