"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { setAdmin, setDirectorAreas } from "./org-admin/actions";
import { CloseButton, OnPage, Toast, dialogCls, useConfirm } from "./client-ui";
import { inputCls } from "./ui";

type AreaOption = { key: string; name: string; covers: string };
export type Director = { id: string; name: string; owner: boolean; admin: boolean; areas: string[] };
type Person = { id: string; name: string };

// On an organization's Users page (SPEC.md section 14): Admins add Directors and change their areas; Owners also add and
// remove Admins (the CourtCaptain page manages Owners). The people are listed with everyone else on that page; these are
// the buttons beside the title and the role line in each Director's row.

// The Users page's one "+ Add" button: a menu of what can be added (a new user, a Director, an Admin). The items stay
// mounted while the menu is hidden, so the pop-up an item opens stays open.
export const menuItem =
  "block w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800";

export function AddMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thunder-blue-dark"
      >
        + Add
      </button>
      <div
        role="menu"
        onClick={() => setOpen(false)}
        className={`absolute right-0 z-20 mt-2 w-60 rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15 ${open ? "" : "hidden"}`}
      >
        {children}
      </div>
    </div>
  );
}

// "Director" and (Owners) "Admin" items for the "+ Add" menu, each opening a pop-up.
export function DirectorButtons({
  org,
  areas,
  options,
  canManageAdmins,
  adminOptions,
}: {
  org: string;
  areas: AreaOption[];
  options: Person[];
  canManageAdmins: boolean;
  adminOptions: Person[];
}) {
  return (
    <>
      <PopUp label="Director (choose their areas)" title="Add a Director" className={menuItem}>
        {(close) => <DirectorForm org={org} areas={areas} options={options} onDone={close} />}
      </PopUp>
      {canManageAdmins && (
        <PopUp label="Admin (every area)" title="Add an Admin" className={menuItem}>
          {(close) => <AdminForm org={org} options={adminOptions} onDone={close} />}
        </PopUp>
      )}
    </>
  );
}

// A Director's role in their row: "Owner · every area", "Admin · every area" or "Director of Players · …", with Edit
// (areas) for Directors and Remove Admin for Admins (Owners only).
export function DirectorRole({
  org,
  orgName,
  person,
  areas,
  canManageAdmins,
}: {
  org: string;
  orgName: string;
  person: Director;
  areas: AreaOption[];
  canManageAdmins: boolean;
}) {
  const names = Object.fromEntries(areas.map((a) => [a.key, a.name]));
  const label = person.owner
    ? "Owner · every area"
    : person.admin
      ? "Admin · every area"
      : person.areas.length
        ? person.areas.map((a) => `Director of ${names[a] ?? a}`).join(" · ")
        : "Director · no areas yet";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-xs font-medium text-thunder-blue dark:text-blue-300">{label}</p>
      {person.admin && !person.owner && canManageAdmins && <RemoveAdmin org={org} orgName={orgName} person={person} />}
      {!person.admin && (
        <PopUp label="Edit areas" title={`${person.name}: Director areas`} link>
          {(close) => <DirectorForm org={org} orgName={orgName} areas={areas} person={person} onDone={close} />}
        </PopUp>
      )}
    </div>
  );
}

function PopUp({
  label,
  title,
  link,
  className,
  children,
}: {
  label: string;
  title: string;
  link?: boolean;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // The pop-up follows `open`, so a form can close it after saving.
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? (link ? "text-xs font-medium text-thunder-blue hover:underline" : pill)}
      >
        {label}
      </button>
      <OnPage>
        <dialog
          ref={dialog}
          className={dialogCls}
          onClick={(e) => e.target === dialog.current && close()}
          onClose={() => setOpen(false)}
        >
          <div className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{title}</h2>
              <CloseButton onClick={close} />
            </div>
            {open && children(close)}
            <p className="text-xs text-zinc-500">
              Each Director manages only their areas. Admins have every area and choose Directors; Owners also choose Admins.
            </p>
          </div>
        </dialog>
      </OnPage>
    </>
  );
}

const pill =
  "rounded-full px-3 py-2 text-sm font-medium text-zinc-700 ring-1 ring-zinc-950/15 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20";

// Owners: pick a person to make an Admin (every area).
function AdminForm({ org, options, onDone }: { org: string; options: Person[]; onDone: () => void }) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setAdmin(org, pick, true);
          if (!r.ok) return setError(r.message);
          onDone();
          router.refresh();
        });
      }}
    >
      <select className={`${inputCls} py-2`} value={pick} onChange={(e) => setPick(e.target.value)} autoFocus>
        <option value="" disabled>
          Pick a person to make an Admin…
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !pick}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          Make Admin
        </button>
        <button type="button" onClick={onDone} className="text-sm text-zinc-500">
          Cancel
        </button>
      </div>
    </form>
  );
}

function RemoveAdmin({ org, orgName, person }: { org: string; orgName: string; person: Person }) {
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
              title: `Remove ${person.name} as Admin?`,
              message: `${person.name} won't be an Admin of ${orgName} any more. They stay a Director with no areas until an Admin gives them some.`,
              confirmLabel: "Remove",
            })
          )
            start(async () => {
              const r = await setAdmin(org, person.id, false);
              if (r.ok) router.refresh();
              else setError(r.message);
            });
        }}
      >
        Remove Admin
      </button>
      {error && <Toast key={error} message={error} />}
      {confirmDialog}
    </>
  );
}

// Add (pick a person) or edit (a Director's areas). Saving with no areas removes the Director role.
function DirectorForm({
  org,
  orgName,
  areas,
  options,
  person,
  onDone,
}: {
  org: string;
  orgName?: string;
  areas: AreaOption[];
  options?: { id: string; name: string }[];
  person?: Director;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pick, setPick] = useState(person?.id ?? "");
  const [chosen, setChosen] = useState<string[]>(person?.areas ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  const save = (list: string[]) =>
    start(async () => {
      const r = await setDirectorAreas(org, pick, list);
      if (!r.ok) return setError(r.message);
      onDone();
      router.refresh();
    });

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save(chosen);
      }}
    >
      {options && (
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
      )}
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Director of</legend>
        {areas.map((a) => (
          <label key={a.key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={chosen.includes(a.key)}
              onChange={(e) => setChosen((c) => (e.target.checked ? [...c, a.key] : c.filter((x) => x !== a.key)))}
            />
            <span>
              <span className="font-medium">{a.name}</span> <span className="text-zinc-500">({a.covers})</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || !pick || !chosen.length}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          Save
        </button>
        <button type="button" onClick={onDone} className="text-sm text-zinc-500">
          Cancel
        </button>
        {person && (
          <button
            type="button"
            disabled={busy}
            className="ml-auto text-sm font-medium text-red-600 hover:underline"
            onClick={async () => {
              if (
                await confirm({
                  title: `Remove ${person.name} as Director?`,
                  message: `${person.name} won't be a Director of ${orgName} any more (their other roles stay).`,
                  confirmLabel: "Remove",
                })
              )
                save([]);
            }}
          >
            Remove Director
          </button>
        )}
      </div>
      {confirmDialog}
    </form>
  );
}
