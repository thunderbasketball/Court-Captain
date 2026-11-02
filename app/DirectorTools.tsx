"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { addPerson, setAdmin, setDirectorAreas, setOwner } from "./org-admin/actions";
import { PopUp, Toast, useConfirm } from "./client-ui";
import { inputCls } from "./ui";

const AREAS_NOTE =
  "Each Director manages only their areas. Admins have every area and choose Directors; Owners also choose Admins.";

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

// "Director" and (Owners) "Admin" and "Owner" items for the "+ Add" menu, each opening a pop-up.
export function DirectorButtons({
  org,
  areas,
  options,
  canManageAdmins,
  adminOptions,
  ownerOptions = [],
}: {
  org: string;
  areas: AreaOption[];
  options: Person[];
  canManageAdmins: boolean;
  adminOptions: Person[];
  ownerOptions?: Person[]; // Owners: who can be made another Owner
}) {
  return (
    <>
      <PopUp label="Director (choose their areas)" title="Add a Director" className={menuItem} note={AREAS_NOTE}>
        {(close) => <DirectorForm org={org} areas={areas} options={options} onDone={close} />}
      </PopUp>
      {canManageAdmins && (
        <PopUp label="Admin (every area)" title="Add an Admin" className={menuItem} note={AREAS_NOTE}>
          {(close) => <AdminForm org={org} options={adminOptions} onDone={close} />}
        </PopUp>
      )}
      {canManageAdmins && (
        <PopUp label="Owner (also Admin, every area)" title="Add an Owner" className={menuItem} note={AREAS_NOTE}>
          {(close) => <AdminForm org={org} options={ownerOptions} onDone={close} owner />}
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
      {person.owner && canManageAdmins && <RemoveOwner org={org} orgName={orgName} person={person} />}
      {!person.admin && (
        <PopUp label="Edit areas" title={`${person.name}: Director areas`} link note={AREAS_NOTE}>
          {(close) => <DirectorForm org={org} orgName={orgName} areas={areas} person={person} onDone={close} />}
        </PopUp>
      )}
    </div>
  );
}

// Owners: pick a person to make an Admin (every area), or (`owner`) another Owner.
function AdminForm({ org, options, onDone, owner }: { org: string; options: Person[]; onDone: () => void; owner?: boolean }) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [person, setPerson] = useState({ first: "", last: "", cell: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const id = await chosenId(org, pick, person, setError);
          if (!id) return;
          const r = owner ? await setOwner(org, id, true) : await setAdmin(org, id, true);
          if (!r.ok) return setError(r.message);
          onDone();
          router.refresh();
        });
      }}
    >
      <PersonPicker
        options={options}
        pick={pick}
        setPick={setPick}
        person={person}
        setPerson={setPerson}
        prompt={`Pick a person to make ${owner ? "an Owner" : "an Admin"}…`}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !pick}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {owner ? "Make Owner" : "Make Admin"}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-zinc-500">
          Cancel
        </button>
      </div>
    </form>
  );
}

// Owners: take Owner away from someone (they stay an Admin). The last Owner can't be removed.
function RemoveOwner({ org, orgName, person }: { org: string; orgName: string; person: Person }) {
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
              title: `Remove ${person.name} as Owner?`,
              message: `${person.name} won't be an Owner of ${orgName} any more. They stay an Admin.`,
              confirmLabel: "Remove",
            })
          )
            start(async () => {
              const r = await setOwner(org, person.id, false);
              if (r.ok) router.refresh();
              else setError(r.message);
            });
        }}
      >
        Remove Owner
      </button>
      {error && <Toast key={error} message={error} />}
      {confirmDialog}
    </>
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
  const [newPerson, setNewPerson] = useState({ first: "", last: "", cell: "" });
  const [chosen, setChosen] = useState<string[]>(person?.areas ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  const save = (list: string[]) =>
    start(async () => {
      setError(null);
      const id = await chosenId(org, pick, newPerson, setError);
      if (!id) return;
      const r = await setDirectorAreas(org, id, list);
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
        <PersonPicker
          options={options}
          pick={pick}
          setPick={setPick}
          person={newPerson}
          setPerson={setNewPerson}
          prompt="Pick a person…"
        />
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

const NEW_PERSON = "new";
type NewPerson = { first: string; last: string; cell: string };

// Pick someone from the list, or New person… (first, last, cell; their login is found by cell or made).
function PersonPicker({
  options,
  pick,
  setPick,
  person,
  setPerson,
  prompt,
}: {
  options: Person[];
  pick: string;
  setPick: (v: string) => void;
  person: NewPerson;
  setPerson: (p: NewPerson) => void;
  prompt: string;
}) {
  return (
    <>
      <select className={`${inputCls} py-2`} value={pick} onChange={(e) => setPick(e.target.value)} autoFocus>
        <option value="" disabled>
          {prompt}
        </option>
        <option value={NEW_PERSON}>New person…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {pick === NEW_PERSON && (
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inputCls}
            placeholder="First name"
            value={person.first}
            onChange={(e) => setPerson({ ...person, first: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder="Last name"
            value={person.last}
            onChange={(e) => setPerson({ ...person, last: e.target.value })}
          />
          <input
            className={`${inputCls} col-span-2`}
            type="tel"
            inputMode="tel"
            placeholder="Cell (423) 555-0123"
            value={person.cell}
            onChange={(e) => setPerson({ ...person, cell: e.target.value })}
          />
        </div>
      )}
    </>
  );
}

// The person to give the role to: the one picked, or the new person (made first on the server).
async function chosenId(org: string, pick: string, person: NewPerson, onError: (m: string) => void): Promise<string | null> {
  if (pick !== NEW_PERSON) return pick;
  const r = await addPerson(org, person);
  if (!r.ok) {
    onError(r.message);
    return null;
  }
  return r.coachId;
}
