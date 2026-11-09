"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "../client-ui";
import { fieldLabel, inputCls, primaryBtn } from "../ui";
import { switchSoloAccount } from "./actions";

// "Switch to CourtOrg and bring <team>": the organization's name, then its Teams page.
export default function SwitchSolo({ slug, team }: { slug: string; team: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [short, setShort] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="rounded-xl ring-1 ring-zinc-950/10 dark:ring-white/15">
      <button type="button" className="block w-full px-3 py-2.5 text-left" onClick={() => setOpen(!open)}>
        <span className="block font-semibold">Switch to CourtOrg and bring {team}</span>
        <span className="block text-xs text-zinc-500">
          Your CourtSolo account becomes this organization; {team} keeps its name.
        </span>
      </button>
      {open && (
        <form
          className="space-y-3 border-t border-zinc-100 p-3 dark:border-white/5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await switchSoloAccount(slug, name, short);
              if (!r.ok) return setError(r.message);
              router.push(`/org/${r.slug}/teams`);
            });
          }}
        >
          <label className="block">
            <span className={fieldLabel}>Organization name</span>
            <input className={inputCls} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className={fieldLabel}>Short name (up to 20 letters)</span>
            <input className={inputCls} maxLength={20} value={short} onChange={(e) => setShort(e.target.value)} />
          </label>
          {error && <Alert tone="red">{error}</Alert>}
          <button className={primaryBtn} disabled={busy || !name.trim()}>
            {busy ? "Switching…" : "Switch to CourtOrg"}
          </button>
        </form>
      )}
    </div>
  );
}
