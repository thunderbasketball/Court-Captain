"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GridSlot, WeekGrid } from "@/lib/practice/schedule";
import { bookSlot, releaseSlot, setSlotBlocked } from "./actions";
import { Alert, CloseButton, Toast, dialogCls } from "../../../client-ui";
import { BellIcon, NotifyPanel } from "../../../NotifyButton";
import { fieldLabel, inputCls, primaryBtn } from "../../../ui";

type Ctx = { slot: GridSlot; when: string; where: string };
type Action = { kind: "book" | "release" | "block"; ctx: Ctx };
type Outcome = { slotId: string; startsAt: string; reason?: string };

const btn = {
  book: "rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700",
  release:
    "rounded-md px-2.5 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-400/60 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
  block:
    "rounded-md px-2.5 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-500/50 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10",
};
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" });

// The week grid, like the old Master Practice Schedule: a card per day, gyms inside, times down the left,
// one line per court. Director: Release / Block / Unblock / Book. Team: Book / Release with the limits applied.
export default function WeekGridView({
  grid,
  mode,
  teams,
}: {
  grid: WeekGrid;
  mode: "director" | "team";
  teams: { id: string; name: string }[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [alertDay, setAlertDay] = useState<string | null>(null); // the day whose alert form is open on its card
  const [teamId, setTeamId] = useState(grid.team?.id ?? "");
  const [everyWeek, setEveryWeek] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ booked: Outcome[]; skipped: Outcome[] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const open = (kind: Action["kind"], ctx: Ctx) => {
    setAction({ kind, ctx });
    setEveryWeek(false);
    setReason("");
    setError(null);
    setResult(null);
    if (mode === "director") setTeamId("");
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();
  const finish = (message: string) => {
    close();
    setToast(message);
    router.refresh();
  };
  const unblock = (slot: GridSlot) =>
    start(async () => {
      const r = await setSlotBlocked({ slotId: slot.id, blocked: false });
      if (!r.ok) setToast(r.message);
      else router.refresh();
    });

  const submit = () =>
    start(async () => {
      if (!action) return;
      setError(null);
      const { slot } = action.ctx;
      if (action.kind === "book") {
        const r = await bookSlot({ slotId: slot.id, teamId, everyWeek, asTeam: mode === "team" });
        if (!r.ok) return setError(r.message);
        router.refresh();
        if (everyWeek || r.warnings.length) return setResult({ booked: r.booked, skipped: r.skipped });
        return finish("Practice booked.");
      }
      if (action.kind === "release") {
        const r = await releaseSlot({ slotId: slot.id, everyWeek });
        if (!r.ok) return setError(r.message);
        return finish(`Released ${r.released} practice${r.released === 1 ? "" : "s"}.`);
      }
      const r = await setSlotBlocked({ slotId: slot.id, blocked: true, reason });
      if (!r.ok) return setError(r.message);
      finish(r.removed ? `Blocked. ${r.removed}'s booking was removed.` : "Slot blocked.");
    });

  const line = (s: GridSlot, ctx: Omit<Ctx, "slot">) => {
    const c = { ...ctx, slot: s };
    let text;
    let actions = null;
    if (s.blackout) {
      text = (
        <span className="text-red-600 dark:text-red-400">
          {s.court}: Blocked{s.note ? ` – ${s.note}` : ""}
        </span>
      );
      if (mode === "director" && !s.past)
        actions = (
          <button type="button" disabled={busy} className={btn.release} onClick={() => unblock(s)}>
            Unblock
          </button>
        );
    } else if (s.team) {
      text = (
        <span className={mode === "team" && !s.mine ? "text-zinc-500 dark:text-zinc-400" : "text-violet-700 dark:text-violet-300"}>
          {s.court}: {s.team}
          {s.mine && mode === "team" && <span className="font-normal"> (your team)</span>}
          {s.bookedBy && <span className="block text-xs font-normal text-violet-600/80 dark:text-violet-300/70">by {s.bookedBy}</span>}
        </span>
      );
      if (!s.past && (mode === "director" || (s.mine && grid.team?.canBookRole)))
        actions = (
          <>
            <button type="button" className={btn.release} onClick={() => open("release", c)}>
              Release
            </button>
            {mode === "director" && (
              <button type="button" className={btn.block} onClick={() => open("block", c)}>
                Block
              </button>
            )}
          </>
        );
    } else {
      text = <span className="text-emerald-700 dark:text-emerald-400">{s.court}: Available</span>;
      if (!s.past && mode === "director")
        actions = (
          <>
            <button type="button" className={btn.book} onClick={() => open("book", c)}>
              Book
            </button>
            <button type="button" className={btn.block} onClick={() => open("block", c)}>
              Block
            </button>
          </>
        );
      if (mode === "team")
        actions = s.canBook ? (
          <button type="button" className={btn.book} onClick={() => open("book", c)}>
            Book
          </button>
        ) : (
          <span className="max-w-28 text-right text-[11px] leading-tight text-zinc-400" title={s.reason ?? ""}>
            {s.reason?.startsWith("Team parents") ? "View only" : "Limit reached"}
          </span>
        );
    }
    return (
      <li key={s.id} className={`flex flex-wrap items-start justify-between gap-x-2 gap-y-1 py-1 ${s.past ? "opacity-50" : ""}`}>
        <span className="min-w-[7.5rem] flex-1 text-sm font-semibold">{text}</span>
        <span className="ml-auto flex shrink-0 gap-1">{actions}</span>
      </li>
    );
  };

  const a = action;
  return (
    <>
      {toast && <Toast key={toast} message={toast} />}
      {grid.team && (
        <div className="mb-4 rounded-2xl bg-violet-50 px-4 py-3 text-sm ring-1 ring-violet-600/15 ring-inset dark:bg-violet-500/10">
          <p className="font-semibold text-violet-900 dark:text-violet-200">{grid.team.name}</p>
          <p className="text-violet-800 dark:text-violet-300">{grid.team.status}</p>
          <p className="mt-1 text-xs text-violet-700/80 dark:text-violet-300/70">
            Rule: 1 practice per Mon–Fri week, plus 1 extra if it starts within 72 hours.
          </p>
        </div>
      )}
      {!grid.days.length && (
        <p className="text-zinc-500">
          {mode === "team"
            ? "No open practice slots at your gyms this week."
            : "No practice slots this week. Use “+ Add slots” to create some."}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {grid.days.map((d) => (
          <section
            key={d.iso}
            className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10"
          >
            <h2 className="flex items-center justify-between gap-2 bg-zinc-900 px-4 py-2 text-sm font-bold text-white dark:bg-zinc-800">
              {d.label}
              {mode === "director" && d.gyms.some((g) => g.times.some((t) => t.slots.some((x) => x.team))) && (
                <button
                  type="button"
                  aria-label={`Notify everyone practicing ${d.label}`}
                  title={`Notify everyone practicing ${d.label}`}
                  aria-expanded={alertDay === d.iso}
                  onClick={() => setAlertDay(alertDay === d.iso ? null : d.iso)}
                  className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-thunder-orange ring-1 ring-thunder-orange/40 hover:bg-orange-500/10 ${
                    alertDay === d.iso ? "bg-thunder-orange/20" : ""
                  }`}
                >
                  <BellIcon className="size-4" />
                </button>
              )}
            </h2>
            {/* The day's alert opens here on its card (tap the bell again to close). */}
            {alertDay === d.iso && (
              <div className="border-b border-zinc-100 px-3 pt-3 pb-3 dark:border-white/5">
                <NotifyPanel audience={{ practiceDate: d.iso }} to={`everyone practicing ${d.label}`} />
              </div>
            )}
            <div className="space-y-3 px-4 py-3">
              {d.gyms.map((g) => (
                <div key={g.gym}>
                  <h3 className="mb-1 border-b border-zinc-200 pb-1 text-xs font-bold tracking-wide text-zinc-700 uppercase dark:border-white/10 dark:text-zinc-300">
                    {g.gym}
                  </h3>
                  {g.times.map((t) => (
                    <div key={t.label} className="grid grid-cols-[3rem_1fr] gap-1 py-1">
                      <span className="pt-1 text-sm font-bold">{t.label}</span>
                      <ul>{t.slots.map((s) => line(s, { when: `${d.label} · ${t.label}`, where: `${g.gym} ${s.court}` }))}</ul>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        {a && (
          <form
            className="space-y-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {result
                  ? "Booking results"
                  : a.kind === "book"
                    ? "Book practice"
                    : a.kind === "release"
                      ? "Release practice?"
                      : "Block this slot?"}
              </h2>
              <CloseButton onClick={close} />
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {a.ctx.when} · {a.ctx.where}
              {a.ctx.slot.team && ` · ${a.ctx.slot.team}`}
            </p>

            {result ? (
              <>
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  Booked {result.booked.length} week{result.booked.length === 1 ? "" : "s"}
                  {result.booked.length > 0 && `: ${result.booked.map((b) => shortDate(b.startsAt)).join(", ")}`}
                </p>
                {result.skipped.length > 0 && (
                  <div className="text-sm">
                    <p className="font-medium text-amber-700 dark:text-amber-400">Not booked ({result.skipped.length}):</p>
                    <ul className="mt-1 space-y-0.5 text-zinc-600 dark:text-zinc-400">
                      {result.skipped.map((s) => (
                        <li key={s.slotId}>
                          {shortDate(s.startsAt)} – {s.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button type="button" className={primaryBtn} onClick={close}>
                  Done
                </button>
              </>
            ) : (
              <>
                {a.kind === "book" && mode === "director" && (
                  <label className="block">
                    <span className={fieldLabel}>Team</span>
                    <select className={inputCls} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                      <option value="">Choose…</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs text-zinc-500">As Director you&apos;re not held to team limits.</span>
                  </label>
                )}
                {a.kind === "block" && (
                  <>
                    {a.ctx.slot.team && <Alert tone="red">{a.ctx.slot.team}&apos;s booking will be removed.</Alert>}
                    <label className="block">
                      <span className={fieldLabel}>Reason (optional)</span>
                      <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Gym event" />
                    </label>
                  </>
                )}
                {a.kind !== "block" && (
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-thunder-blue"
                      checked={everyWeek}
                      onChange={(e) => setEveryWeek(e.target.checked)}
                    />
                    <span>
                      {a.kind === "book"
                        ? "Book this same slot every future week where it's available (each week is checked against the limits)"
                        : "Also release this same slot in every future week"}
                    </span>
                  </label>
                )}
                {error && <Alert tone="red">{error}</Alert>}
                <button
                  type="submit"
                  disabled={busy || (a.kind === "book" && !teamId)}
                  className={a.kind === "book" ? primaryBtn : `${primaryBtn} !bg-red-600 hover:!bg-red-700`}
                >
                  {busy ? "Working…" : a.kind === "book" ? "Book" : a.kind === "release" ? "Release" : "Block slot"}
                </button>
              </>
            )}
          </form>
        )}
      </dialog>
    </>
  );
}
