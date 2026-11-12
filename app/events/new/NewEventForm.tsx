"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GENDER_CHOICES, eventName, gendersOf, type GenderChoice } from "@/lib/event-names";
import { GRADES } from "@/lib/team-names";
import { Alert, useConfirm } from "../../client-ui";
import { card, fieldLabel as label, inputCls, pillCls as pill, primaryBtn } from "../../ui";
import { addEventType, countMatching, createEvent, removeEventType } from "../actions";

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

// `programId`: a Session of that program (from its card on Home); then it stays there when made (`onDone`), instead of
// opening the event's page.
export default function NewEventForm({
  people,
  gyms,
  types,
  programId,
  onDone,
}: {
  people: { id: string; name: string }[];
  gyms: string[];
  types: string[];
  programId?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [kinds, setKinds] = useState(types);
  const [kind, setKind] = useState("");
  const [gender, setGender] = useState<GenderChoice | "">("");
  const [newKind, setNewKind] = useState<string | null>(null); // the "add a type" box, when open
  const [editTypes, setEditTypes] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [signupOpens, setSignupOpens] = useState("");
  const [signupCloses, setSignupCloses] = useState("");
  const tryout = /^tryouts?$/i.test(kind);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [grades, setGrades] = useState<string[]>([]);
  const [staff, setStaff] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [matching, setMatching] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // How many registered players the gender + grade picks match, worked out on the server.
  const filterKey = JSON.stringify({ genders: gender ? gendersOf(gender) : [], grades });
  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      const r = await countMatching(JSON.parse(filterKey));
      if (!stale) setMatching(r.ok ? r.count : null);
    }, 200);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [filterKey]);

  const q = search.trim().toLowerCase();
  const matches = q ? people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8) : [];
  const picked = people.filter((p) => staff.includes(p.id));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await createEvent({ kind, gender, date, time, location, notes, grades, staff, programId, signupOpens, signupCloses });
          if (!r.ok) return setError(r.message);
          if (onDone) {
            router.refresh();
            onDone();
          } else router.push(`/events/${r.id}`);
        });
      }}
    >
      {confirmDialog}
      <section className={`${card} space-y-4 p-4`}>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className={`${label} mb-0`}>Type</p>
            <button type="button" className="text-xs text-zinc-500 hover:underline" onClick={() => setEditTypes(!editTypes)}>
              {editTypes ? "Done" : "Edit types"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) =>
              editTypes ? (
                <button
                  key={k}
                  type="button"
                  className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium text-red-600 dark:bg-zinc-800 dark:text-red-400"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Remove “${k}” from the quick list?`,
                      message: <p>Events already made with it keep their names.</p>,
                      confirmLabel: "Remove",
                      tone: "warning",
                    });
                    if (!ok) return;
                    const r = await removeEventType(k);
                    if (!r.ok) return setError(r.message);
                    setKinds(kinds.filter((x) => x !== k));
                    if (kind === k) setKind("");
                  }}
                >
                  {k} ✕
                </button>
              ) : (
                <button key={k} type="button" className={pill(kind === k)} onClick={() => setKind(k)}>
                  {k}
                </button>
              ),
            )}
            {!editTypes && newKind === null && (
              <button
                type="button"
                className="rounded-full px-4 py-2 text-sm font-medium text-thunder-blue ring-1 ring-thunder-blue/30"
                onClick={() => setNewKind("")}
              >
                + New type
              </button>
            )}
          </div>
          {newKind !== null && (
            <div className="mt-2 flex gap-2">
              <input
                className={inputCls}
                autoFocus
                value={newKind}
                maxLength={40}
                onChange={(e) => setNewKind(e.target.value)}
                placeholder="e.g. Skills Clinic"
              />
              <button
                type="button"
                className="shrink-0 rounded-xl bg-thunder-blue px-4 text-sm font-semibold text-white"
                onClick={async () => {
                  const r = await addEventType(newKind);
                  if (!r.ok) return setError(r.message);
                  setError(null);
                  setKinds([...kinds, r.name]);
                  setKind(r.name);
                  setNewKind(null);
                }}
              >
                Save
              </button>
              <button type="button" className="shrink-0 px-2 text-sm text-zinc-500" onClick={() => setNewKind(null)}>
                Cancel
              </button>
            </div>
          )}
        </div>
        <div>
          <p className={label}>Gender</p>
          <div className="flex gap-2">
            {GENDER_CHOICES.map((g) => (
              <button key={g} type="button" className={pill(gender === g)} onClick={() => setGender(g)}>
                {g}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className={label}>Grades</p>
          <div className="grid grid-cols-7 gap-2 sm:grid-cols-13">
            {GRADES.map((g) => (
              <label
                key={g}
                className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl py-2 text-sm font-medium ring-1 ${
                  grades.includes(g) ? "bg-blue-50 ring-thunder-blue dark:bg-blue-500/10" : "ring-zinc-950/10 dark:ring-white/15"
                }`}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-thunder-blue"
                  checked={grades.includes(g)}
                  onChange={() => setGrades(toggle(grades, g))}
                />
                {g}
              </label>
            ))}
          </div>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {matching === null ? "Counting…" : `${matching} registered player${matching === 1 ? "" : "s"} match`}
        </p>
        <div className="rounded-xl bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
          <p className="text-xs text-zinc-500">Event name</p>
          <p className="font-semibold">
            {kind && gender && grades.length ? eventName(kind, gender, grades) : "Pick a type, gender and grades"}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>Date</span>
          <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>Start time</span>
          <input className={inputCls} type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        {/* Tryouts: when players can join its list (free). */}
        {tryout && (
          <>
            <label className="block">
              <span className={label}>Sign-up opens (optional)</span>
              <input className={inputCls} type="date" value={signupOpens} onChange={(e) => setSignupOpens(e.target.value)} />
            </label>
            <label className="block">
              <span className={label}>Sign-up closes (optional)</span>
              <input className={inputCls} type="date" value={signupCloses} onChange={(e) => setSignupCloses(e.target.value)} />
            </label>
          </>
        )}
      </div>
      <label className="block">
        <span className={label}>Location (optional)</span>
        <input className={inputCls} list="event-gyms" value={location} maxLength={80} onChange={(e) => setLocation(e.target.value)} />
        <datalist id="event-gyms">
          {gyms.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </label>

      <section className={`${card} space-y-3 p-4`}>
        <div>
          <h2 className="font-semibold">Who runs check-in</h2>
          <p className="text-sm text-zinc-500">They&apos;ll see a ✓ Check-in button at the top of the app. You can always run it too.</p>
        </div>
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {picked.map((p) => (
              <button key={p.id} type="button" className={pill(true)} onClick={() => setStaff(toggle(staff, p.id))}>
                {p.name} ✕
              </button>
            ))}
          </div>
        )}
        <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type a name…" />
        {matches.length > 0 && (
          <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/15">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-white/5"
                  onClick={() => {
                    setStaff(toggle(staff, p.id));
                    setSearch("");
                  }}
                >
                  {p.name}
                  {staff.includes(p.id) && <span className="text-thunder-blue">✓</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <label className="block">
        <span className={label}>Notes (optional)</span>
        <textarea className={`${inputCls} min-h-20`} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy || !kind || !gender || !grades.length} className={primaryBtn}>
        {busy ? "Creating…" : "Create event"}
      </button>
    </form>
  );
}
