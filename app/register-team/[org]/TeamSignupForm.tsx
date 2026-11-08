"use client";

// Register a team: 1) the Head Coach's cell, 2) the program, the team, the Head Coach, optional staff, a PIN and (a
// League) ALL Season or Game Days, 3) the emailed code. Then they're registered and logged in. No Level: set on the server.
import { useState, useTransition, type ReactNode } from "react";
import type { Choice as RegChoice } from "@/lib/program-options";
import type { OpenProgram } from "@/lib/team-signup";
import RegisterChoices from "../../org/scenic-city/programs/RegisterChoices";
import { completeTeamSignup, lookupCell, startTeamSignup } from "./actions";
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

export function TeamSignupForm({ grades, programs, today }: { grades: Choice[]; programs: OpenProgram[]; today: string }) {
  const [screen, setScreen] = useState<"cell" | "form" | "code">("cell");
  const [existing, setExisting] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [grade, setGrade] = useState("");
  const [programId, setProgramId] = useState(programs.length === 1 ? programs[0].id : "");
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
    if (r.step === "form") {
      setExisting(r.existing);
      setScreen("form");
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
  const person = (p: Person, set: (p: Person) => void, emailNote: string) => (
    <div className="grid grid-cols-2 gap-3">
      <Field label="First name">
        <input className={inputCls} autoComplete="off" value={p.first} onChange={(e) => set({ ...p, first: e.target.value })} />
      </Field>
      <Field label="Last name">
        <input className={inputCls} autoComplete="off" value={p.last} onChange={(e) => set({ ...p, last: e.target.value })} />
      </Field>
      <Field label="Cell">
        <input
          className={inputCls}
          type="tel"
          inputMode="tel"
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
          We emailed a 6-digit code to <strong>{maskedEmail}</strong>. Enter it to finish registering {name} in {program?.name}.
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
      <section className="space-y-4">
        <h2 className="font-semibold">Program</h2>
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
        {person(head, setHead, "Email")}
        {existing ? (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">This cell already has a login. Enter its PIN.</p>
            {pinInput(pin, setPin, "PIN")}
          </>
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
