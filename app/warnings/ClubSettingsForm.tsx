"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "../client-ui";
import { primaryBtn } from "../ui";
import { changeClubActiveDays } from "./actions";

const num =
  "w-16 rounded-md bg-white px-2 py-1 text-center text-sm tabular-nums ring-1 ring-zinc-950/15 dark:bg-zinc-800 dark:ring-white/15";

// The organization gear's CourtClub card (its Admins): how long teams stay active after an event they're in ends.
export default function ClubSettingsForm({ org, days }: { org: string; days: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(days));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const r = await changeClubActiveDays(org, Number(value));
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: "Saved ✓" } : { ok: false, text: r.message });
        if (r.ok) router.refresh();
      }}
    >
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Teams stay active
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Days active after an event ends"
          className={num}
        />
        days after an event ends
      </label>
      <p className="text-xs text-zinc-500">
        A team is active from the day it registers into an event. A new team is active this many days to get registered.
      </p>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <button type="submit" disabled={busy || value === String(days)} className={primaryBtn}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
