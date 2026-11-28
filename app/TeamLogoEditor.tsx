"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTeamLogo } from "./team-logo/actions";
import { Alert } from "./client-ui";
import { fieldLabel, primaryBtn } from "./ui";

// A team's logo, on its team page (its Head Coach or Team Manager, or its organization's Directors of Teams): a small
// "Team logo" button that opens the form right there (PNG, JPEG or WebP, up to 512 KB). It's drawn on the team's Game Day
// pictures in place of its organization's logo.
export default function TeamLogoEditor({ kind, id, logo }: { kind: "thunder" | "org" | "league"; id: string; logo: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const save = (form: FormData) =>
    start(async () => {
      setError(null);
      setDone(null);
      const r = await saveTeamLogo(kind, id, form);
      if (!r.ok) return setError(r.message);
      setPreview(null);
      setDone(form.get("remove") === "1" ? "Removed." : "Saved. It's on the team's Game Day pictures now.");
      router.refresh();
    });
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="rounded-full px-3 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-950/15 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20 dark:hover:bg-white/5"
      >
        {logo ? "Change team logo" : "+ Team logo"}
      </button>
      {open && (
        <form
          className="mt-3 space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5"
          onSubmit={(e) => {
            e.preventDefault();
            save(new FormData(e.currentTarget));
            e.currentTarget.reset();
          }}
        >
          <span className={fieldLabel}>PNG, JPEG or WebP, up to 512 KB. Shown on the team&apos;s Game Day pictures.</span>
          <div className="flex items-center gap-3">
            {preview || logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the chosen file or the current logo
              <img src={preview ?? logo!} alt="" className="size-16 rounded-xl bg-white object-contain ring-1 ring-zinc-950/10" />
            ) : (
              <span className="grid size-16 place-items-center rounded-xl text-xs text-zinc-400 ring-1 ring-zinc-950/10">None</span>
            )}
            <input
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
              className="min-w-0 text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </div>
          {error && <Alert tone="red">{error}</Alert>}
          {done && <Alert tone="green">{done}</Alert>}
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy ? "Saving…" : "Save logo"}
          </button>
          {logo && (
            <button
              type="button"
              disabled={busy}
              className="w-full text-sm text-red-600 hover:underline"
              onClick={() => {
                const f = new FormData();
                f.set("remove", "1");
                save(f);
              }}
            >
              Remove logo
            </button>
          )}
        </form>
      )}
    </div>
  );
}
