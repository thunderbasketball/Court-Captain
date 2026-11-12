"use client";

// Register a team: 1) the Head Coach's cell, 2) the program, the team, the Head Coach, optional staff, a PIN and (a
// League) ALL Season or Game Days, 3) the emailed code. Then they're registered and logged in. No Level: set on the server.
import { useState, useTransition, type ReactNode } from "react";
import type { Choice as RegChoice } from "@/lib/program-options";
import type { OpenProgram, TeamStep } from "@/lib/team-signup";
import RegisterChoices from "../../org/scenic-city/programs/RegisterChoices";
import { formatCell, normalizeCell } from "@/lib/phone";
import {
  completeTeamSignup,
  forgotTeamPin,
  goTeamSignup,
  lookupCell,
  pinTeamSignup,
  resetTeamPin,
  startTeamSignup,
} from "./actions";
import { Alert } from "../../client-ui";
import { fieldLabel, inputCls, pillCls, primaryBtn } from "../../ui";

type Choice = { value: string; label: string };
const ROLES = [
  { key: "AsstCoach", label: "Assistant Coach" },
  { key: "Manager", label: "Manager" },
  { key: "TeamParent", label: "Team Parent" },
] as const;
type Person = { first: string; last: string; cell: string; email: string };
const blank: Person = { first: "", last: "", cell: "", email: "" };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

export function TeamSignupForm({
  grades,
  programs,
  today,
  preset,
}: {
  grades: Choice[];
  programs: OpenProgram[];
  today: string;
  preset?: string; // the event picked on the login page
}) {
  const [screen, setScreen] = useState<"cell" | "pin" | "reset" | "choose" | "form" | "code">("cell");
  const [existing, setExisting] = useState(false);
  // A returning coach's CourtSolo accounts and organizations (what they came to do is asked first).
  type Accounts = NonNullable<Extract<TeamStep, { step: "form" }>["accounts"]>;
  const [accounts, setAccounts] = useState<Accounts>({ solo: [], orgs: [] });
  const [replace, setReplace] = useState<string | null>(null); // their CourtSolo account whose team this new one replaces
  const [switching, setSwitching] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [orgShort, setOrgShort] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [grade, setGrade] = useState("");
  const fixed = programs.find((p) => p.id === preset) ?? (programs.length === 1 ? programs[0] : undefined);
  const [programId, setProgramId] = useState(fixed?.id ?? "");
  const program = programs.find((p) => p.id === programId);
  const [head, setHead] = useState<Person>(blank);
  const [staff, setStaff] = useState<Record<string, Person>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [pin, setPin] = useState("");
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [code, setCode] = useState("");

  type Res = Awaited<ReturnType<typeof lookupCell>>;
  // Moves to the next screen; returns a message to show, or null.
  const next = (r: Res): string | null => {
    if (r.step === "pin") setScreen("pin");
    else if (r.step === "resetCode") {
      setMaskedEmail(r.maskedEmail);
      setScreen("reset");
    } else if (r.step === "form") {
      setExisting(r.existing);
      // After their PIN: the Head Coach's name and email from their login.
      if (r.coach) setHead((h) => ({ ...h, ...r.coach }));
      if (r.accounts && (r.accounts.solo.length || r.accounts.orgs.length)) {
        setAccounts(r.accounts);
        setScreen("choose");
      } else setScreen("form");
    } else if (r.step === "code") {
      setMaskedEmail(r.maskedEmail);
      setScreen("code");
    } else if (r.step === "loggedIn") window.location.assign(r.next);
    else if (r.step === "error" || r.step === "done") return r.message;
    return null;
  };
  const go = (call: () => Promise<Res>) =>
    start(async () => {
      setError(null);
      setError(next(await call()));
    });
  // The League's ALL Season or Game Days picked (kept so "Send a new code" can resend).
  const [choice, setChoice] = useState<RegChoice | undefined>();
  const signup = (c: RegChoice | undefined) =>
    startTeamSignup({
      programId,
      choice: c,
      name,
      gender,
      grade,
      ...head,
      pin: existing ? pin : undefined,
      pin1: existing ? undefined : pin1,
      pin2: existing ? undefined : pin2,
      staff: ROLES.filter((r) => open[r.key]).map((r) => ({ role: r.key, ...(staff[r.key] ?? blank) })),
      replace: replace ?? undefined,
    });
  const send = () => go(() => signup(choice));
  // From the League's date picker: its button sends the code.
  const sendWithDates = async (c: RegChoice) => {
    setChoice(c);
    const message = next(await signup(c));
    return message ? { ok: false as const, message } : { ok: true as const };
  };
  const pinInput = (value: string, set: (v: string) => void, label: string) => (
    <Field label={label}>
      <input
        className={inputCls}
        type="password"
        inputMode="numeric"
        autoComplete={existing ? "current-password" : "new-password"}
        maxLength={4}
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, ""))}
      />
    </Field>
  );
  // fixed: the Head Coach with a login (name and cell come from it; the email can still change).
  const person = (p: Person, set: (p: Person) => void, emailNote: string, fixed = false) => (
    <div className="grid grid-cols-2 gap-3">
      <Field label="First name">
        <input
          className={`${inputCls} read-only:bg-zinc-50 read-only:text-zinc-500 dark:read-only:bg-white/5`}
          autoComplete="off"
          readOnly={fixed}
          value={p.first}
          onChange={(e) => set({ ...p, first: e.target.value })}
        />
      </Field>
      <Field label="Last name">
        <input
          className={`${inputCls} read-only:bg-zinc-50 read-only:text-zinc-500 dark:read-only:bg-white/5`}
          autoComplete="off"
          readOnly={fixed}
          value={p.last}
          onChange={(e) => set({ ...p, last: e.target.value })}
        />
      </Field>
      <Field label="Cell">
        <input
          className={`${inputCls} read-only:bg-zinc-50 read-only:text-zinc-500 dark:read-only:bg-white/5`}
          type="tel"
          inputMode="tel"
          readOnly={fixed}
          value={p.cell}
          onChange={(e) => set({ ...p, cell: e.target.value })}
        />
      </Field>
      <Field label={emailNote}>
        <input
          className={inputCls}
          type="email"
          inputMode="email"
          value={p.email}
          onChange={(e) => set({ ...p, email: e.target.value })}
        />
      </Field>
    </div>
  );

  if (screen === "cell")
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          go(() => lookupCell(head.cell));
        }}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Register a team with Scenic City. Start with the Head Coach&apos;s cell: it&apos;s their login.
        </p>
        <Field label="Head Coach's cell">
          <input
            className={inputCls}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={head.cell}
            onChange={(e) => setHead({ ...head, cell: e.target.value })}
          />
        </Field>
        {error && <Alert tone="red">{error}</Alert>}
        <button className={primaryBtn} disabled={busy}>
          {busy ? "Checking…" : "Next"}
        </button>
      </form>
    );

  // A returning coach: what are they here to do?
  const event =programs.find((p) => p.id === preset) ?? (programs.length === 1 ? programs[0] : undefined);
  const eventName = event?.name ?? "an event";
  const choiceBtn =
    "block w-full rounded-xl px-3 py-2.5 text-left ring-1 ring-zinc-950/10 hover:bg-zinc-50 disabled:opacity-50 dark:ring-white/15 dark:hover:bg-white/5";
  if (screen === "choose")
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Welcome back, {head.first}. What would you like to do?</p>
        {accounts.solo.map((a) => (
          <section key={a.slug} className="space-y-2">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Your team: {a.teamName ?? a.name}</h2>
            {/* Already in this event: a CourtSolo account has one team, so another team means switching to CourtOrg. */}
            {event && a.inPrograms.includes(event.id) && (
              <p className="rounded-xl bg-zinc-50 px-3 py-2.5 text-sm text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
                {a.teamName} is already registered for {event.name}. To register another team, switch to a club with more teams.
              </p>
            )}
            {a.teamName && !(event && a.inPrograms.includes(event.id)) && (
              <button
                type="button"
                className={choiceBtn}
                disabled={busy}
                onClick={() => go(() => goTeamSignup(head.cell, pin, { to: "register", slug: a.slug }))}
              >
                <span className="block font-semibold">
                  Register {a.teamName} for {eventName}
                </span>
                <span className="block text-xs text-zinc-500">The same team: pick its dates on your team&apos;s page.</span>
              </button>
            )}
            {!(event && a.inPrograms.includes(event.id)) && (
              <button
              type="button"
              className={choiceBtn}
              disabled={busy || !!a.busyIn}
              onClick={() => {
                setReplace(a.slug);
                setError(null);
                setScreen("form");
              }}
            >
              <span className="block font-semibold">
                {a.teamName ? `Archive ${a.teamName} and create a new team` : "Create your team"}
              </span>
              <span className="block text-xs text-zinc-500">
                {a.busyIn
                  ? `Not yet: ${a.teamName} is in ${a.busyIn} until it ends.`
                  : "A one-team club has one active team. The old one stays as history."}
              </span>
            </button>
            )}
            <button
              type="button"
              className={choiceBtn}
              disabled={busy}
              onClick={() => setSwitching(switching === a.slug ? null : a.slug)}
            >
              <span className="block font-semibold">Switch to a club with more teams{a.teamName ? ` and bring ${a.teamName}` : ""}</span>
              <span className="block text-xs text-zinc-500">For more than one team: your account becomes an organization.</span>
            </button>
            {switching === a.slug && (
              <form
                className="space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5"
                onSubmit={(e) => {
                  e.preventDefault();
                  go(() =>
                    goTeamSignup(head.cell, pin, {
                      to: "switch",
                      slug: a.slug,
                      name: orgName,
                      short: orgShort || orgName.slice(0, 20),
                    }),
                  );
                }}
              >
                <Field label="Organization name">
                  <input className={inputCls} maxLength={60} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                </Field>
                <Field label="Short name (up to 20 letters)">
                  <input className={inputCls} maxLength={20} value={orgShort} onChange={(e) => setOrgShort(e.target.value)} />
                </Field>
                <button className={primaryBtn} disabled={busy || !orgName.trim()}>
                  {busy ? "Switching…" : "Switch to a club with more teams"}
                </button>
              </form>
            )}
          </section>
        ))}
        {accounts.orgs.map((o) => (
          <button
            key={o.slug}
            type="button"
            className={choiceBtn}
            disabled={busy}
            onClick={() => go(() => goTeamSignup(head.cell, pin, { to: "org", slug: o.slug }))}
          >
            <span className="block font-semibold">Add a team to {o.name}</span>
            <span className="block text-xs text-zinc-500">Add it on {o.name}&apos;s Teams page and register it there.</span>
          </button>
        ))}
        {!accounts.solo.length && (
          <button type="button" className={choiceBtn} disabled={busy} onClick={() => setScreen("form")}>
            <span className="block font-semibold">Create a separate stand-alone team</span>
            <span className="block text-xs text-zinc-500">Its own one-team CourtClub account.</span>
          </button>
        )}
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    );

  if (screen === "pin")
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          go(() => pinTeamSignup(head.cell, pin));
        }}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {formatCell(normalizeCell(head.cell) ?? head.cell)} already has a login. Enter its PIN to log in; the Head Coach&apos;s
          information fills in from it.
        </p>
        {pinInput(pin, setPin, "PIN")}
        {error && <Alert tone="red">{error}</Alert>}
        <button className={primaryBtn} disabled={busy || pin.length !== 4}>
          {busy ? "Checking…" : "Log in"}
        </button>
        <div className="flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            className="text-thunder-blue hover:underline"
            disabled={busy}
            onClick={() => go(() => forgotTeamPin(head.cell))}
          >
            Forgot PIN?
          </button>
          <button
            type="button"
            className="text-thunder-blue hover:underline"
            onClick={() => {
              setPin("");
              setError(null);
              setScreen("cell");
            }}
          >
            Use a different cell
          </button>
        </div>
      </form>
    );

  // Forgot PIN: the code from their email, then a new PIN; the form opens with their information.
  if (screen === "reset")
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          go(async () => {
            const r = await resetTeamPin(head.cell, code, pin1, pin2);
            if (r.step === "form") {
              setPin(pin1); // their new PIN, checked again when the code is sent
              setCode("");
            }
            return r;
          });
        }}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          We emailed a 6-digit code to <strong>{maskedEmail}</strong>. Enter it and choose a new 4-digit PIN.
        </p>
        <Field label="Code">
          <input
            className={inputCls}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {pinInput(pin1, setPin1, "New PIN")}
          {pinInput(pin2, setPin2, "New PIN again")}
        </div>
        {error && <Alert tone="red">{error}</Alert>}
        <button className={primaryBtn} disabled={busy || code.length !== 6}>
          {busy ? "Checking…" : "Set PIN"}
        </button>
        <div className="flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            className="text-thunder-blue hover:underline"
            disabled={busy}
            onClick={() => go(() => forgotTeamPin(head.cell))}
          >
            Send a new code
          </button>
          <button
            type="button"
            className="text-thunder-blue hover:underline"
            onClick={() => {
              setError(null);
              setScreen("pin");
            }}
          >
            Back
          </button>
        </div>
      </form>
    );

  if (screen === "code")
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          go(() => completeTeamSignup(head.cell, code));
        }}
      >
        <p className="text-sm">
          We emailed a 6-digit code to <strong>{maskedEmail}</strong>. Enter it to finish registering {name} in {" "}
          {program?.name}.
        </p>
        <Field label="Code">
          <input
            className={inputCls}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
        {error && <Alert tone="red">{error}</Alert>}
        <button className={primaryBtn} disabled={busy}>
          {busy ? "Checking…" : "Register team"}
        </button>
        <button type="button" disabled={busy} onClick={send} className="w-full text-sm text-thunder-blue hover:underline">
          Send a new code
        </button>
      </form>
    );

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {replace && (
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/10 dark:text-amber-200">
          This new team replaces {accounts.solo.find((x) => x.slug === replace)?.teamName ?? "your team"}, which is archived (kept
          as history).{" "}
          <button type="button" className="font-semibold underline" onClick={() => setScreen("choose")}>
            Change
          </button>
        </p>
      )}
      <section className="space-y-4">
        <h2 className="font-semibold">Program</h2>
        {fixed ? (
          // Picked on the login page (or the only one open): shown, not asked.
          <p className="rounded-xl bg-zinc-50 px-3 py-2.5 text-sm font-medium dark:bg-white/5">
            {fixed.name} <span className="font-normal text-zinc-500">({fixed.kind})</span>
          </p>
        ) : (
          <select className={inputCls} aria-label="Program" value={programId} onChange={(e) => setProgramId(e.target.value)}>
            <option value="" disabled>
              Pick a program…
            </option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.kind})
              </option>
            ))}
          </select>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-semibold">Team</h2>
        <Field label="Team name (like 5B Hixson Hoops)">
          <input className={inputCls} maxLength={60} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div>
          <span className={fieldLabel}>Gender</span>
          <div className="flex gap-2">
            {["Boys", "Girls"].map((g) => (
              <button key={g} type="button" className={pillCls(gender === g)} onClick={() => setGender(g)}>
                {g}
              </button>
            ))}
          </div>
        </div>
        <Field label="Grade">
          <select
            className={inputCls}
            value={grade}
            onChange={(e) => {
              setGrade(e.target.value);
              // Pre-K teams are Coed.
              if (e.target.value === "PK") setGender("Coed");
              else if (gender === "Coed") setGender("");
            }}
          >
            <option value="" disabled>
              Pick…
            </option>
            {grades.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="space-y-4">
        <h2 className="font-semibold">Head Coach</h2>
        {person(head, setHead, "Email", existing)}
        {existing ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Logged in with this cell&apos;s PIN. Check the email.</p>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Choose a 4-digit PIN for the Head Coach&apos;s login.</p>
            <div className="grid grid-cols-2 gap-3">
              {pinInput(pin1, setPin1, "PIN")}
              {pinInput(pin2, setPin2, "PIN again")}
            </div>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">
          Other staff <span className="font-normal text-zinc-500">(optional)</span>
        </h2>
        {ROLES.map((r) =>
          open[r.key] ? (
            <div key={r.key} className="space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{r.label}</span>
                <button
                  type="button"
                  className="text-sm text-zinc-500 hover:underline"
                  onClick={() => setOpen({ ...open, [r.key]: false })}
                >
                  Remove
                </button>
              </div>
              {person(staff[r.key] ?? blank, (p) => setStaff({ ...staff, [r.key]: p }), "Email (optional)")}
            </div>
          ) : (
            <button
              key={r.key}
              type="button"
              className="mr-2 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-zinc-950/10 dark:ring-white/15"
              onClick={() => setOpen({ ...open, [r.key]: true })}
            >
              + {r.label}
            </button>
          ),
        )}
      </section>

      {program?.league && error && <Alert tone="red">{error}</Alert>}
      {program?.league ? (
        // A League: pick ALL Season or Game Days; its button sends the code.
        <section className="space-y-3">
          <h2 className="font-semibold">Register for</h2>
          <RegisterChoices
            options={program.league.options}
            gameDates={program.league.gameDates}
            today={today}
            entry={null}
            save={sendWithDates}
            saveLabel="Email me a code"
          />
        </section>
      ) : (
        <>
          {error && <Alert tone="red">{error}</Alert>}
          <button className={primaryBtn} disabled={busy || !program}>
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </>
      )}
      <button type="button" className="w-full text-sm text-zinc-500 hover:underline" onClick={() => setScreen("cell")}>
        ← Change cell
      </button>
    </form>
  );
}
