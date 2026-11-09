"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerAll, registerTeam, setDayOff, undoRegisterAll, withdrawTeam } from "./actions";
import { registerAllScenicTeams } from "../org/scenic-city/actions";
import { PopUp, Toast, useConfirm } from "../client-ui";
import RegisterChoices from "../org/scenic-city/programs/RegisterChoices";
import { shortDate, type Choice, type ChoiceResult, type ProgramOption } from "@/lib/program-options";
import type { BatchResult, BatchTeam } from "@/lib/scenic-programs";
import type { LastBatch } from "@/lib/register-batches";
import TeamsIncluded from "../TeamsIncluded";

const btn = "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50";

// Register all of the organization's unregistered teams into a program at once. It first shows what will happen (each
// team, its division and the dates it plays; who is skipped and why) and registers only on OK; then Undo takes them all
// back out. Scenic City (its own program page): the teams it can register there. `allSeason`: a League.
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
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<(BatchResult & { at: number }) | null>(null);
  return (
    <div className="w-full space-y-2 sm:w-auto">
      <PopUp
        label={`Register all unregistered (${count})${allSeason ? " · ALL Season" : ""}`}
        title={`Register all in ${program}`}
        className={`${btn} bg-thunder-blue text-white`}
      >
        {(close) => (
          <RegisterAllPreview
            org={org}
            programId={programId}
            program={program}
            close={close}
            done={(r) => {
              setDone({ ...r, at: Date.now() });
              setMsg(`${r.registered.length} registered in ${program}.`);
            }}
          />
        )}
      </PopUp>
      {done && (
        <div className="space-y-1 text-xs">
          {done.teams.map((t) => (
            <p key={t.id} className="text-emerald-700 dark:text-emerald-400">
              ✓ {t.name}: {t.division}
            </p>
          ))}
          {done.skipped.map((x) => (
            <p key={x} className="text-red-600 dark:text-red-400">
              Skipped: {x}
            </p>
          ))}
          {done.batchId && (
            <UndoRegisterAll
              batchId={done.batchId}
              program={program}
              teams={done.teams.length}
              onUndone={(m) => {
                setDone(null);
                setMsg(m);
              }}
            />
          )}
        </div>
      )}
      {msg && <Toast key={msg} message={msg} />}
    </div>
  );
}

// Inside Register all's pop-up: the preview (nothing registered yet), the teams grouped by grade (collapsed; a group's
// check box takes all its teams in or out, expand it to uncheck single teams to leave out this time), then Register the
// checked ones.
function RegisterAllPreview({
  org,
  programId,
  program,
  close,
  done,
}: {
  org: string;
  programId: string;
  program: string;
  close: () => void;
  done: (r: BatchResult) => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [plan, setPlan] = useState<BatchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState<Set<string>>(new Set()); // unchecked: left out
  const [open, setOpen] = useState<Set<string>>(new Set()); // grade groups expanded (all collapsed at first)
  const call = (preview: boolean, only?: string[]) =>
    org === "scenic-city" ? registerAllScenicTeams(programId, preview, only) : registerAll(org, programId, preview, only);
  useEffect(() => {
    let live = true;
    call(true).then((r) => {
      if (!live) return;
      if (r.ok) setPlan(r);
      else setErr(r.message);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the pop-up opens
  }, []);
  if (err) return <p className="text-sm text-red-600 dark:text-red-400">{err}</p>;
  if (!plan) return <p className="text-sm text-zinc-500">Checking your teams…</p>;
  const picked = plan.teams.filter((t) => !left.has(t.id));
  const flip = (id: string) =>
    setLeft((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // The dates: shown once when every team plays the same ones (ALL Season), else under each team.
  const key = (t: BatchTeam) => `${t.dates.join(",")}|${t.bracket}`;
  const same = plan.teams.length > 0 && plan.teams.every((t) => key(t) === key(plan.teams[0]));
  const dates = (t: BatchTeam) => (
    <span className="flex flex-wrap gap-1">
      {t.dates.map((d) => (
        <span key={d} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {shortDate(d)}
        </span>
      ))}
      {t.bracket && (
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-500/15 dark:text-violet-300">
          Brackets
        </span>
      )}
    </span>
  );
  return (
    <div className="space-y-3 text-sm">
      {plan.teams.length ? (
        <p>
          <span className="font-semibold">
            {plan.teams.length} team{plan.teams.length === 1 ? "" : "s"}
          </span>{" "}
          can be registered in {program}. Uncheck a grade, or tap it to uncheck single teams, to leave them out this
          time. Nothing is registered until you tap Register.
        </p>
      ) : (
        <p>No teams can be registered.</p>
      )}
      {same && (plan.teams[0].dates.length > 0 || plan.teams[0].bracket) && (
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">They play</p>
          {dates(plan.teams[0])}
        </div>
      )}
      {plan.teams.length > 1 && (
        <label className="flex items-center gap-2 px-3 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            className="size-4 accent-thunder-blue"
            checked={left.size === 0}
            onChange={() => setLeft(left.size === 0 ? new Set(plan.teams.map((t) => t.id)) : new Set())}
          />
          All ({picked.length} of {plan.teams.length} checked)
        </label>
      )}
      {plan.teams.length > 0 && (
        <ul className="max-h-[50vh] divide-y divide-zinc-100 overflow-y-auto rounded-lg ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
          {groupByGrade(plan.teams).map((g) => {
            const on = g.teams.filter((t) => !left.has(t.id)).length;
            const isOpen = open.has(g.label);
            return (
              <li key={g.label}>
                <div className="flex items-center gap-3 bg-zinc-50 px-3 py-2 dark:bg-white/5">
                  <GroupBox
                    on={on}
                    of={g.teams.length}
                    label={g.label}
                    onChange={() =>
                      setLeft((s) => {
                        const n = new Set(s);
                        for (const t of g.teams) {
                          if (on === g.teams.length) n.add(t.id);
                          else n.delete(t.id);
                        }
                        return n;
                      })
                    }
                  />
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpen((s) => {
                        const n = new Set(s);
                        if (n.has(g.label)) n.delete(g.label);
                        else n.add(g.label);
                        return n;
                      })
                    }
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">{g.label}</span>
                      <span className="block text-xs text-zinc-500">
                        {on === g.teams.length ? `${on} team${on === 1 ? "" : "s"}` : `${on} of ${g.teams.length} checked`}
                      </span>
                    </span>
                    <span className={`shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                  </button>
                </div>
                {isOpen && (
                  <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                    {g.teams.map((t) => (
                      <li key={t.id}>
                        <label className={`flex cursor-pointer items-start gap-3 py-2 pr-3 pl-9 ${left.has(t.id) ? "opacity-50" : ""}`}>
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 shrink-0 accent-thunder-blue"
                            checked={!left.has(t.id)}
                            onChange={() => flip(t.id)}
                          />
                          <span className="min-w-0">
                            <span className={`block font-medium ${left.has(t.id) ? "line-through" : ""}`}>{t.name}</span>
                            <span className="block text-xs text-zinc-500">{left.has(t.id) ? "Left out this time" : t.division}</span>
                            {!same && <span className="mt-1 block">{dates(t)}</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {plan.skipped.length > 0 && (
        <div className="space-y-0.5 text-xs text-red-600 dark:text-red-400">
          <p className="font-semibold">Won&apos;t be registered ({plan.skipped.length}):</p>
          {plan.skipped.map((x) => (
            <p key={x}>{x}</p>
          ))}
        </div>
      )}
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={close} className="rounded-full px-3.5 py-1.5 text-sm font-medium text-zinc-600 ring-1 ring-zinc-950/10 dark:text-zinc-300 dark:ring-white/15">
          Cancel
        </button>
        {plan.teams.length > 0 && (
          <button
            type="button"
            disabled={busy || !picked.length}
            className="rounded-full bg-thunder-blue px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() =>
              start(async () => {
                const r = await call(false, picked.map((t) => t.id));
                if (!r.ok) return setErr(r.message);
                close();
                done(r);
                router.refresh();
              })
            }
          >
            {busy ? "Registering…" : `Register ${picked.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

// Register all's teams grouped by grade (gender, grade and level, e.g. "Boys 1st REC"), in the order they came (youngest
// first). The grade is read from the division ("Boys K–1st · 1st REC · Pool A").
function groupByGrade(teams: BatchTeam[]): { label: string; teams: BatchTeam[] }[] {
  const groups = new Map<string, BatchTeam[]>();
  for (const t of teams) {
    const [div, grade] = t.division.split(" · ");
    const label = grade ? `${div.split(" ")[0]} ${grade}` : t.division || "Other";
    groups.set(label, [...(groups.get(label) ?? []), t]);
  }
  return [...groups].map(([label, teams]) => ({ label, teams }));
}

// A grade group's check box: checked when all its teams are, a dash when some are.
function GroupBox({ on, of, label, onChange }: { on: number; of: number; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = on > 0 && on < of;
  }, [on, of]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={`All ${label}`}
      className="size-4 shrink-0 accent-thunder-blue"
      checked={on === of}
      onChange={onChange}
    />
  );
}

// Undo a Register all: the teams it registered come back out of the program (any marked paid since stay). Asks first;
// `onUndone` gets the message to show.
export function UndoRegisterAll({
  batchId,
  program,
  teams,
  onUndone,
}: {
  batchId: string;
  program: string;
  teams: number;
  onUndone: (message: string) => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className={`${btn} text-red-600 ring-1 ring-red-600/30`}
        onClick={async () => {
          if (
            !(await confirm({
              title: "Undo Register all?",
              message: `The ${teams} team${teams === 1 ? "" : "s"} it registered come out of ${program}. Teams marked paid stay.`,
              confirmLabel: "Undo",
            }))
          )
            return;
          start(async () => {
            const r = await undoRegisterAll(batchId);
            if (!r.ok) return setMsg(r.message);
            onUndone(
              `${r.removed} team${r.removed === 1 ? "" : "s"} taken out of ${program}.` +
                (r.kept.length ? ` Paid, so kept: ${r.kept.join(", ")}.` : ""),
            );
            router.refresh();
          });
        }}
      >
        {busy ? "Undoing…" : "Undo"}
      </button>
      {msg && <Toast key={msg} message={msg} />}
      {confirmDialog}
    </>
  );
}

// The Register tab's last Register all into a program: when and by whom (tap it for its teams), and Undo (while
// registration is open).
export function LastRegisterAll({ batch, program, canUndo }: { batch: LastBatch; program: string; canUndo: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const at = (t: string) =>
    new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return (
    <div className="mt-1 flex items-start justify-between gap-2 text-xs text-zinc-500">
      <TeamsIncluded
        names={batch.names}
        summary={
          <>
            Register all: {batch.teams} team{batch.teams === 1 ? "" : "s"} · {at(batch.at)} by {batch.by}
            {batch.names.length < batch.teams && ` · ${batch.names.length} still registered`}
          </>
        }
      />
      {canUndo && <UndoRegisterAll batchId={batch.id} program={program} teams={batch.names.length} onUndone={setMsg} />}
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
