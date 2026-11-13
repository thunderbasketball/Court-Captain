"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addScrimmageAction, removeScrimmageAction, updateScrimmageAction } from "./actions";
import { iconBtn } from "../CardIcons";
import { GearIcon } from "../OrgSettings";

const input = "w-full min-w-0 rounded-lg bg-white px-3 py-2 text-base ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15";
const label = "mb-1 block text-xs font-medium text-zinc-500";
const OUTSIDE = "outside";
const ELSEWHERE = "elsewhere";

type Choices = {
  teams: { id: string; name: string; gender: string; grade: number }[];
  gyms: { id: string; name: string }[];
  officials: { org: string; name: string }[];
};

type Fields = {
  home: string;
  homeName: string;
  away: string;
  awayName: string;
  date: string;
  time: string;
  minutes: string;
  gymId: string;
  location: string;
  officials: string;
};

// + Scrimmage's form, right in the program's card: Home and Away, each one of your teams, TBD, or an outside team typed in.
// Picking a team on one side narrows the other side to teams of the same gender a grade up or down (the same team is
// listed too, with a warning: an intrasquad scrimmage); with neither picked, either side lists every team; date, start and length; where (one of your gyms, the whole gym, which blocks its time, or any place typed in);
// Schedule officials (ticked: pick the Officials Group, and it shows on that group's page to be scheduled).
// With `edit`: the same form filled in, saving changes to that scrimmage.
export function NewScrimmageForm({
  org,
  programId,
  choices,
  edit,
  onDone,
}: {
  org: string;
  programId?: string;
  choices: Choices;
  edit?: { id: string; form: Fields };
  onDone?: () => void;
}) {
  const router = useRouter();
  const blank: Fields = { home: "", homeName: "", away: "", awayName: "", date: "", time: "", minutes: "60", gymId: "", location: "", officials: "" };
  const [f, setF] = useState<Fields>(edit?.form ?? blank);
  const [refs, setRefs] = useState(!!edit?.form.officials); // Schedule officials ticked
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const outside = f.away === OUTSIDE;
  const homeOutside = f.home === OUTSIDE;
  const elsewhere = f.gymId === ELSEWHERE;
  const team = (id: string) => choices.teams.find((t) => t.id === id);
  const same = !!f.home && f.home === f.away && !!team(f.home);
  const ready =
    f.home && f.away && (!outside || f.awayName.trim()) && (!homeOutside || f.homeName.trim()) && f.date && f.time && f.gymId && (!elsewhere || f.location.trim()) && (!refs || f.officials);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const input = {
            home: homeOutside ? "" : f.home,
            homeName: homeOutside ? f.homeName : "",
            away: outside ? "" : f.away,
            awayName: outside ? f.awayName : "",
            date: f.date,
            time: f.time,
            minutes: Number(f.minutes),
            gymId: elsewhere ? "" : f.gymId,
            location: elsewhere ? f.location : "",
            officials: refs ? f.officials : "",
          };
          const r = edit ? await updateScrimmageAction(org, edit.id, input) : await addScrimmageAction(org, programId ?? "", input);
          setMsg(
            r.ok
              ? { ok: true, text: `Scrimmage ${edit ? "saved" : "added"} ✓${r.blocked ? ` (that gym time is blocked)` : ""}` }
              : { ok: false, text: r.message },
          );
          if (r.ok) {
            if (!edit) {
              setF(blank);
              setRefs(false);
            }
            router.refresh();
            onDone?.();
          }
        });
      }}
    >
      {!edit && <p className="text-sm font-semibold">Add a scrimmage</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TeamSide
          title="Home"
          value={f.home}
          name={f.homeName}
          other={team(f.away)}
          teams={choices.teams}
          onPick={(v) => setF({ ...f, home: v })}
          onName={(v) => setF({ ...f, homeName: v })}
        />
        <TeamSide
          title="Away"
          value={f.away}
          name={f.awayName}
          other={team(f.home)}
          teams={choices.teams}
          onPick={(v) => setF({ ...f, away: v })}
          onName={(v) => setF({ ...f, awayName: v })}
        />
        {same && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:col-span-2 dark:bg-amber-500/10 dark:text-amber-300">
            ⚠ {team(f.home)!.name} is on both sides: an intrasquad scrimmage. Pick another team if that&apos;s not what you meant.
          </p>
        )}
        <label className="block">
          <span className={label}>Date</span>
          <input type="date" className={input} value={f.date} onChange={set("date")} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={label}>Starts</span>
            <input type="time" step={900} className={input} value={f.time} onChange={set("time")} />
          </label>
          <label className="block">
            <span className={label}>Length</span>
            <select className={input} value={f.minutes} onChange={set("minutes")}>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="90">1½ hours</option>
              <option value="120">2 hours</option>
            </select>
          </label>
        </div>
        <label className="block sm:col-span-2">
          <span className={label}>Where</span>
          <select className={input} value={f.gymId} onChange={set("gymId")}>
            <option value="">Pick a gym…</option>
            {choices.gyms.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value={ELSEWHERE}>Another place (type it)</option>
          </select>
        </label>
        {elsewhere && (
          <label className="block sm:col-span-2">
            <span className={label}>Place</span>
            <input className={input} maxLength={80} placeholder="Signal Mountain Middle School" value={f.location} onChange={set("location")} />
          </label>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="size-5 accent-thunder-blue"
            checked={refs}
            disabled={!choices.officials.length}
            onChange={(e) => setRefs(e.target.checked)}
          />
          <span>
            Schedule officials
            {!choices.officials.length && <span className="text-zinc-400"> (no officials groups on CourtCaptain yet)</span>}
          </span>
        </label>
        {refs && (
          <label className="block sm:col-span-2">
            <span className={label}>Officials group</span>
            <select className={input} value={f.officials} onChange={set("officials")}>
              <option value="">Pick an officials group…</option>
              {choices.officials.map((g) => (
                <option key={g.org} value={g.org}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <button
        type="submit"
        disabled={busy || !ready}
        className="rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? (edit ? "Saving…" : "Adding…") : edit ? "Save changes" : "Add scrimmage"}
      </button>
      {edit && (
        <button type="button" onClick={onDone} className="ml-3 text-sm text-zinc-500">
          Cancel
        </button>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
    </form>
  );
}

// Remove, asking right here first (frees the court time it blocked).
export function RemoveScrimmage({ org, id }: { org: string; id: string }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!sure)
    return (
      <button type="button" onClick={() => setSure(true)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
        Remove
      </button>
    );
  return (
    <span className="flex flex-wrap items-center justify-end gap-2 text-xs">
      <span>Remove this scrimmage?</span>
      <button type="button" onClick={() => setSure(false)} className="rounded-full px-2.5 py-1 ring-1 ring-zinc-950/10 dark:ring-white/15">
        Keep
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await removeScrimmageAction(org, id);
            if (r.ok) router.refresh();
            else setMsg(r.message);
          })
        }
        className="rounded-full bg-red-600 px-2.5 py-1 font-semibold text-white disabled:opacity-50"
      >
        Remove
      </button>
      {msg && <span className="text-red-600 dark:text-red-400">{msg}</span>}
    </span>
  );
}

// One scrimmage on the program's list: teams, when, length, place, Added by; for those who change them, a gear at its
// top right that opens, right under it, the form filled in (Save changes) and Remove (asks right there).
export function ScrimmageItem({
  org,
  s,
  when,
  choices,
}: {
  org: string;
  s: {
    id: string;
    home: string;
    away: string;
    outside: boolean;
    homeOutside?: boolean;
    place: string;
    minutes: number;
    addedBy: string;
    officials: string | null;
    form: Fields;
  };
  when: string;
  choices: Choices | null; // null: view only
}) {
  const [open, setOpen] = useState(false);
  const length = s.minutes < 60 ? `${s.minutes} minutes` : s.minutes === 60 ? "1 hour" : `${s.minutes / 60} hours`;
  return (
    <li className="px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block font-medium">
            {s.home}
            {s.homeOutside && <span className="font-normal text-zinc-500"> (outside)</span>} vs {s.away}
            {s.outside && <span className="font-normal text-zinc-500"> (outside)</span>}
          </span>
          <span className="block text-xs text-zinc-500">
            {when} · {length} · {s.place}
          </span>
          {s.officials && <span className="block text-xs text-zinc-500">Officials: {s.officials}</span>}
          <span className="block text-xs text-zinc-400">Added by {s.addedBy}</span>
          {choices && (
            <a
              href={`/print/scoresheets?scrimmage=${s.id}`}
              target="_blank"
              rel="noopener"
              className="mt-1 inline-block text-xs font-semibold text-thunder-blue hover:underline dark:text-blue-400"
            >
              🖨 Scoresheet
            </a>
          )}
        </span>
        {choices && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${s.home} vs ${s.away}: change or remove`}
            onClick={() => setOpen((o) => !o)}
            className={`${iconBtn} shrink-0 ${open ? "ring-thunder-blue" : ""}`}
          >
            <GearIcon className="size-5" />
          </button>
        )}
      </div>
      {choices && open && (
        <div className="mt-2 space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
          <NewScrimmageForm org={org} choices={choices} edit={{ id: s.id, form: s.form }} onDone={() => setOpen(false)} />
          <div className="flex justify-end border-t border-zinc-200 pt-2 dark:border-white/10">
            <RemoveScrimmage org={org} id={s.id} />
          </div>
        </div>
      )}
    </li>
  );
}

// One side of a scrimmage: Pick a team…, TBD, An outside team (its name typed in), then the organization's teams. With a
// team picked on the other side, only teams of its gender a grade up or down (that team too, marked "same team").
function TeamSide({
  title,
  value,
  name,
  other,
  teams,
  onPick,
  onName,
}: {
  title: string;
  value: string;
  name: string;
  other: { id: string; gender: string; grade: number } | undefined;
  teams: Choices["teams"];
  onPick: (v: string) => void;
  onName: (v: string) => void;
}) {
  const list = other
    ? teams.filter((t) => t.id === value || (t.gender === other.gender && Math.abs(t.grade - other.grade) <= 1))
    : teams;
  return (
    <div className="space-y-3">
      <label className="block">
        <span className={label}>{title}</span>
        <select className={input} value={value} onChange={(e) => onPick(e.target.value)}>
          <option value="">Pick a team…</option>
          <option value="tbd">TBD</option>
          <option value={OUTSIDE}>An outside team (type its name)</option>
          {list.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {other && t.id === other.id ? " (same team)" : ""}
            </option>
          ))}
        </select>
      </label>
      {value === OUTSIDE && (
        <label className="block">
          <span className={label}>{title}: outside team</span>
          <input className={input} maxLength={60} placeholder="Signal Mountain 5G" value={name} onChange={(e) => onName(e.target.value)} />
        </label>
      )}
    </div>
  );
}
