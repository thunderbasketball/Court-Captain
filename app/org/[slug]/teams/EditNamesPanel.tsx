"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "../../../client-ui";
import { primaryBtn } from "../../../ui";
import { setAltNames } from "./actions";

// Teams card → + → Edit team names: every team's Alternate name in one list (blank: the organization's name), saved
// together. A team's name keeps its pattern: grade and gender, the Alternate name (or the organization's), the Head
// Coach's last name ("8B Lady Bolts Manson").
export function EditNamesPanel({
  org,
  orgName,
  teams,
}: {
  org: string;
  orgName: string; // shown when a team has no Alternate name
  teams: { id: string; name: string; alt: string | null }[];
}) {
  const router = useRouter();
  const [alts, setAlts] = useState<Record<string, string>>(Object.fromEntries(teams.map((t) => [t.id, t.alt ?? ""])));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const changed = teams.filter((t) => (alts[t.id] ?? "").trim() !== (t.alt ?? ""));
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Each team&apos;s Alternate name goes in its name in place of &ldquo;{orgName}&rdquo;. Leave it blank to use {orgName}.
      </p>
      <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
        {teams.map((t) => (
          <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 text-sm">
            <span className="truncate text-zinc-600 dark:text-zinc-300">{t.name}</span>
            <input
              value={alts[t.id] ?? ""}
              placeholder={orgName}
              maxLength={60}
              onChange={(e) => setAlts({ ...alts, [t.id]: e.target.value })}
              className={`w-full rounded-lg border bg-white px-2 py-1.5 dark:bg-zinc-900 ${
                (alts[t.id] ?? "").trim() !== (t.alt ?? "") ? "border-thunder-blue" : "border-zinc-300 dark:border-white/15"
              }`}
              aria-label={`${t.name} Alternate name`}
            />
          </li>
        ))}
      </ul>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <button
        type="button"
        disabled={busy || !changed.length}
        onClick={() =>
          start(async () => {
            const r = await setAltNames(
              org,
              changed.map((t) => ({ id: t.id, alt: (alts[t.id] ?? "").trim() })),
            );
            if (!r.ok) return setMsg({ ok: false, text: r.message });
            setMsg({ ok: true, text: `Saved ${changed.length} name${changed.length === 1 ? "" : "s"}.` });
            router.refresh();
          })
        }
        className={`${primaryBtn} w-full`}
      >
        {busy ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes"}
      </button>
    </div>
  );
}
