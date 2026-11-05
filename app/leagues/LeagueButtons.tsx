"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerAll, registerTeam, setDayOff, withdrawTeam } from "./actions";
import { registerAllScenicTeams } from "../org/scenic-city/actions";
import { PopUp, Toast, useConfirm } from "../client-ui";
import RegisterChoices from "../org/scenic-city/programs/RegisterChoices";
import { shortDate, type Choice, type ChoiceResult, type ProgramOption } from "@/lib/program-options";

const btn = "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50";

// Register all of the organization's unregistered teams into a program at once; then say where they went and who was
// skipped (and why). Scenic City (its own program page): the teams it can register there. `allSeason`: a League.
export function RegisterAllButton({
  org,
  programId,
  program,
  count,
  allSeason = true,
}: {
  org: string;
  programId: string;
  program: string;
  count: number;
  allSeason?: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ registered: string[]; skipped: string[] } | null>(null);
  return (
    <div className="w-full space-y-2 sm:w-auto">
      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-thunder-blue text-white`}
        onClick={() =>
          start(async () => {
            const r = org === "scenic-city" ? await registerAllScenicTeams(programId) : await registerAll(org, programId);
            if (!r.ok) return setMsg(r.message);
            setResult({ registered: r.registered, skipped: r.skipped });
            setMsg(`${r.registered.length} registered in ${program}.`);
            router.refresh();
          })
        }
      >
        {busy ? "Registering…" : `Register all unregistered (${count})${allSeason ? " · ALL Season" : ""}`}
      </button>
      {result && (
        <div className="space-y-1 text-xs">
          {result.registered.map((x) => (
            <p key={x} className="text-emerald-700 dark:text-emerald-400">
              ✓ {x}
            </p>
          ))}
          {result.skipped.map((x) => (
            <p key={x} className="text-red-600 dark:text-red-400">
              Skipped: {x}
            </p>
          ))}
        </div>
      )}
      {msg && <Toast key={msg} message={msg} />}
    </div>
  );
}

// Register a team into a program, or withdraw it (asks first).
export function ProgramButton({
  org,
  teamId,
  programId,
  program,
  registered,
}: {
  org: string;
  teamId: string;
  programId: string;
  program: string;
  registered: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      {registered ? (
        <button
          type="button"
          disabled={busy}
          className={`${btn} text-red-600 ring-1 ring-red-600/30`}
          onClick={async () => {
            if (
              !(await confirm({
                title: `Withdraw from ${program}?`,
                message: "Are you sure? The team comes out of its pool.",
                confirmLabel: "Withdraw",
              }))
            )
              return;
            start(async () => {
              const r = await withdrawTeam(org, teamId, programId);
              setMsg(r.ok ? `Withdrawn from ${program}.` : r.message);
              if (r.ok) router.refresh();
            });
          }}
        >
          Withdraw
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          className={`${btn} bg-thunder-blue text-white`}
          onClick={() =>
            start(async () => {
              const r = await registerTeam(org, teamId, programId);
              setMsg(r.ok ? `Registered: ${r.division}.` : r.message);
              if (r.ok) router.refresh();
            })
          }
        >
          Register
        </button>
      )}
      {msg && <Toast key={msg} message={msg} />}
      {confirmDialog}
    </>
  );
}

// A League: Register (or Add dates, once registered) opens a pop-up to pick ALL Season and/or Single Day dates.
export function RegisterLeagueButton({
  org,
  teamId,
  programId,
  program,
  options,
  gameDates,
  today,
  entry,
}: {
  org: string;
  teamId: string;
  programId: string;
  program: string;
  options: ProgramOption[];
  gameDates: string[];
  today: string;
  entry: (Choice & ChoiceResult) | null;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <PopUp
        label={entry ? "Add dates" : "Register"}
        title={entry ? `Add to ${program}` : `Register for ${program}`}
        className={`${btn} ${entry ? "text-thunder-blue ring-1 ring-thunder-blue/40" : "bg-thunder-blue text-white"}`}
      >
        {(close) => (
          <RegisterChoices
            options={options}
            gameDates={gameDates}
            today={today}
            entry={entry}
            save={async (choice) => {
              const r = await registerTeam(org, teamId, programId, choice);
              if (!r.ok) return r;
              close();
              setMsg(r.division ? `Registered: ${r.division}.` : "Registration updated.");
              router.refresh();
              return { ok: true as const };
            }}
          />
        )}
      </PopUp>
      {msg && <Toast key={msg} message={msg} />}
    </>
  );
}

// The dates a registered team plays (and the Brackets), as chips. Managers tap an upcoming one to withdraw from it, or
// tap one they withdrew from to re-enter (asks first). Dates Scenic City took them out of stay crossed out.
export function DateChips({
  org,
  teamId,
  programId,
  perDate,
  bracket,
  today,
  removedBy,
  off,
  teamOff,
  canChange,
  who,
}: {
  org: string;
  teamId: string;
  programId: string;
  perDate: Record<string, 1 | 2>;
  bracket: boolean;
  today: string;
  removedBy: string | null;
  off: Record<string, string>;
  teamOff: string[];
  canChange: boolean;
  who: boolean; // Owners and Admins see who took a team out
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const label = (what: string) => (what === "brackets" ? "the Brackets" : shortDate(what));
  const tap = async (what: string, out: boolean) => {
    if (
      !(await confirm(
        out
          ? {
              title: `Withdraw from ${label(what)}?`,
              message: "The team won't play then. You can re-enter later.",
              confirmLabel: "Withdraw",
            }
          : { title: `Re-enter ${label(what)}?`, message: "The team plays then again.", confirmLabel: "Re-enter" },
      ))
    )
      return;
    start(async () => {
      const r = await setDayOff(org, teamId, programId, what, out);
      setMsg(r.ok ? `${out ? "Withdrawn from" : "Back in"} ${label(what)}.` : r.message);
      if (r.ok) router.refresh();
    });
  };
  const chip = (what: string, text: string, tone: string) => {
    const isOff = !!removedBy || !!off[what];
    const mine = teamOff.includes(what);
    const upcoming = what === "brackets" || what >= today;
    const tappable = canChange && !removedBy && upcoming && (!isOff || mine);
    const cls = `rounded-full px-2 py-0.5 text-xs font-medium ${
      isOff ? "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-800" : tone
    } ${upcoming ? "" : "opacity-50"} ${tappable ? "cursor-pointer ring-1 ring-transparent hover:ring-zinc-400 disabled:opacity-50" : ""}`;
    const note = isOff ? (mine ? " (withdrew)" : " (removed)") : "";
    return (
      <li key={what}>
        {tappable ? (
          <button type="button" disabled={busy} className={cls} onClick={() => tap(what, !isOff)}>
            {text}
            {note}
          </button>
        ) : (
          <span className={cls} title={who && off[what] && !mine ? `Taken out by ${off[what]}` : undefined}>
            {text}
            {note}
          </span>
        )}
      </li>
    );
  };
  return (
    <>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {Object.entries(perDate)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, gg]) =>
            chip(
              date,
              `${shortDate(date)} · ${gg}GG`,
              gg === 2
                ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
            ),
          )}
        {bracket &&
          chip("brackets", "Brackets", "bg-violet-100 font-semibold text-violet-800 dark:bg-violet-500/15 dark:text-violet-300")}
      </ul>
      {canChange && !removedBy && <p className="mt-1 text-xs text-zinc-500">Tap a date to withdraw from it, or to re-enter.</p>}
      {(removedBy || Object.keys(off).some((k) => !teamOff.includes(k))) && (
        <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
          {removedBy ? "Taken out at the League level." : "Dates marked (removed) were taken out at the League level."} The team
          can&apos;t re-enter them; only the League&apos;s Admins or Director of Scheduling can restore them.
        </p>
      )}
      {msg && <Toast key={msg} message={msg} />}
      {confirmDialog}
    </>
  );
}
