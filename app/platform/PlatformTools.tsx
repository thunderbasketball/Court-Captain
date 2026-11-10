"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { deleteOrganization, setOrgOwner, setOrgFeature, setPlatformAdmin } from "./actions";
import { PopUp, Toast, useConfirm } from "../client-ui";
import { inputCls } from "../ui";
import { GearIcon } from "../OrgSettings";

// The gear on an organization's card: its features in a pop-up (each with its switch).
export function FeaturesGear({ orgName, children }: { orgName: string; children: ReactNode }) {
  return (
    <PopUp
      label={<GearIcon className="size-5" />}
      ariaLabel={`${orgName} features`}
      title={`${orgName} features`}
      className="grid size-9 shrink-0 place-items-center rounded-full text-zinc-500 ring-1 ring-zinc-950/10 hover:bg-zinc-50 hover:text-zinc-800 dark:ring-white/15 dark:hover:bg-white/5 dark:hover:text-zinc-100"
    >
      {() => children}
    </PopUp>
  );
}

// One feature's on/off switch for an organization (turning on is free here, until upgrades are paid for).
export function FeatureSwitch({
  org,
  orgName,
  feature,
  name,
  on,
}: {
  org: string;
  orgName: string;
  feature: string;
  name: string;
  on: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${name} for ${orgName}`}
        disabled={busy}
        onClick={async () => {
          if (
            on &&
            !(await confirm({
              title: `Turn off ${name}?`,
              message: `${orgName} loses ${name} at once: its tabs disappear and its pages show "not found". Its data is kept.`,
              confirmLabel: "Turn off",
            }))
          )
            return;
          start(async () => {
            const r = await setOrgFeature(org, feature, !on);
            if (r.ok) router.refresh();
            else setError(r.message);
          });
        }}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          on ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5.5" : "translate-x-0.5"}`}
        />
      </button>
      {error && <Toast key={error} message={error} />}
      {confirmDialog}
    </>
  );
}

// "+ Add Owner": any active user becomes an Owner of this organization (and an Admin and Director).
export function AddOwner({ org, options }: { org: string; options: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setPick("");
          setError(null);
          setOpen(true);
        }}
        className="rounded-full px-3 py-0.5 text-sm font-medium text-zinc-700 ring-1 ring-zinc-950/15 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20"
      >
        + Add Owner
      </button>
    );
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setOrgOwner(org, pick, true);
          if (!r.ok) return setError(r.message);
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <select className={`${inputCls} max-w-64 py-2`} value={pick} onChange={(e) => setPick(e.target.value)} autoFocus>
        <option value="" disabled>
          Pick a person…
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={busy || !pick}
        className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-sm text-zinc-500">
        Cancel
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}

export function RemoveOwner({ org, orgName, coachId, name }: { org: string; orgName: string; coachId: string; name: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Remove ${name} as Owner`}
        className="rounded-full p-1 text-zinc-400 hover:bg-zinc-200 hover:text-red-600 dark:hover:bg-zinc-700"
        onClick={async () => {
          if (
            await confirm({
              title: `Remove ${name} as Owner?`,
              message: `${name} won't be an Owner of ${orgName} any more (they stay an Admin).`,
              confirmLabel: "Remove",
            })
          )
            start(async () => {
              const r = await setOrgOwner(org, coachId, false);
              if (r.ok) router.refresh();
              else setError(r.message);
            });
        }}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="size-4">
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
        </svg>
      </button>
      {error && <Toast key={error} message={error} />}
      {confirmDialog}
    </>
  );
}

// CourtCaptain Owners: "+ Add Admin" (pick a person) for CourtCaptain staff.
export function AddStaff({ options }: { options: { id: string; name: string }[] }) {
  const router = useRouter();
  return (
    <PopUp
      label="+ Add Admin"
      title="Add a CourtCaptain Admin"
      className="shrink-0 rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thunder-blue-dark"
      note="CourtCaptain Admins have Owner-level access to every organization, in the background."
    >
      {(close) => <StaffForm options={options} onDone={() => (close(), router.refresh())} />}
    </PopUp>
  );
}

function StaffForm({ options, onDone }: { options: { id: string; name: string }[]; onDone: () => void }) {
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setPlatformAdmin(pick, true);
          if (!r.ok) return setError(r.message);
          onDone();
        });
      }}
    >
      <select className={`${inputCls} py-2`} value={pick} onChange={(e) => setPick(e.target.value)} autoFocus>
        <option value="" disabled>
          Pick a person…
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy || !pick}
        className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        Make CourtCaptain Admin
      </button>
    </form>
  );
}

export function RemoveStaff({ coachId, name }: { coachId: string; name: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className="shrink-0 text-xs font-medium text-red-600 hover:underline"
        onClick={async () => {
          if (
            await confirm({
              title: `Remove ${name} as CourtCaptain Admin?`,
              message: "They lose access to the CourtCaptain page and their background access to every organization.",
              confirmLabel: "Remove",
            })
          )
            start(async () => {
              const r = await setPlatformAdmin(coachId, false);
              if (r.ok) router.refresh();
              else setError(r.message);
            });
        }}
      >
        Remove
      </button>
      {error && <Toast key={error} message={error} />}
      {confirmDialog}
    </>
  );
}

// At the bottom of an organization's gear (CourtCaptain Admins): delete it and all its teams. Type its name, then confirm.
export function DeleteOrganization({ org, orgName, teams }: { org: string; orgName: string; teams: number }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const matches = typed.trim().toLowerCase() === orgName.trim().toLowerCase();
  return (
    <div className="mt-4 space-y-2 border-t border-red-600/20 pt-4">
      {confirmDialog}
      <p className="text-sm font-semibold text-red-600 dark:text-red-400">Delete organization</p>
      <p className="text-xs text-zinc-500">
        Removes {orgName}, its {teams} team{teams === 1 ? "" : "s"} (coaches and rosters), their League registrations, its roles,
        features and gyms. People&apos;s logins stay. Not while its teams have League games.
      </p>
      <input
        className={inputCls}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={`Type ${orgName} to delete`}
        aria-label={`Type ${orgName} to delete`}
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        disabled={!matches || busy}
        onClick={async () => {
          const ok = await confirm({
            title: `Delete ${orgName}?`,
            message: <p>This removes {orgName} and all its teams. It can&apos;t be undone.</p>,
            confirmLabel: "Delete",
            tone: "warning",
          });
          if (!ok) return;
          start(async () => {
            setError(null);
            const r = await deleteOrganization(org, typed);
            if (!r.ok) return setError(r.message);
            router.refresh();
          });
        }}
        className="w-full rounded-full px-4 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-600/30 hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:ring-red-400/30 dark:hover:bg-red-500/10"
      >
        {busy ? "Deleting…" : "Delete organization"}
      </button>
    </div>
  );
}
