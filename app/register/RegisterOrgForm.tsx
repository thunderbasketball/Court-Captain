"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerOrganization } from "./actions";
import { Alert } from "../client-ui";
import { fieldLabel, inputCls, pillCls, primaryBtn } from "../ui";

type FeatureChoice = { key: string; name: string; about: string; ready: boolean };

// The new organization's details and what it needs. Live at once; the person registering is its Owner.
export default function RegisterOrgForm({
  kinds,
  labels,
  kindPreset,
  colors,
  features,
  preset = [],
}: {
  kinds: readonly string[];
  labels: Record<string, string>; // "Officials" reads "Officials Group"
  kindPreset: Partial<Record<string, string[]>>; // what picking a type ticks (an Officials Group: CourtOfficials, CourtSync)
  colors: readonly string[];
  features: FeatureChoice[];
  preset?: string[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState("");
  const [color, setColor] = useState(colors[0]);
  const [picked, setPicked] = useState<string[]>(preset);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        form.set("kind", kind);
        form.set("color", color);
        form.delete("features");
        for (const f of picked) form.append("features", f);
        start(async () => {
          setError(null);
          const r = await registerOrganization(form);
          if (!r.ok) return setError(r.message);
          // The server made it the role in use (switch back from the logo menu). With CourtOrg: straight to its Teams.
          router.push(picked.includes("court-club") && kind !== "Officials" ? `/org/${r.slug}/teams` : `/org/${r.slug}`);
        });
      }}
    >
      <label className="block">
        <span className={fieldLabel}>Organization name</span>
        <input name="name" className={inputCls} maxLength={60} required placeholder="Baylor School" />
      </label>
      <label className="block">
        <span className={fieldLabel}>Short name (shown in menus)</span>
        <input name="short" className={inputCls} maxLength={20} placeholder="Baylor" />
      </label>
      <div>
        <span className={fieldLabel}>Type</span>
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className={pillCls(kind === k)}
              onClick={() => {
                setKind(k);
                const add = kindPreset[k] ?? [];
                if (add.length) setPicked((p) => [...new Set([...p, ...add])]);
              }}
            >
              {labels[k] ?? k}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={fieldLabel}>Logo (PNG, JPEG or WebP, up to 512 KB)</span>
        <div className="flex items-center gap-3">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file
            <img src={preview} alt="" className="size-14 rounded-xl object-contain ring-1 ring-zinc-950/10" />
          ) : (
            <span
              className="inline-flex size-14 items-center justify-center rounded-xl text-xl font-bold text-white"
              style={{ backgroundColor: color }}
            >
              ?
            </span>
          )}
          <input
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
          />
        </div>
      </div>
      <div>
        <span className={fieldLabel}>Color</span>
        <div className="flex flex-wrap gap-2">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={`size-9 rounded-full ring-offset-2 dark:ring-offset-zinc-900 ${color === c ? "ring-2 ring-zinc-900 dark:ring-white" : ""}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      <fieldset>
        <legend className={fieldLabel}>What do you need?</legend>
        <div className="space-y-2">
          {features.map((f) => (
            <label key={f.key} className="flex items-start gap-3 rounded-xl p-2 ring-1 ring-zinc-950/5 dark:ring-white/10">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={picked.includes(f.key)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f.key] : p.filter((x) => x !== f.key)))}
              />
              <span className="text-sm">
                <span className="font-medium">{f.name}</span>
                {!f.ready && (
                  <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800">
                    coming soon
                  </span>
                )}
                <span className="block text-zinc-500">{f.about}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Ready ones turn on now. &quot;Coming soon&quot; ones are noted for your organization and turn on when they&apos;re
          ready.
        </p>
      </fieldset>
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}
