"use client";

// The Scheduler's gears. The program's gear (next to Scheduling for): its game length, used on each of its Game Days,
// and Simulation mode. Each Game Day's gear: the day's override, its own game length and, if wanted, its own time slots
// for every gym; Cancel override goes back to the program's setting. Placed games move with their blocks.
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { clearDayOverride, setDayOverride, setProgramGameLength } from "../actions";
import { Alert, PopUp, useConfirm } from "../../../client-ui";
import { GearIcon } from "../../../OrgSettings";

const gearCls =
  "shrink-0 rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";
const inputCls = "w-20 rounded-md bg-white px-2 py-1 text-base ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15";
const btn = "rounded-lg bg-scenic-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-40";
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
type Saved = { ok: true; moved: number; off: string[] } | { ok: false; message: string };

// Saving: an error, or a note naming games that no longer fit (back to be placed).
function useSave() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<Saved>, done?: () => void) =>
    start(async () => {
      setError(null);
      setNote(null);
      const r = await fn();
      if (!r.ok) return setError(r.message);
      setNote(r.off.length ? `No longer fit, back to be placed: ${r.off.join("; ")}.` : "Saved.");
      done?.();
      router.refresh();
    });
  const messages = (
    <>
      {error && <Alert tone="red">{error}</Alert>}
      {note && <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{note}</p>}
    </>
  );
  return { busy, run, messages };
}

function Minutes({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm font-semibold whitespace-nowrap">
        Game length
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={20}
        max={180}
        step={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
      <span className="text-sm text-zinc-500">min</span>
    </div>
  );
}

// The program's gear: its game length (every Game Day without an override) and Simulation mode (passed in).
export function ProgramGear({
  programId,
  programName,
  minutes,
  setBy,
  simulation,
}: {
  programId: string;
  programName: string;
  minutes: number;
  setBy: string | null;
  simulation: ReactNode;
}) {
  const [value, setValue] = useState(String(minutes));
  const { busy, run, messages } = useSave();
  return (
    <PopUp
      label={<GearIcon className="size-5" />}
      ariaLabel={`${programName} settings`}
      title={`${programName} settings`}
      className={gearCls}
    >
      {() => (
        <div className="space-y-4">
          <form
            className="space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-white/5"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => setProgramGameLength(programId, Number(value)));
            }}
          >
            <Minutes id={`plen-${programId}`} value={value} onChange={setValue} />
            <p className="text-xs text-zinc-500">
              Every Game Day of this program uses it, except days with an override (each day&apos;s gear). Placed games move with
              their blocks.
              {setBy && ` Set by ${setBy}.`}
            </p>
            {messages}
            <button type="submit" disabled={busy || value === String(minutes)} className={btn}>
              {busy ? "Saving…" : "Save"}
            </button>
          </form>
          {simulation}
        </div>
      )}
    </PopUp>
  );
}

// A Game Day's gear: the day's override (game length and, if wanted, time slots for every gym), or the program's setting.
export function GameDayGear(props: {
  day: string;
  label: string; // "Sat, Jan 9"
  minutes: number; // in use that day
  programMinutes: number;
  programName: string | null;
  override: boolean;
  breaks: { start: string; minutes: number }[] | null; // the override's Custom times
  opens: string | null; // the hosts' hours that day (first open – last close)
  closes: string | null;
  setBy: string | null;
}) {
  return (
    <PopUp
      label={<GearIcon className="size-5" />}
      ariaLabel={`${props.label} settings`}
      title={`${props.label} settings`}
      className={gearCls}
    >
      {() => <DayOverride {...props} />}
    </PopUp>
  );
}

type Break = { start: string; minutes: string };

function DayOverride({
  day,
  label,
  minutes,
  programMinutes,
  programName,
  override,
  breaks,
  opens,
  closes,
  setBy,
}: Parameters<typeof GameDayGear>[0]) {
  const [editing, setEditing] = useState(override);
  // Either a game length (slots every game length from when each gym opens) or Custom times: break points, each
  // starting slots of its own length until the next one (the last: until the hosts close), at every gym.
  const [mode, setMode] = useState<"length" | "custom">(breaks ? "custom" : "length");
  const [value, setValue] = useState(String(minutes));
  const [list, setList] = useState<Break[]>(
    breaks?.map((b) => ({ start: b.start, minutes: String(b.minutes) })) ?? [
      { start: opens ?? "09:00", minutes: String(minutes) },
    ],
  );
  const { busy, run, messages } = useSave();
  const [confirm, confirmDialog] = useConfirm();
  const program = `${programName ?? "The program"}'s game length: ${programMinutes} min`;

  if (!editing)
    return (
      <div className="space-y-3">
        <p className="text-sm">
          {label} uses <span className="font-semibold">{program}</span>, with game slots from when each gym opens.
        </p>
        {messages}
        <button type="button" onClick={() => setEditing(true)} className={btn}>
          Override this day
        </button>
      </div>
    );

  // Each break point checked here too (the server checks again): a time, a length of 20–180, within the hosts' hours.
  const problem = (b: Break) => {
    const len = Number(b.minutes);
    if (!b.start) return "Pick a time.";
    if (!Number.isInteger(len) || len < 20 || len > 180) return "Slots are 20 to 180 min.";
    if (opens && closes && (b.start < opens || toMin(b.start) + len > toMin(closes)))
      return `Outside the hosts' hours (${clock(opens)}–${clock(closes)}).`;
    if (list.filter((x) => x.start === b.start).length > 1) return "Same time as another break point.";
    return null;
  };
  const bad = list.some((b) => problem(b));
  // A preview of the slots the break points make (every gym; each gym uses those its hours fit).
  const sorted = [...list].filter((b) => !problem(b)).sort((a, b) => a.start.localeCompare(b.start));
  // Back to back from the first break point, no gaps; each game takes the latest break point's length at its start.
  const preview: string[] = [];
  if (sorted.length)
    for (let t = toMin(sorted[0].start); ;) {
      const len = Number(sorted.filter((b) => toMin(b.start) <= t).at(-1)!.minutes);
      if (t + len > toMin(closes ?? "23:59")) break;
      preview.push(`${clock(toTime(t))} (${len})`);
      t += len;
    }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          mode === "custom"
            ? setDayOverride(
                day,
                null,
                list.map((b) => ({ start: b.start, minutes: Number(b.minutes) })),
              )
            : setDayOverride(day, Number(value), null),
        );
      }}
    >
      {confirmDialog}
      <p className="text-xs text-zinc-500">
        <span className="font-semibold text-amber-800 dark:text-amber-300">{label} only.</span> Overrides {program}. Placed games
        move with their blocks.
        {override && setBy && ` Set by ${setBy}.`}
      </p>
      <div role="radiogroup" aria-label="Override" className="flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {(
          [
            ["length", "Game length"],
            ["custom", "Custom times"],
          ] as const
        ).map(([k, text]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={mode === k}
            onClick={() => setMode(k)}
            className={`flex-1 rounded-md py-1.5 text-sm font-semibold ${
              mode === k ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-white" : "text-zinc-500"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
      {mode === "length" ? (
        <>
          <Minutes id={`len-${day}`} value={value} onChange={setValue} />
          <p className="text-xs text-zinc-500">Game slots every {Number(value) || minutes} minutes from when each gym opens.</p>
        </>
      ) : (
        <div className="space-y-2 rounded-lg bg-zinc-50 p-2 dark:bg-white/5">
          <p className="text-xs text-zinc-500">
            Games run back to back from the first break point until the hosts close{closes ? ` (${clock(closes)})` : ""}. From
            each break point on, the next game to start takes its length (no gap). Every gym uses the slots its hours fit.
          </p>
          <ul className="space-y-1.5">
            {list.map((b, i) => {
              const why = problem(b);
              return (
                <li key={i}>
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      step={300}
                      value={b.start}
                      aria-label={`Break point ${i + 1} time`}
                      aria-invalid={!!why}
                      onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                      className={`w-32 rounded-md px-2 py-1 text-sm ring-1 ${
                        why
                          ? "bg-red-50 ring-red-400 dark:bg-red-500/10"
                          : "bg-white ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15"
                      }`}
                    />
                    <span className="text-sm text-zinc-500">starts</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={20}
                      max={180}
                      step={5}
                      value={b.minutes}
                      aria-label={`Break point ${i + 1} slot length`}
                      onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, minutes: e.target.value } : x)))}
                      className="w-16 rounded-md bg-white px-2 py-1 text-sm ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15"
                    />
                    <span className="text-sm text-zinc-500">min slots</span>
                    <button
                      type="button"
                      aria-label={`Remove break point ${i + 1}`}
                      disabled={list.length === 1}
                      onClick={() => setList(list.filter((_, j) => j !== i))}
                      className="ml-auto rounded p-1 text-zinc-400 hover:text-red-600 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                  {why && <p className="mt-0.5 text-xs font-medium text-red-600 dark:text-red-400">{why}</p>}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            disabled={list.length >= 20}
            onClick={() => {
              const last = [...list].sort((a, b) => a.start.localeCompare(b.start)).at(-1);
              setList([
                ...list,
                {
                  start: last?.start ? toTime(Math.min(toMin(last.start) + 120, 23 * 60)) : (opens ?? "09:00"),
                  minutes: last?.minutes ?? "55",
                },
              ]);
            }}
            className="text-sm font-medium text-scenic-navy hover:underline disabled:opacity-40 dark:text-white"
          >
            + Add break point
          </button>
          {preview.length > 0 && (
            <p className="text-xs text-zinc-500">
              <span className="font-semibold">{preview.length} slots:</span> {preview.join(", ")}
            </p>
          )}
        </div>
      )}
      {messages}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || (mode === "custom" && bad)} className={btn}>
          {busy ? "Saving…" : "Save override"}
        </button>
        {override ? (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (
                await confirm({
                  title: "Cancel this day's override?",
                  message: `${label} goes back to ${program}, with game slots from when each gym opens. Placed games move with their blocks.`,
                  confirmLabel: "Cancel override",
                })
              )
                run(
                  () => clearDayOverride(day),
                  () => setEditing(false),
                );
            }}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-600/30 dark:text-red-400"
          >
            Cancel override
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-600 ring-1 ring-zinc-950/10 dark:text-zinc-300 dark:ring-white/15"
          >
            Back
          </button>
        )}
      </div>
    </form>
  );
}
