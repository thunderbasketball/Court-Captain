"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideOfficiatingAction, requestOfficiatingAction, setGymOfficialsAction } from "./actions";

const btn = "rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50";

// The Officials Group asks a league to officiate its games.
export function RequestOfficiating({ officialsOrg, forOrg, name, again }: { officialsOrg: string; forOrg: string; name: string; again?: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-thunder-blue text-white`}
        onClick={() =>
          start(async () => {
            const r = await requestOfficiatingAction(officialsOrg, forOrg);
            setMsg(r.ok ? null : r.message);
            if (r.ok) router.refresh();
          })
        }
      >
        {again ? "Ask again" : "Request to officiate"}
      </button>
      {msg && <span className="text-xs text-red-600 dark:text-red-400">{msg}</span>}
      <span className="sr-only">{name}</span>
    </span>
  );
}

// The league approves, or declines (asked right here first).
export function DecideOfficiating({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const decide = (approve: boolean) =>
    start(async () => {
      const r = await decideOfficiatingAction(id, approve);
      setMsg(r.ok ? null : r.message);
      if (r.ok) router.refresh();
    });
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {sure ? (
        <>
          <span className="text-xs">Decline {name}? They can ask again.</span>
          <button type="button" onClick={() => setSure(false)} className={`${btn} ring-1 ring-zinc-950/10 dark:ring-white/15`}>
            Keep
          </button>
          <button type="button" disabled={busy} onClick={() => decide(false)} className={`${btn} bg-red-600 text-white`}>
            Decline
          </button>
        </>
      ) : (
        <>
          <button type="button" disabled={busy} onClick={() => decide(true)} className={`${btn} bg-thunder-blue text-white`}>
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setSure(true)}
            className={`${btn} text-zinc-700 ring-1 ring-zinc-950/10 dark:text-zinc-200 dark:ring-white/15`}
          >
            Decline
          </button>
        </>
      )}
      {msg && <span className="w-full text-right text-xs text-red-600 dark:text-red-400">{msg}</span>}
    </div>
  );
}

// A hosting gym's officials group (the league's Admins and Directors of Scheduling, Programs or Facilities): one of the
// approved groups, or none. Saves as soon as it's picked.
export function GymOfficialsPicker({
  org,
  gymKey,
  gym,
  groups,
  current,
}: {
  org: string;
  gymKey: string;
  gym: string;
  groups: { org: string; name: string }[];
  current: string | null;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">Officials</span>
      <select
        aria-label={`${gym}: officials group`}
        disabled={busy}
        value={current ?? ""}
        onChange={(e) =>
          start(async () => {
            const r = await setGymOfficialsAction(org, gymKey, e.target.value || null);
            setMsg(r.ok ? null : r.message);
            if (r.ok) router.refresh();
          })
        }
        className="rounded-lg bg-white px-2 py-1.5 text-sm ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15"
      >
        <option value="">No officials group</option>
        {groups.map((g) => (
          <option key={g.org} value={g.org}>
            {g.name}
          </option>
        ))}
      </select>
      {msg && <span className="text-xs text-red-600 dark:text-red-400">{msg}</span>}
    </label>
  );
}
