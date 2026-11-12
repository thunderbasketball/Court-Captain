"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "../client-ui";
import { primaryBtn } from "../ui";
import { changeChatEmailSetting } from "./actions";

const num =
  "w-16 rounded-md bg-white px-2 py-1 text-center text-sm tabular-nums ring-1 ring-zinc-950/15 disabled:opacity-50 dark:bg-zinc-800 dark:ring-white/15";

// The organization gear's Feature Settings → Chat (its Admins): email a chat message someone hasn't seen after n hours;
// untick to send no chat emails.
export default function ChatSettingsForm({ org, on, hours }: { org: string; on: boolean; hours: number }) {
  const router = useRouter();
  const [isOn, setOn] = useState(on);
  const [value, setValue] = useState(String(hours));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const r = await changeChatEmailSetting(org, isOn, Number(value));
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: "Saved ✓" } : { ok: false, text: r.message });
        if (r.ok) router.refresh();
      }}
    >
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={isOn} onChange={(e) => setOn(e.target.checked)} />
        Send an email when a chat message is unseen for
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={72}
          value={value}
          disabled={!isOn}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Hours"
          className={num}
        />
        hours
      </label>
      <p className="text-xs text-zinc-500">
        {isOn
          ? "One email lists everything a person hasn't read yet. Untick to send no chat emails."
          : "No chat emails are sent. The unread badges in the app still show."}
      </p>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <button type="submit" disabled={busy || (isOn === on && value === String(hours))} className={primaryBtn}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
