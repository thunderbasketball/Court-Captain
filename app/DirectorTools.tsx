"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { addPerson, setAdmin, setAssigner, setDirectorAreas, setOwner } from "./org-admin/actions";
import { PopUp, useConfirm } from "./client-ui";
import { inputCls } from "./ui";
import { iconBtn } from "./CardIcons";
import { GearIcon } from "./OrgSettings";

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

export function AddMenu({ children, round = false }: { children: ReactNode; round?: boolean }) {
  const [open, setOpen] = useState(false);
  // Placed on the screen under the button (fixed), so a card that trims its edges can't cut the menu off.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const close = (e: Event) => !box.current?.contains(e.target as Node) && setOpen(false); // not when the menu itself scrolls
    document.addEventListener("pointerdown", away);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        ref={button}
        onClick={() => {
          const r = button.current?.getBoundingClientRect();
          if (r) setAt({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
          setOpen((o) => !o);
        }}
        aria-label="Add"
        title="Add"
        className={
          round
            ? "inline-flex size-9 items-center justify-center rounded-full bg-thunder-blue text-2xl leading-none font-light text-white shadow-sm hover:bg-thunder-blue-dark"
            : "rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thunder-blue-dark"
        }
      >
        {round ? "+" : "+ Add"}
      </button>
      <div
        role="menu"
        onClick={() => setOpen(false)}
        style={at ? { top: at.top, right: at.right } : undefined}
        className={`fixed z-50 max-h-[70vh] w-60 overflow-y-auto rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15 ${open ? "" : "hidden"}`}
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
  directorsOn = true,
  staff = [],
}: {
  org: string;
  areas: AreaOption[];
  options: Person[];
  directorsOn?: boolean; // CourtPlayers or CourtTeams: the organization has Directors
  canManageAdmins: boolean;
  adminOptions: Person[];
  ownerOptions?: Person[]; // Owners: who can be made another Owner
  staff?: Director[]; // its Owners, Admins and Directors (any of them can be the Officials Assigner)
}) {
  // CourtOfficials: anyone on staff not yet an Officials Assigner, then everyone else who could be a Director.
  const assigning = areas.some((a) => a.key === "officials");
  const assignerOptions = [
    ...staff.filter((d) => !d.areas.includes("officials")).map((d) => ({ id: d.id, name: d.name })),
    ...options,
  ].filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i);
  return (
    <>
      {assigning && (
        <PopUp label="Officials Assigner (assigns officials to games)" title="Add an Officials Assigner" className={menuItem} note={AREAS_NOTE}>
          {(close) => <AssignerForm org={org} options={assignerOptions} onDone={close} />}
        </PopUp>
      )}
      {directorsOn && (
        <PopUp label="Director (choose their areas)" title="Add a Director" className={menuItem} note={AREAS_NOTE}>
          {(close) => <DirectorForm org={org} areas={areas} options={options} onDone={close} />}
        </PopUp>
      )}
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
// areas for Directors, and a gear at the top right with Remove Owner / Remove Admin (Owners only) and Make / Remove
// Officials Assigner (Admins; CourtOfficials), each removal asking right there.
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
  // CourtOfficials: the Assigner (officials area) can be given to Owners and Admins too, by name.
  const assigning = areas.some((a) => a.key === "officials");
  const assigner = assigning && person.areas.includes("officials");
  const label = person.owner
    ? `Owner · every area${assigner ? " · Officials Assigner" : ""}`
    : person.admin
      ? `Admin · every area${assigner ? " · Officials Assigner" : ""}`
      : person.areas.length
        ? person.areas.map((a) => (a === "officials" ? "Officials Assigner" : `Director of ${names[a] ?? a}`)).join(" · ")
        : "Director · no areas yet";
  // The row's gear (top right): Remove Owner, Remove Admin, Make / Remove Officials Assigner, each asking right there.
  const actions: RoleAction[] = [
    ...(person.owner && canManageAdmins
      ? [
          {
            key: "owner",
            label: "Remove Owner",
            danger: true,
            ask: `Remove ${person.name} as Owner of ${orgName}? They stay an Admin.`,
            run: () => setOwner(org, person.id, false),
          },
        ]
      : []),
    ...(person.admin && !person.owner && canManageAdmins
      ? [
          {
            key: "admin",
            label: "Remove Admin",
            danger: true,
            ask: `Remove ${person.name} as Admin of ${orgName}? They stay a Director with no areas until an Admin gives them some.`,
            run: () => setAdmin(org, person.id, false),
          },
        ]
      : []),
    ...(person.admin && assigning
      ? [
          assigner
            ? {
                key: "assigner",
                label: "Remove Officials Assigner",
                danger: true,
                ask: `Remove ${person.name} as Officials Assigner? They won't schedule officials any more.`,
                run: () => setAssigner(org, person.id, false),
              }
            : { key: "assigner", label: "Make Officials Assigner", danger: false, ask: null, run: () => setAssigner(org, person.id, true) },
        ]
      : []),
  ];
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs font-medium text-thunder-blue dark:text-blue-300">{label}</p>
          {!person.admin && (
            <PopUp label="Edit areas" title={`${person.name}: Director areas`} link note={AREAS_NOTE}>
              {(close) => <DirectorForm org={org} orgName={orgName} areas={areas} person={person} onDone={close} />}
            </PopUp>
          )}
        </div>
        {actions.length > 0 && <RoleGear name={person.name} actions={actions} />}
      </div>
    </div>
  );
}

type RoleAction = {
  key: string;
  label: string;
  danger: boolean;
  ask: string | null; // asked right there before it's done (null: done at once)
  run: () => Promise<{ ok: true } | { ok: false; message: string }>;
};

// A staff row's gear: opens right under it with the row's role changes; a removal asks "Are you sure?" in place (Keep /
// Remove) before it's done.
function RoleGear({ name, actions }: { name: string; actions: RoleAction[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const run = (a: RoleAction) =>
    start(async () => {
      setError(null);
      const r = await a.run();
      if (!r.ok) return setError(r.message);
      setAsking(null);
      setOpen(false);
      router.refresh();
    });
  return (
    <div className="flex shrink-0 flex-col items-end">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${name}: change roles`}
        onClick={() => (setOpen((o) => !o), setAsking(null), setError(null))}
        className={`${iconBtn} ${open ? "ring-thunder-blue" : ""}`}
      >
        <GearIcon className="size-5" />
      </button>
      {open && (
        <div className="mt-1 w-64 max-w-[80vw] space-y-1 rounded-xl bg-zinc-50 p-2 text-sm ring-1 ring-zinc-950/10 dark:bg-white/5 dark:ring-white/10">
          {actions.map((a) =>
            asking === a.key ? (
              <div key={a.key} className="space-y-2 rounded-lg bg-white p-2 dark:bg-zinc-900">
                <p className="text-xs">{a.ask}</p>
                <div className="flex justify-end gap-2 text-xs">
                  <button type="button" onClick={() => setAsking(null)} className="rounded-full px-2.5 py-1 ring-1 ring-zinc-950/10 dark:ring-white/15">
                    Keep
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(a)}
                    className="rounded-full bg-red-600 px-2.5 py-1 font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? "Removing…" : "Remove"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                key={a.key}
                type="button"
                disabled={busy}
                onClick={() => (a.ask ? setAsking(a.key) : run(a))}
                className={`block w-full rounded-lg px-2 py-1.5 text-left font-medium hover:bg-white dark:hover:bg-zinc-900 ${
                  a.danger ? "text-red-600 dark:text-red-400" : "text-thunder-blue dark:text-blue-300"
                }`}
              >
                {a.label}
              </button>
            ),
          )}
          {error && <p className="px-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}


// Admins: pick a person (on staff already, or someone new by name and cell) to make an Officials Assigner.
function AssignerForm({ org, options, onDone }: { org: string; options: Person[]; onDone: () => void }) {
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
          const r = await setAssigner(org, id, true);
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
        prompt="Pick a person to make an Officials Assigner…"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !pick}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          Make Officials Assigner
        </button>
        <button type="button" onClick={onDone} className="text-sm text-zinc-500">
          Cancel
        </button>
      </div>
    </form>
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
