"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IDLE_DAYS, ROSTER_MIN, type WarningSettings } from "@/lib/team-warnings-fields";
import { Alert } from "../client-ui";
import { primaryBtn } from "../ui";
import { changeTeamWarnings } from "./actions";

const num =
  "w-16 rounded-md bg-white px-2 py-1 text-center text-sm tabular-nums ring-1 ring-zinc-950/15 disabled:opacity-50 dark:bg-zinc-800 dark:ring-white/15";

export type WarningPart = "roster" | "idle" | "uniforms";

// The organization gear's Warnings card (its Admins), in the card of the feature that brings them (`parts`): a tick in
// front of each warning turns it on, with its number. Saving keeps the ones not shown as they are.
export default function WarningsForm({
  org,
  settings,
  parts,
  setBy,
}: {
  org: string;
  settings: WarningSettings;
  parts: WarningPart[];
  setBy: string | null;
}) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [min, setMin] = useState(String(settings.roster.min));
  const [days, setDays] = useState(String(settings.idle.days));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const r = await changeTeamWarnings(org, {
      roster: { on: s.roster.on, min: Number(min) },
      idle: { on: s.idle.on, days: Number(days) },
      uniforms: { on: s.uniforms.on },
    });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Saved ✓" } : { ok: false, text: r.message });
    if (r.ok) router.refresh();
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {parts.includes("roster") && (
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={s.roster.on}
          onChange={(e) => setS({ ...s, roster: { ...s.roster, on: e.target.checked } })}
        />
        Team roster with fewer than
        <input
          type="number"
          inputMode="numeric"
          min={ROSTER_MIN[0]}
          max={ROSTER_MIN[1]}
          value={min}
          disabled={!s.roster.on}
          onChange={(e) => setMin(e.target.value)}
          aria-label="Fewest players"
          className={num}
        />
        players
      </label>
      )}
      {parts.includes("idle") && (
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={s.idle.on}
          onChange={(e) => setS({ ...s, idle: { ...s.idle, on: e.target.checked } })}
        />
        Team staff not on the app in the last
        <input
          type="number"
          inputMode="numeric"
          min={IDLE_DAYS[0]}
          max={IDLE_DAYS[1]}
          value={days}
          disabled={!s.idle.on}
          onChange={(e) => setDays(e.target.value)}
          aria-label="Days"
          className={num}
        />
        days
      </label>
      )}
      {parts.includes("uniforms") && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={s.uniforms.on}
            onChange={(e) => setS({ ...s, uniforms: { on: e.target.checked } })}
          />
          Uniform information missing (number or size)
        </label>
      )}
      {setBy && <p className="text-xs text-zinc-500">Last set by {setBy}.</p>}
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <button type="submit" disabled={busy} className={primaryBtn}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
