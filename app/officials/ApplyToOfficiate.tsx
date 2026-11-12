"use client";

import { useState, useTransition } from "react";
import { applyToOfficiateAction } from "./apply-actions";
import { setAcceptsRecruitsAction } from "./actions";

const input = "w-full min-w-0 rounded-lg bg-white px-3 py-2 text-base ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15";

// "Apply to officiate for <organization>" on a login page (while it accepts recruits): tap to open the application right
// here. Applicants join as Recruits; the organization's Assigner sets their level.
export function ApplyToOfficiate({ org, name }: { org: string; name: string }) {
  const [open, setOpen] = useState(false);
  const blank = { first: "", last: "", cell: "", email: "", experience: "", website: "" };
  const [f, setF] = useState(blank);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block font-semibold">Apply to officiate</span>
          <span className="block text-xs text-zinc-500">{name}: referees for youth basketball games</span>
        </span>
        <span aria-hidden className={`text-zinc-400 transition ${open ? "rotate-90" : ""}`}>
          ›
        </span>
      </button>
      {open && (
        <div className="border-t border-zinc-100 px-4 py-3 dark:border-white/5">
          {done ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">{done}</p>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  setError(null);
                  const r = await applyToOfficiateAction(org, f);
                  if (!r.ok) return setError(r.message);
                  setDone(
                    r.already
                      ? `Thanks, ${r.name}. You're already on ${name}'s officials list.`
                      : `Thanks, ${r.name}! Your application is in. ${name} will be in touch; log in anytime with your cell.`,
                  );
                  setF(blank);
                });
              }}
            >
              <div className="grid grid-cols-2 gap-2">
                <input className={input} placeholder="First name" aria-label="First name" autoComplete="given-name" value={f.first} onChange={set("first")} />
                <input className={input} placeholder="Last name" aria-label="Last name" autoComplete="family-name" value={f.last} onChange={set("last")} />
              </div>
              <input className={input} placeholder="Cell" aria-label="Cell" inputMode="tel" autoComplete="tel" value={f.cell} onChange={set("cell")} />
              <input className={input} placeholder="Email (optional)" aria-label="Email" type="email" autoComplete="email" value={f.email} onChange={set("email")} />
              <textarea
                className={`${input} h-24`}
                maxLength={500}
                placeholder="Your officiating experience (optional): years, levels, certifications"
                aria-label="Your officiating experience"
                value={f.experience}
                onChange={set("experience")}
              />
              {/* Left empty by people; bots fill it in. */}
              <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden name="website" value={f.website} onChange={set("website")} />
              <button
                type="submit"
                disabled={busy || !f.first.trim() || !f.last.trim() || !f.cell.trim()}
                className="w-full rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send application"}
              </button>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <p className="text-xs text-zinc-400">New officials start as Recruits; {name} sets your level.</p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// "Accept recruits" on the Officials card: on, Apply to officiate shows on the login page.
export function AcceptRecruitsSwitch({ org, on, where }: { org: string; on: boolean; where: string }) {
  const [value, setValue] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="mb-3 flex items-start gap-3 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-white/5">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label="Accept recruits"
        disabled={busy}
        onClick={() => {
          const next = !value;
          setValue(next);
          start(async () => {
            setError(null);
            const r = await setAcceptsRecruitsAction(org, next);
            if (!r.ok) {
              setValue(!next);
              setError(r.message);
            }
          });
        }}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${value ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
      >
        <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${value ? "left-6" : "left-1"}`} />
      </button>
      <div className="min-w-0">
        <p className="text-sm font-semibold">Accept recruits {value ? "· On" : "· Off"}</p>
        <p className="text-xs text-zinc-500">
          {value ? `Apply to officiate shows on ${where}.` : `On: Apply to officiate shows on ${where}.`} Applicants join as Recruits; set
          their level when you&apos;re ready.
        </p>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
