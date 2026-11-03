"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { changeOrgAbbr, changeOrgColor, changeOrgLogo, renameOrganization } from "./register/actions";
import { Alert, PopUp, Toast } from "./client-ui";
import { slugFor } from "@/lib/org-slug";
import { fieldLabel, inputCls, primaryBtn } from "./ui";

// Admins: the gear after the last tab opens the organization's settings: its login link, features (and the ones it asked
// for), color (tabs, header line, letter badge) and logo (PNG, JPEG or WebP, up to 512 KB).
export default function OrgSettings({
  org,
  logo,
  features,
  featuresOn,
  color,
  colors,
  login,
  abbr,
  name,
  short,
  canRename,
}: {
  org: string;
  logo: ReactNode;
  features: ReactNode;
  featuresOn: number; // shown while the list is collapsed
  color: string;
  colors: readonly string[];
  login: string;
  abbr: string;
  name: string;
  short: string;
  canRename: boolean; // Owners
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <PopUp
        label={<GearIcon />}
        ariaLabel="Organization settings"
        title="Organization settings"
        className="shrink-0 rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        {(close) => (
          <div className="space-y-5">
            <p className="text-sm text-zinc-500">
              Login link: <span className="font-mono text-zinc-800 dark:text-zinc-200">{login}</span>
            </p>
            {/* Collapsed until tapped: the full list is long. */}
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <span>
                  Features <span className="font-normal text-zinc-500">· {featuresOn} on</span>
                </span>
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden
                  className="size-4 text-zinc-400 transition-transform group-open:rotate-180"
                >
                  <path d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </summary>
              <div className="mt-2">{features}</div>
            </details>
            {canRename && (
              <NameForm
                org={org}
                name={name}
                short={short}
                onSaved={(slug) => {
                  close();
                  setMsg("Name saved.");
                  // A new web address: the same page there.
                  if (slug !== org) router.replace(window.location.pathname.replace(`/${org}`, `/${slug}`));
                  else router.refresh();
                }}
              />
            )}
            <AbbrForm
              org={org}
              abbr={abbr}
              onSaved={() => {
                setMsg("Abbreviation saved.");
                router.refresh();
              }}
            />
            <ColorPicker
              org={org}
              color={color}
              colors={colors}
              onSaved={() => {
                setMsg("Color saved.");
                router.refresh();
              }}
            />
            <LogoForm
              org={org}
              logo={logo}
              onSaved={() => {
                close();
                setMsg("Logo saved.");
                router.refresh();
              }}
            />
          </div>
        )}
      </PopUp>
      {msg && <Toast key={msg} message={msg} />}
    </>
  );
}

// Owners: the name (its web address and login link follow it, and the old ones keep working) and short name.
function NameForm({ org, name, short, onSaved }: { org: string; name: string; short: string; onSaved: (slug: string) => void }) {
  const [value, setValue] = useState(name);
  const [shortValue, setShortValue] = useState(short);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const fixed = org === "thunder" || org === "scenic-city";
  const next = fixed ? org : slugFor(value);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await renameOrganization(org, value, shortValue);
          if (!r.ok) return setError(r.message);
          onSaved(r.slug);
        });
      }}
    >
      <h3 className="text-sm font-semibold">Name</h3>
      <input className={inputCls} maxLength={60} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Name" />
      <label className="block text-xs text-zinc-500">
        Short name (up to 20)
        <input
          className={`${inputCls} mt-0.5`}
          maxLength={20}
          value={shortValue}
          onChange={(e) => setShortValue(e.target.value)}
        />
      </label>
      {next !== org && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          The web address changes to <span className="font-mono">/org/{next}</span> (login link{" "}
          <span className="font-mono">/login/{next}</span>). The old links keep working.
        </p>
      )}
      <button
        type="submit"
        disabled={busy || (value.trim() === name && shortValue.trim() === short)}
        className={`${primaryBtn} w-full`}
      >
        {busy ? "Saving…" : "Save name"}
      </button>
      {error && <Alert tone="red">{error}</Alert>}
    </form>
  );
}

// The Abbreviation, shown before the organization's team names in leagues ("ER 5B Harris").
function AbbrForm({ org, abbr, onSaved }: { org: string; abbr: string; onSaved: () => void }) {
  const [value, setValue] = useState(abbr);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await changeOrgAbbr(org, value);
          if (!r.ok) return setError(r.message);
          onSaved();
        });
      }}
    >
      <h3 className="mb-2 text-sm font-semibold">Abbreviation</h3>
      <div className="flex gap-2">
        <input className={`${inputCls} w-28`} maxLength={6} value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" disabled={busy || value.trim() === abbr} className={primaryBtn}>
          Save
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Up to 6 letters or numbers. Shown before your team names in leagues, like &quot;{value.trim() || abbr} 5B Harris&quot;.
      </p>
      {error && <Alert tone="red">{error}</Alert>}
    </form>
  );
}

function ColorPicker({
  org,
  color,
  colors,
  onSaved,
}: {
  org: string;
  color: string;
  colors: readonly string[];
  onSaved: () => void;
}) {
  const [busy, start] = useTransition();
  const [picked, setPicked] = useState(color);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Color</h3>
      <div className="flex flex-wrap gap-2">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            disabled={busy}
            aria-label={`Color ${c}`}
            aria-pressed={picked === c}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await changeOrgColor(org, c);
                if (!r.ok) return setError(r.message);
                setPicked(c);
                onSaved();
              })
            }
            className={`size-9 rounded-full ring-offset-2 dark:ring-offset-zinc-900 ${picked === c ? "ring-2 ring-zinc-900 dark:ring-white" : ""}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-zinc-500">The tab in use, the line along the top, and the letter badge.</p>
      {error && <Alert tone="red">{error}</Alert>}
    </div>
  );
}

function LogoForm({ org, logo, onSaved }: { org: string; logo: ReactNode; onSaved: () => void }) {
  const [busy, start] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          setError(null);
          const r = await changeOrgLogo(org, form);
          if (!r.ok) return setError(r.message);
          onSaved();
        });
      }}
    >
      <span className={fieldLabel}>Logo (PNG, JPEG or WebP, up to 512 KB)</span>
      <div className="flex items-center gap-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file
          <img src={preview} alt="" className="size-14 rounded-xl object-contain ring-1 ring-zinc-950/10" />
        ) : (
          logo
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
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Saving…" : "Save logo"}
      </button>
    </form>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-6" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}
