"use client";

import { useState } from "react";
import type { PlayerProgramFields } from "@/lib/player-programs";
import { ELIMINATION, PROGRAM_GENDERS, PROGRAM_GRADES, PROGRAM_KINDS, TEAM_KINDS, hasBracket, hasPoolGames, kindLabel, whoLine } from "@/lib/program-kinds";
import { ProgramEditor } from "../org/scenic-city/programs/ProgramTools";
import { fieldLabel, inputCls } from "../ui";
import PlayerProgramForm, { type PlayerGeneral } from "./PlayerProgramForm";
import Section from "./ProgramSection";

type Kind = (typeof PROGRAM_KINDS)[number]["key"] | (typeof TEAM_KINDS)[number]["key"];
const isPlayerKind = (k: string): k is PlayerGeneral["kind"] => PROGRAM_KINDS.some((x) => x.key === k);

// A program's form (SPEC.md section 14), as cards: 1 General (its name, its Type, pick one, and that type's options),
// then the type's own card with everything it needs. CourtPlayers: Season (options Tryouts, Open Gyms, Scrimmages),
// Training Session, Training Course (its number of sessions). CourtEvents: League and Tournament (pool games, Single or
// Double elimination), Shootout (pool games), Circuit. `program` changes a player program (its type stays a player one).
export default function ProgramForm({
  org,
  players,
  teams,
  sources,
  facilities = [],
  program,
  canDelete = false,
  onDone,
}: {
  org: string;
  players: boolean; // CourtPlayers: the player types
  teams: boolean; // CourtEvents (its Directors of Programs): the team types
  sources: { id: string; name: string; startsOn: string; endsOn: string }[];
  facilities?: string[];
  program?: PlayerProgramFields;
  canDelete?: boolean;
  onDone?: () => void;
}) {
  const first: Kind = program?.kind ?? (players ? "Season" : "League");
  const [name, setName] = useState(program?.name ?? "");
  const [kind, setKind] = useState<Kind>(first);
  const [tryouts, setTryouts] = useState(program?.tryouts ?? true);
  const [openGyms, setOpenGyms] = useState(program?.openGyms ?? true);
  const [scrimmages, setScrimmages] = useState(program?.scrimmages ?? true);
  const [sessions, setSessions] = useState(program?.sessions ?? "");
  // Its dates (player programs): the season's (typed in, or a Season's from a team program) and registration's.
  const blankDates = { seasonFrom: "", startsOn: "", endsOn: "", regOpens: "", regCloses: "" };
  const [dates, setDates] = useState(
    program
      ? { seasonFrom: program.seasonFrom, startsOn: program.startsOn, endsOn: program.endsOn, regOpens: program.regOpens, regCloses: program.regCloses }
      : blankDates,
  );
  const [follow, setFollow] = useState(!!program?.seasonFrom || (!program && sources.length > 0));
  const follows = kind === "Season" && follow;
  const setDate = (k: keyof typeof blankDates) => (e: { target: { value: string } }) => setDates((d) => ({ ...d, [k]: e.target.value }));
  const date = (k: keyof typeof blankDates, label: string) => (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      <input type="date" className={inputCls} value={dates[k]} onChange={setDate(k)} />
    </label>
  );
  const day = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }) : "");
  // Registration opens 60 days before the season (or the first session) starts (worked out on the server too).
  const regOpensOn = (() => {
    const start = follows ? (sources.find((x) => x.id === (dates.seasonFrom || sources[0]?.id))?.startsOn ?? "") : dates.startsOn;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return "";
    const t = new Date(`${start}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() - 60);
    return t.toISOString().slice(0, 10);
  })();
  const datesLine = !isPlayerKind(kind)
    ? ""
    : follows
      ? (sources.find((x) => x.id === (dates.seasonFrom || sources[0]?.id))?.name ?? "")
      : kind === "Session"
        ? day(dates.startsOn)
        : kind === "Season"
          ? dates.startsOn ? `starts ${day(dates.startsOn)}` : ""
          : dates.startsOn && dates.endsOn
            ? `${day(dates.startsOn)} – ${day(dates.endsOn)}`
            : "";
  const [poolGames, setPoolGames] = useState("3");
  const [elimination, setElimination] = useState<string>("single");
  // Its fee levels (player programs): each its fee and the Boys and/or Girls grades it's for. The program's genders and
  // grades are all its levels together.
  type Level = { name: string; fee: string; endsOn: string; boysOn: boolean; girlsOn: boolean; boysGrades: string[]; girlsGrades: string[] };
  const blankLevel = (): Level => ({ name: "", fee: "", endsOn: "", boysOn: true, girlsOn: true, boysGrades: [], girlsGrades: [] });
  const startLevels = (): Level[] =>
    program?.feeLevels?.length
      ? program.feeLevels.map((l) => ({
          name: l.name,
          fee: l.fee,
          endsOn: l.endsOn || program.endsOn || "", // fees saved before they had their own: the program's
          boysOn: l.boysGrades.length > 0,
          girlsOn: l.girlsGrades.length > 0,
          boysGrades: l.boysGrades,
          girlsGrades: l.girlsGrades,
        }))
      : program
        ? [{ name: "", fee: "", endsOn: program.endsOn, boysOn: program.boysGrades.length > 0, girlsOn: program.girlsGrades.length > 0, boysGrades: program.boysGrades, girlsGrades: program.girlsGrades }]
        : [blankLevel()];
  const [levels, setLevels] = useState<Level[]>(startLevels);
  const setLevel = (i: number, v: Partial<Level>) => setLevels((l) => l.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const setCount = (n: number) => setLevels((l) => (n > l.length ? [...l, ...Array.from({ length: n - l.length }, blankLevel)] : l.slice(0, n)));
  const boysGrades = PROGRAM_GRADES.filter((g) => levels.some((l) => l.boysOn && l.boysGrades.includes(g)));
  const girlsGrades = PROGRAM_GRADES.filter((g) => levels.some((l) => l.girlsOn && l.girlsGrades.includes(g)));
  const genders = PROGRAM_GENDERS.filter((g) => (g === "Boys" ? boysGrades : girlsGrades).length > 0);
  const levelWho = (l: Level) =>
    whoLine({
      genders: PROGRAM_GENDERS.filter((g) => (g === "Boys" ? l.boysOn && l.boysGrades.length : l.girlsOn && l.girlsGrades.length)),
      boysGrades: l.boysGrades,
      girlsGrades: l.girlsGrades,
    });
  const feeTitle = (l: Level) => `${l.name.trim() || "Fee Name"}${l.fee ? ` · $${l.fee}` : ""}`;
  const feesLine = levels.map((l) => feeTitle(l)).join(" · ") || "No fees";
  const flip = (list: string[], v: string, all: readonly string[]) => all.filter((x) => (x === v ? !list.includes(x) : list.includes(x)));
  const restart = () => {
    setName("");
    setKind(first);
    setTryouts(true);
    setOpenGyms(true);
    setScrimmages(true);
    setSessions("");
    setPoolGames("3");
    setElimination("single");
    setLevels([blankLevel()]);
    setDates(blankDates);
  };
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1 text-sm font-medium ring-1 ${on ? "bg-thunder-blue text-white ring-thunder-blue" : "text-zinc-600 ring-zinc-950/15 dark:text-zinc-300 dark:ring-white/20"}`;
  const groups = [
    ...(players || program ? [{ label: "Players register", kinds: PROGRAM_KINDS }] : []),
    ...(teams && !program ? [{ label: "Teams register", kinds: TEAM_KINDS }] : []),
  ];
  const about = [...PROGRAM_KINDS, ...TEAM_KINDS].find((k) => k.key === kind)?.about ?? "";
  const options =
    kind === "Season"
      ? [tryouts && "Tryouts", openGyms && "Open Gyms", scrimmages && "Scrimmages"].filter(Boolean).join(", ") || "No options"
      : kind === "Course"
        ? sessions ? `${sessions} sessions` : "Sessions not set"
        : hasPoolGames(kind)
          ? `${poolGames} pool games${hasBracket(kind) ? `, ${ELIMINATION.find((e) => e.key === elimination)?.label}` : ""}`
          : "";
  const check = (label: string, on: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" className="size-4" checked={on} onChange={(e) => set(e.target.checked)} /> {label}
    </label>
  );
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{program ? `Change ${program.name}` : "New program"}</p>
      <Section n={1} tone="blue" title="General" summary={[name || "No name", kindLabel(kind), options, datesLine].filter(Boolean).join(" · ")} open>
        {/* Its name, and (player programs with dates typed in) the day it starts, on one row. */}
        <div className={isPlayerKind(kind) && !follows ? "grid grid-cols-[1fr_10rem] gap-3" : ""}>
          <label className="block">
            <span className={fieldLabel}>Name</span>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={isPlayerKind(kind) ? 80 : 60}
              placeholder={kind === "Season" ? "Spring 2027" : isPlayerKind(kind) ? "Shooting Clinic" : "Winter League 2027"}
            />
          </label>
          {isPlayerKind(kind) && !follows && date("startsOn", kind === "Season" ? "Season starts" : kind === "Session" ? "Session date" : "First session")}
        </div>
        <fieldset>
          <legend className={fieldLabel}>Type (pick one)</legend>
          <div className="space-y-2">
            {groups.map((g) => (
              <div key={g.label}>
                {groups.length > 1 && <p className="mb-1 text-xs text-zinc-500">{g.label}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {g.kinds.map((k) => (
                    <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)} className={chip(kind === k.key)}>
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-500">{about}</p>
        </fieldset>
        {/* The type's options. */}
        {kind === "Season" && (
          <fieldset>
            <legend className={fieldLabel}>Options</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {check("Tryouts", tryouts, setTryouts)}
              {check("Open Gyms", openGyms, setOpenGyms)}
              {check("Scrimmages", scrimmages, setScrimmages)}
            </div>
          </fieldset>
        )}
        {kind === "Course" && (
          <label className="block">
            <span className={fieldLabel}>Number of sessions</span>
            <input className={`${inputCls} w-28`} inputMode="numeric" value={sessions} onChange={(e) => setSessions(e.target.value)} placeholder="6" />
          </label>
        )}
        {/* Its dates and registration (player programs). */}
        {isPlayerKind(kind) && (
          <div className="space-y-3">
            {kind === "Season" && sources.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={follow} onChange={() => setFollow(true)} /> Season dates from a League, Circuit or Tournament
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={!follow} onChange={() => setFollow(false)} /> Type them in
                </label>
              </div>
            )}
            {follows ? (
              <select className={inputCls} value={dates.seasonFrom || sources[0]?.id || ""} onChange={setDate("seasonFrom")} aria-label="Season follows">
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.startsOn} – {s.endsOn})
                  </option>
                ))}
              </select>
            ) : (
              kind === "Course" && <div className="grid grid-cols-2 gap-3">{date("endsOn", "Last session")}</div>
            )}
            <p className="text-xs text-zinc-500">
              Registration opens 60 days before the {kind === "Season" ? "season starts" : "first day"}
              {regOpensOn ? ` (${day(regOpensOn)})` : ""} and closes on {kind === "Season" ? "each fee's Season end date" : "the last day"}.
            </p>
          </div>
        )}
        {hasPoolGames(kind) && (
          <div className="flex flex-wrap items-end gap-4">
            <label className="block">
              <span className={fieldLabel}>Pool games</span>
              <input className={`${inputCls} w-24`} inputMode="numeric" value={poolGames} onChange={(e) => setPoolGames(e.target.value)} />
            </label>
            {hasBracket(kind) && (
              <div>
                <span className={fieldLabel}>Bracket</span>
                <div className="flex flex-wrap gap-1.5">
                  {ELIMINATION.map((e) => (
                    <button key={e.key} type="button" aria-pressed={elimination === e.key} onClick={() => setElimination(e.key)} className={chip(elimination === e.key)}>
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>
      {/* 2 Fees (player programs): how many fee levels, each its fee and the Boys (blue) and Girls (pink) grades it's for. */}
      {isPlayerKind(kind) && (
        <Section n={2} tone="emerald" title="Fees" summary={feesLine} open={!program}>
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium">How many fees?</span>
            <select className={`${inputCls} w-20`} value={levels.length} onChange={(e) => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {/* The fees' names and prices, one row each; each fee then has its own card below, named for it. */}
          <div className="space-y-2">
            {levels.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem] gap-2">
                <label className="block">
                  <span className={fieldLabel}>Fee Name</span>
                  <input
                    className={inputCls}
                    maxLength={40}
                    placeholder={["Local", "Regional", "National"][i] ?? `Fee ${i + 1}`}
                    value={l.name}
                    onChange={(e) => setLevel(i, { name: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className={fieldLabel}>Price $</span>
                  <input className={inputCls} inputMode="decimal" placeholder="150.00" value={l.fee} onChange={(e) => setLevel(i, { fee: e.target.value })} />
                </label>
              </div>
            ))}
          </div>
          {/* One card per fee, named for it: the Boys (blue) and Girls (pink) grades it's for. */}
          {levels.map((l, i) => (
            <div key={i}>
              <details open className="group rounded-xl bg-white ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 select-none [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{feeTitle(l)}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {[levelWho(l) || "Pick its grades", l.endsOn && `season ends ${l.endsOn}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-180">
                    ⌄
                  </span>
                </summary>
                <div className="space-y-2 border-t border-zinc-950/5 p-3 dark:border-white/10">
                  {kind === "Season" && (
                    <label className="block">
                      <span className={fieldLabel}>Season end date{follows ? " (blank = the League's)" : ""}</span>
                      <input type="date" className={inputCls} value={l.endsOn} onChange={(e) => setLevel(i, { endsOn: e.target.value })} />
                      <span className="mt-1 block text-xs text-zinc-500">Registration for this fee closes on this day.</span>
                    </label>
                  )}
                  {PROGRAM_GENDERS.map((g) => {
                    const girls = g === "Girls";
                    const on = girls ? l.girlsOn : l.boysOn;
                    const list = girls ? l.girlsGrades : l.boysGrades;
                    const box = girls
                      ? "bg-pink-50 ring-pink-200 dark:bg-pink-500/10 dark:ring-pink-400/30"
                      : "bg-sky-50 ring-sky-200 dark:bg-sky-500/10 dark:ring-sky-400/30";
                    const pick = (x: boolean) =>
                      `rounded-full px-3 py-1 text-sm font-medium ring-1 ${
                        x
                          ? girls
                            ? "bg-pink-600 text-white ring-pink-600"
                            : "bg-thunder-blue text-white ring-thunder-blue"
                          : "bg-white text-zinc-600 ring-zinc-950/15 dark:bg-transparent dark:text-zinc-300 dark:ring-white/20"
                      }`;
                    return (
                      <div key={g} className={`rounded-xl p-3 ring-1 ${box}`}>
                        <label className="flex items-center gap-2 text-sm font-semibold">
                          <input type="checkbox" className="size-4" checked={on} onChange={() => setLevel(i, girls ? { girlsOn: !on } : { boysOn: !on })} />
                          {g}
                        </label>
                        {on && (
                          <>
                            <p className="mt-2 mb-1 text-xs text-zinc-500">{g} grades (tap all that apply)</p>
                            <div className="flex flex-wrap gap-1.5">
                              {PROGRAM_GRADES.map((x) => (
                                <button
                                  key={x}
                                  type="button"
                                  aria-pressed={list.includes(x)}
                                  onClick={() =>
                                    setLevel(i, girls ? { girlsGrades: flip(list, x, PROGRAM_GRADES) } : { boysGrades: flip(list, x, PROGRAM_GRADES) })
                                  }
                                  className={pick(list.includes(x))}
                                >
                                  {x}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            </div>
          ))}
        </Section>
      )}
      {/* The type's own card. */}
      {isPlayerKind(kind) ? (
        <PlayerProgramForm
          org={org}
          program={program}
          facilities={facilities}
          canDelete={canDelete}
          onDone={onDone}
          onSaved={restart}
          general={{
            name,
            kind,
            tryouts,
            openGyms,
            scrimmages,
            sessions,
            genders,
            boysGrades,
            girlsGrades,
            dates: { ...dates, seasonFrom: follows ? dates.seasonFrom || sources[0]?.id || "" : "" },
            feeLevels: levels.map((l) => ({ name: l.name, fee: l.fee, endsOn: l.endsOn, boysGrades: l.boysOn ? l.boysGrades : [], girlsGrades: l.girlsOn ? l.girlsGrades : [] })),
          }}
        />
      ) : (
        <Section n={2} tone="sky" title={kindLabel(kind)} summary={about} open>
          <ProgramEditor embed={{ kind, name, poolGames, elimination, onSaved: restart }} />
        </Section>
      )}
    </div>
  );
}
