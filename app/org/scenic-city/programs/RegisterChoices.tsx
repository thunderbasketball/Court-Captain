"use client";

import { useState, useTransition } from "react";
import {
  REG_OPTIONS,
  closeLabel,
  closedReason,
  entryLine,
  money,
  planChoice,
  shortDate,
  type Choice,
  type ChoiceResult,
  type ProgramOption,
  type SingleKind,
} from "@/lib/program-options";
import { Alert } from "../../../client-ui";

const navyBtn =
  "w-full rounded-full bg-scenic-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-scenic-navy";
const chip = (on: boolean) =>
  `rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${on ? "bg-scenic-navy text-white ring-scenic-navy dark:bg-white dark:text-scenic-navy" : "text-zinc-700 ring-zinc-950/15 dark:text-zinc-200 dark:ring-white/20"}`;

// What a team registers for in a League: ALL Season and/or Single Day options on Game Days. Shows each date's games
// guaranteed (1GG/2GG), whether it makes the brackets, and the fee as they pick; checked again on the server.
// `entry`: what it already has (adding to a registration). `save` registers; returns ok or a message. Without `save`
// (one of several teams on Register), no button: `onChange` hands each pick up to the form.
export default function RegisterChoices({
  options,
  gameDates,
  today,
  entry,
  save,
  cart,
  saveLabel,
  onChange,
  paid,
}: {
  options: ProgramOption[];
  gameDates: string[];
  today: string;
  entry: (Choice & ChoiceResult) | null;
  save?: (choice: Choice) => Promise<{ ok: true } | { ok: false; message: string }>;
  // Add to cart, beside paying now (which the button then says when there's something to pay).
  cart?: (choice: Choice) => Promise<{ ok: true } | { ok: false; message: string }>;
  saveLabel?: string; // the button (default Register, or Add to registration)
  paid?: boolean; // adding: whether what it already has is paid (shown beside it)
  onChange?: (choice: Choice) => void;
}) {
  const had: Choice = entry ? { allSeason: entry.allSeason, days: entry.days } : { allSeason: false, days: [] };
  const [all, setAllState] = useState(false);
  const [days, setDaysState] = useState<Choice["days"]>([]);
  // Each pick also goes up to the form (one of several teams).
  const setAll = (v: boolean) => {
    const nextDays = v ? days : keepValid(days, false); // a 2nd Game whose day no longer has a first game comes off
    setAllState(v);
    setDaysState(nextDays);
    onChange?.({ allSeason: v, days: nextDays });
  };
  const setDays = (v: Choice["days"]) => {
    setDaysState(v);
    onChange?.({ allSeason: all, days: v });
  };
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const add: Choice = { allSeason: all, days };
  // What's picked, checked like the server does: the options' rules, then each option's own close.
  const plan0 = planChoice(options, gameDates, had, add);
  const closed0 = "error" in plan0 ? null : closedReason(options, gameDates, had, add, today);
  const plan = closed0 ? { error: closed0 } : plan0;
  const upcoming = gameDates.filter((d) => d >= today);
  const picked = (date: string, kind: SingleKind) => days.some((d) => d.date === date && d.kind === kind);
  const fits = (next: Choice) =>
    !("error" in planChoice(options, gameDates, had, next)) && !closedReason(options, gameDates, had, next, today);
  // Greyed out: a date that can't be picked with what's picked now (e.g. 1 Game on a day ALL Season already plays).
  const canPick = (date: string, kind: SingleKind) =>
    picked(date, kind) || fits({ allSeason: all, days: [...days, { date, kind }] });
  // A 2nd Game whose day no longer has a first game comes off with it.
  const keepValid = (list: Choice["days"], allSeason: boolean) =>
    list.filter(
      (d) =>
        d.kind !== "single_2nd" ||
        allSeason ||
        had.allSeason ||
        [...had.days, ...list].some((x) => x.date === d.date && x.kind === "single_1"),
    );
  const toggle = (date: string, kind: SingleKind) =>
    setDays(
      picked(date, kind)
        ? keepValid(
            days.filter((d) => !(d.date === date && d.kind === kind)),
            all,
          )
        : [...days, { date, kind }],
    );
  const nothing = !all && !days.length;

  return (
    <div className="space-y-4">
      {entry && (
        <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
          Registered so far: {entryLine(entry)} · Brackets: {entry.bracket ? "Yes" : "No"}
        </p>
      )}
      {REG_OPTIONS.filter((o) => options.some((x) => x.kind === o.key)).map((o) => {
        const opt = options.find((x) => x.kind === o.key)!;
        const fee = opt.feeCents;
        const closes = closeLabel(opt);
        const price = `${fee !== null ? ` · ${money(fee)}${o.perDate ? " per date" : ""}` : ""}${closes ? ` · ${closes}` : ""}`;
        if (o.key === "all_season")
          return had.allSeason ? null : (
            <label key={o.key} className="flex items-start gap-3 rounded-xl p-3 ring-1 ring-zinc-950/10 dark:ring-white/10">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={all}
                disabled={!all && !fits({ allSeason: true, days })}
                onChange={(e) => setAll(e.target.checked)}
              />
              <span className="text-sm">
                <span className="font-semibold">{o.name}</span>
                <span className="text-zinc-500">{price}</span>
                <span className="block text-zinc-500">{o.about}</span>
              </span>
            </label>
          );
        const kind = o.key as SingleKind;
        const second = kind === "single_2nd";
        const open = upcoming.filter((d) => canPick(d, kind));
        return (
          <div
            key={o.key}
            className={`rounded-xl p-3 ${
              second
                ? "bg-amber-50 ring-2 ring-amber-400 dark:bg-amber-500/10 dark:ring-amber-400/60"
                : "ring-1 ring-zinc-950/10 dark:ring-white/10"
            } ${open.length ? "" : "opacity-50"}`}
          >
            <p className="text-sm">
              <span className="font-semibold">
                {second ? "★ " : ""}
                {o.name}
              </span>
              <span className="text-zinc-500">{price}</span>
            </p>
            <p className="mb-2 text-xs text-zinc-500">
              {o.about}.{" "}
              {open.length
                ? "Tap the dates."
                : second
                  ? "Pick a day the team plays first."
                  : "Not available: closed, or the team already plays those days."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {upcoming.map((d) => {
                const done = had.days.some((x) => x.date === d && x.kind === o.key);
                const off = !done && !canPick(d, kind);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={done || off}
                    className={`${off ? "rounded-full px-3 py-1.5 text-xs font-medium text-zinc-400 line-through ring-1 ring-zinc-950/5 dark:text-zinc-600 dark:ring-white/5" : chip(done || picked(d, kind))} disabled:cursor-not-allowed`}
                    onClick={() => toggle(d, kind)}
                  >
                    {shortDate(d)}
                  </button>
                );
              })}
              {!upcoming.length && <span className="text-xs text-zinc-500">No upcoming Game Days.</span>}
            </div>
          </div>
        );
      })}

      {!nothing &&
        ("error" in plan ? (
          <Alert tone="red">{plan.error}</Alert>
        ) : (
          <div className="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
            <p>{entryLine({ ...plan.merged, ...plan.result }) || "—"}</p>
            <p className="mt-1">
              Brackets:{" "}
              {plan.result.bracket ? (
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">Yes</span>
              ) : (
                <span className="text-zinc-500">
                  No (needs ALL Season, or {Math.ceil(gameDates.length / 2)} of the {gameDates.length} Game Days)
                </span>
              )}
            </p>
            {entry ? (
              <>
                {/* Adding: what it already has (and whether that's paid) apart from what this addition costs now. */}
                <p className="mt-1 text-zinc-600 dark:text-zinc-300">
                  Already registered: {entry.allSeason ? "ALL Season" : entryLine(entry)} · {money(entry.feeCents)}
                  {paid !== undefined && (
                    <span className={paid ? "font-medium text-emerald-700 dark:text-emerald-400" : "font-medium text-amber-700 dark:text-amber-400"}>
                      {paid ? " · Paid" : " · Unpaid"}
                    </span>
                  )}
                </p>
                <p className="mt-1 font-semibold">
                  To pay now: {money(plan.newFeeCents)}
                  <span className="font-normal text-zinc-500"> (new total {money(plan.result.feeCents)})</span>
                </p>
              </>
            ) : (
              <p className="mt-1 font-semibold">Fee: {money(plan.newFeeCents)}</p>
            )}
          </div>
        ))}
      {error && <Alert tone="red">{error}</Alert>}
      {save && (
      <button
        type="button"
        className={navyBtn}
        disabled={busy || nothing || "error" in plan}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await save!(add);
            if (!r.ok) setError(r.message);
          })
        }
      >
        {busy
          ? "Saving…"
          : cart && !nothing && !("error" in plan) && plan.newFeeCents > 0
            ? `Pay now · ${money(plan.newFeeCents)}`
            : (saveLabel ?? (entry ? "Add to registration" : "Register"))}
      </button>
      )}
      {cart && (
        <button
          type="button"
          className="w-full rounded-full px-4 py-2.5 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 disabled:opacity-50 dark:text-blue-400"
          disabled={busy || nothing || "error" in plan}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await cart(add);
              if (!r.ok) setError(r.message);
            })
          }
        >
          Add to cart
        </button>
      )}
    </div>
  );
}
