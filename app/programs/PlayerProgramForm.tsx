"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlayerProgramFields } from "@/lib/player-programs";
import { PROGRAM_GENDERS, PROGRAM_GRADES, kindLabel, whoLine, type ProgramKind } from "@/lib/program-kinds";
import Section from "./ProgramSection";
import { Alert } from "../client-ui";
import { inputCls, primaryBtn } from "../ui";
import { addFacilityAt, changePlayerProgram, removePlayerProgram } from "./actions";
import PlaceSearch from "../PlaceSearch";

const EMPTY = { name: "", regOpens: "", regCloses: "", payOpens: "", payCloses: "", seasonFrom: "", startsOn: "", endsOn: "", tryoutRegOpens: "", tryoutRegCloses: "" };
// Tryouts, by date: each date has its place and one or more groups (a gender, its grades, a start time).
type TryoutGroup = { genders: string[]; grades: string[]; time: string }; // Boys and/or Girls (no Coed tryouts)
type TryoutDay = { date: string; location: string; groups: TryoutGroup[] };

// The General card's choices (app/programs/ProgramForm.tsx): its name, type and that type's options.
export type PlayerGeneral = {
  name: string;
  kind: ProgramKind;
  tryouts: boolean;
  openGyms: boolean;
  scrimmages: boolean;
  sessions: string;
  genders: string[]; // Boys and/or Girls
  boysGrades: string[]; // each gender's grades
  girlsGrades: string[];
  feeLevels: { name: string; fee: string; endsOn: string; boysGrades: string[]; girlsGrades: string[] }[]; // the Fees card
  // Its dates: a Season's from a team program (seasonFrom) or typed in; registration opens and (optionally) closes.
  dates: { seasonFrom: string; startsOn: string; endsOn: string; regOpens: string; regCloses: string };
};

// A player program's own card (Season, Training Session or Training Course), under the General (name, type, options,
// dates and registration) and Fees cards: (a Season with Tryouts) its tryouts; then Add program / Save. `program` to
// change one; without it, a new one. Its payment dates aren't asked any more (a program's earlier ones are kept).
export default function PlayerProgramForm({
  org,
  program,
  onDone,
  canDelete = false,
  facilities = [],
  general,
  onSaved,
}: {
  general: PlayerGeneral;
  onSaved?: () => void; // a new program was added: the General card starts over
  facilities?: string[]; // the organization's gyms, for a tryout's Place
  canDelete?: boolean; // empty (no players, no Sessions): Delete shows
  org: string;
  program?: PlayerProgramFields;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState(program ?? EMPTY);
  // Its type and options come from the General card (they decide its Sessions, their grades, and its scrimmages).
  const { kind, tryouts, openGyms } = general;
  const { genders, boysGrades, girlsGrades } = general; // who it's for: the General card
  // Tryouts to add (each becomes one of the program's Tryouts sessions when it's saved).
  const [tryoutDays, setTryoutDays] = useState<TryoutDay[]>([]);
  const [places, setPlaces] = useState(facilities); // grows when a facility is added here
  const [adding, setAdding] = useState<number | null>(null); // the tryout date whose "+ Add a facility…" is open
  const [placeMsg, setPlaceMsg] = useState<string | null>(null);
  const newGroup = (): TryoutGroup => ({ genders: [...genders], grades: [], time: "" });
  // A tryout group's grades: those its genders have.
  const groupGrades = (gs: string[]) =>
    PROGRAM_GRADES.filter((x) => (gs.includes("Boys") && boysGrades.includes(x)) || (gs.includes("Girls") && girlsGrades.includes(x)));
  const setDay = (i: number, d: Partial<TryoutDay>) => setTryoutDays((l) => l.map((x, j) => (j === i ? { ...x, ...d } : x)));
  const setGroup = (i: number, k: number, g: Partial<TryoutGroup>) =>
    setTryoutDays((l) => l.map((x, j) => (j === i ? { ...x, groups: x.groups.map((y, n) => (n === k ? { ...y, ...g } : y)) } : x)));
  // Each gender of each group of each date is one tryout (one Tryouts session): Boys and Girls try out separately.
  const tryoutList = tryoutDays.flatMap((d) =>
    d.groups.flatMap((g) => g.genders.map((gender) => ({ gender, grades: g.grades, time: g.time, date: d.date, location: d.location }))),
  );
  const flip = (list: string[], v: string, all: readonly string[]) => all.filter((x) => (x === v ? !list.includes(x) : list.includes(x)));
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1 text-sm font-medium ring-1 ${on ? "bg-thunder-blue text-white ring-thunder-blue" : "text-zinc-600 ring-zinc-950/15 dark:text-zinc-300 dark:ring-white/20"}`;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sure, setSure] = useState(false); // Delete asks right here first
  // Its line while it's closed.
  const who = whoLine({ genders, boysGrades, girlsGrades });
  const summary = [who, tryouts && kind === "Season" && tryoutList.length ? `${tryoutList.length} tryouts to add` : ""].filter(Boolean).join(" · ");
  const tone = kind === "Season" ? "violet" : kind === "Session" ? "emerald" : "amber";
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const d = general.dates;
        const r = await changePlayerProgram(org, program?.id ?? null, {
          ...f, // its payment dates (kept as they were)
          name: general.name,
          seasonFrom: d.seasonFrom,
          startsOn: d.seasonFrom ? "" : d.startsOn,
          endsOn: d.seasonFrom ? "" : kind === "Session" ? d.startsOn : d.endsOn,
          regOpens: d.regOpens,
          regCloses: d.regCloses,
          tryoutRegOpens: "", // opens the day the program is added (kept when it's changed)
          kind,
          tryouts,
          openGyms,
          scrimmages: general.scrimmages,
          sessions: general.sessions,
          genders,
          boysGrades,
          girlsGrades,
          feeLevels: general.feeLevels,
        }, kind === "Season" && tryouts ? tryoutList : []);
        setBusy(false);
        if (!r.ok) return setMsg({ ok: false, text: r.message });
        const extra = "tryoutsAdded" in r && r.tryoutsAdded ? ` ${r.tryoutsAdded} tryout${r.tryoutsAdded === 1 ? "" : "s"} added.` : "";
        const problems = "problems" in r && r.problems?.length ? ` Not added: ${r.problems.join("; ")}` : "";
        setMsg({ ok: !problems, text: `Saved ✓${extra}${problems}` });
        setTryoutDays([]);
        if (!program) {
          setF(EMPTY);
          onSaved?.();
        }
        if (problems) return; // keep the form open to read what wasn't added
        router.refresh();
        onDone?.();
      }}
    >
      {/* The type's own card: everything it needs. */}
      <Section n={3} tone={tone} title={kindLabel(kind)} summary={summary} open>
          {kind === "Season" && tryouts && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">
                Tryout registration is open from the day the program is added until each tryout&apos;s own day, so walk-ins can register there.
              </p>
              {tryoutDays.map((d, i) => (
                <div key={i} className="space-y-2 border-t border-zinc-100 pt-3 dark:border-white/5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Tryout date {i + 1}</p>
                    <button
                      type="button"
                      onClick={() => setTryoutDays((l) => l.filter((_, j) => j !== i))}
                      className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                    >
                      Remove date
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" aria-label="Tryout date" className={inputCls} value={d.date} onChange={(e) => setDay(i, { date: e.target.value })} />
                    <select
                      aria-label="Tryout place"
                      className={inputCls}
                      value={adding === i ? "+add" : d.location}
                      onChange={(e) => {
                        setPlaceMsg(null);
                        if (e.target.value === "+add") return setAdding(i);
                        setAdding(null);
                        setDay(i, { location: e.target.value });
                      }}
                    >
                      <option value="">Pick a place…</option>
                      {places.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                      <option value="+add">+ Add a facility…</option>
                    </select>
                  </div>
                  {/* A new facility, found by its location; it's added to the organization's gyms and picked. */}
                  {adding === i && (
                    <div className="space-y-1.5 rounded-lg bg-zinc-50 p-2 dark:bg-white/5">
                      <p className="text-xs text-zinc-500">Find the facility by its name or address:</p>
                      <PlaceSearch
                        org={org}
                        placeholder="Search for the facility…"
                        onPick={async (hit, session) => {
                          setPlaceMsg(null);
                          const r = await addFacilityAt(org, hit.placeId, session);
                          if (!r.ok) return setPlaceMsg(r.message);
                          setPlaces((l) => (l.includes(r.name) ? l : [...l, r.name].sort((a, b) => a.localeCompare(b))));
                          setDay(i, { location: r.name });
                          setAdding(null);
                          router.refresh();
                        }}
                      />
                      {placeMsg && <p className="text-xs text-red-600">{placeMsg}</p>}
                      <button type="button" onClick={() => setAdding(null)} className="text-xs text-zinc-500 hover:underline">
                        Cancel
                      </button>
                    </div>
                  )}
                  {/* The groups trying out that day: each its gender, grades and start time. */}
                  {d.groups.map((g, k) => (
                    <div key={k} className="space-y-1.5 rounded-lg bg-zinc-50 p-2 dark:bg-white/5">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                        {genders.map((x) => (
                          <label key={x} className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              className="size-4"
                              checked={g.genders.includes(x)}
                              onChange={() => setGroup(i, k, { genders: flip(g.genders, x, PROGRAM_GENDERS) })}
                            />
                            {x}
                          </label>
                        ))}
                        <input
                          type="time"
                          aria-label="Start time"
                          step={300}
                          className={`${inputCls} ml-auto w-36`}
                          value={g.time}
                          onChange={(e) => setGroup(i, k, { time: e.target.value })}
                        />
                        {d.groups.length > 1 && (
                          <button
                            type="button"
                            aria-label="Remove this group"
                            onClick={() => setDay(i, { groups: d.groups.filter((_, n) => n !== k) })}
                            className="px-1 text-sm text-zinc-400 hover:text-red-600"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">Grades (tap all that apply)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {groupGrades(g.genders).map((x) => (
                          <button
                            key={x}
                            type="button"
                            aria-pressed={g.grades.includes(x)}
                            onClick={() => setGroup(i, k, { grades: flip(g.grades, x, PROGRAM_GRADES) })}
                            className={chip(g.grades.includes(x))}
                          >
                            {x}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDay(i, { groups: [...d.groups, newGroup()] })}
                    className="text-xs font-semibold text-thunder-blue hover:underline dark:text-blue-400"
                  >
                    + Add a group this day
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setTryoutDays((l) => [...l, { date: "", location: l.at(-1)?.location ?? (places.length === 1 ? places[0] : ""), groups: [newGroup()] }])}
                className="text-sm font-semibold text-thunder-blue hover:underline dark:text-blue-400"
              >
                + Add a tryout date
              </button>
              {program && <p className="text-xs text-zinc-500">Tryouts already added are under the program&apos;s Sessions.</p>}
            </div>
          )}
      </Section>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Saving…" : program ? "Save" : "Add program"}
      </button>
      {program && canDelete && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          {sure ? (
            <>
              <span className="text-zinc-600 dark:text-zinc-300">Delete {program.name}?</span>
              <button type="button" onClick={() => setSure(false)} className="rounded-full px-3 py-1 ring-1 ring-zinc-950/10 dark:ring-white/15">
                Keep it
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await removePlayerProgram(org, program.id);
                  setBusy(false);
                  if (!r.ok) return setMsg({ ok: false, text: r.message });
                  router.refresh();
                }}
                className="rounded-full bg-red-600 px-3 py-1 font-semibold text-white"
              >
                Delete
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setSure(true)} className="font-medium text-red-600 dark:text-red-400">
              Delete program
            </button>
          )}
        </div>
      )}
    </form>
  );
}
