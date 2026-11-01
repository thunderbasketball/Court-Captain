"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { changeOrgLogo } from "./register/actions";
import { Alert, PopUp, Toast } from "./client-ui";
import { fieldLabel, primaryBtn } from "./ui";

// Admins: the gear by the organization's name opens its settings: its features (and the ones it asked for), and a new
// logo (PNG, JPEG or WebP, up to 512 KB).
export default function OrgSettings({ org, logo, features }: { org: string; logo: ReactNode; features: ReactNode }) {
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
            <div>
              <h3 className="mb-2 text-sm font-semibold">Features</h3>
              {features}
            </div>
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
