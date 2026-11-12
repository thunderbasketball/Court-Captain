"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import DirectionsLink from "../../../DirectionsLink";
import PinFields, { NO_PIN, type PinInput } from "../../../PinFields";
import { setSchedulerGymPin } from "../../thunder/facilities/actions";

// A hosting site's gym in Courts: where its host says it is (with Directions), and Scenic City's own pin, which its
// schedules' Directions use instead (the right door or parking lot); set, change or remove it here.
export default function SchedulerPin({
  org,
  gymKey,
  host,
  address,
  hostMap,
  pin,
}: {
  org: string;
  gymKey: string;
  host: string;
  address: string | null;
  hostMap: string | null;
  pin: { label: string; map: string; setBy: string } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<PinInput>(NO_PIN);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const run = (pinText: string | null, label: string | null) =>
    start(async () => {
      const r = await setSchedulerGymPin(org, gymKey, pinText, label);
      setMsg(r.ok ? { ok: true, text: r.label ? `Pin set: ${r.label}` : "Pin removed." } : { ok: false, text: r.message });
      if (r.ok) {
        setValue(NO_PIN);
        setOpen(false);
        router.refresh();
      }
    });
  return (
    <div className="space-y-1.5 border-t border-zinc-100 px-4 py-3 text-xs dark:border-white/5">
      <p className="text-zinc-600 dark:text-zinc-300">
        <span className="font-semibold">{host}&apos;s location:</span>{" "}
        {address ?? (hostMap ? "Pin set" : "Not set by the host yet")}
        <DirectionsLink href={hostMap} />
      </p>
      <p className="text-zinc-600 dark:text-zinc-300">
        <span className="font-semibold">Your pin:</span>{" "}
        {pin ? (
          <>
            {pin.label} (your schedules&apos; Directions go here)
            <DirectionsLink href={pin.map} />
          </>
        ) : (
          "None: your schedules use the host's location."
        )}
      </p>
      <span className="flex flex-wrap gap-3">
        <button type="button" onClick={() => setOpen(!open)} className="font-medium text-thunder-blue hover:underline dark:text-blue-400">
          {open ? "Hide" : pin ? "Change your pin" : "Set your own pin"}
        </button>
        {pin && (
          <button type="button" disabled={busy} onClick={() => run(null, null)} className="font-medium text-zinc-500 hover:underline">
            Remove your pin
          </button>
        )}
      </span>
      {open && (
        <div className="space-y-2 rounded-lg bg-zinc-50 p-2 dark:bg-white/5">
          <PinFields value={value} onChange={setValue} />
          <button
            type="button"
            disabled={busy || !value.pin.trim() || !value.address.trim()}
            onClick={() => run(value.pin, value.address)}
            className="rounded-full bg-thunder-blue px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Save pin
          </button>
        </div>
      )}
      {msg && <p className={msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{msg.text}</p>}
    </div>
  );
}
