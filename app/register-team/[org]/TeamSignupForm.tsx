"use client";

// Register: 1) your cell (your login), 2) the program, your organization's name, you, and each team (+ Add another team):
// gender, grade, its Head Coach (you or someone else), optional staff and (a League) ALL Season or Game Days, 3) the
// emailed code. Then the organization and its teams are registered and you're logged in. No Level: set on the server.
import { useState, useTransition, type ReactNode } from "react";
import StepGuide from "../../StepGuide";
import type { Choice as RegChoice } from "@/lib/program-options";
import type { OpenProgram, TeamStep } from "@/lib/team-signup";
import RegisterChoices from "../../org/scenic-city/programs/RegisterChoices";
import { formatCell, normalizeCell } from "@/lib/phone";
import { signupTeamName } from "@/lib/team-names";
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
// One team on the form (key: kept while others are added or removed, so each keeps what was typed).
type TeamDraft = {
  key: number;
  alt: string; // its Alternate name: in its name in place of the organization's
  gender: string;
  grade: string;
  me: boolean; // its Head Coach is the person registering
  head: Person;
  staff: Record<string, Person>;
  open: Record<string, boolean>;
  choice: RegChoice | undefined;
};
const newTeam = (key: number): TeamDraft => ({ key, alt: "", gender: "", grade: "", me: true, head: blank, staff: {}, open: {}, choice: undefined });

// Grade pills: Pre-K (on its own), K (0) and 1st–12th; one grade, or two next to each other ("7-8").
const GRADE_PILLS = [{ value: "PK", label: "Pre-K" }, { value: "0", label: "K" }, ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))];
const gradeOn = (grade: string, g: string) => (g === "PK" ? grade === "PK" : grade !== "PK" && grade.split("-").includes(g));
function pickGrade(grade: string, g: string): string {
  if (g === "PK" || grade === "PK" || !grade) return grade === g ? "" : g;
  const on = grade.split("-").map(Number);
  const n = Number(g);
  if (on.includes(n)) return on.length === 2 ? String(on.find((x) => x !== n)) : ""; // tap again: off
  if (on.length === 1 && Math.abs(on[0] - n) === 1) return `${Math.min(on[0], n)}-${Math.max(on[0], n)}`; // next to it: both
  return g; // anywhere else: just that grade
}

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
  const [switching, setSwitching] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [orgShort, setOrgShort] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const [orgFullName, setOrgFullName] = useState("");
  const [orgShortName, setOrgShortName] = useState("");
  const [teams, setTeams] = useState<TeamDraft[]>([newTeam(1)]);
  // A team's name: "8B Testing Basketball Epps" (grade and gender, the organization, the Head Coach's last name), or with its
  // Alternate name in the organization's place ("8B Bolts Epps"). Set on the server; shown here as they type.
  const orgPart = orgShortName.trim() || orgFullName; // its short name (asked when the name is over 20 letters)
  const defaultName = (t: TeamDraft) =>
    t.grade ? signupTeamName(t.gender, t.grade, t.alt.trim() || orgPart, t.me ? head.last : t.head.last) : "";
  const setTeam = (key: number, change: Partial<TeamDraft>) => setTeams((list) => list.map((t) => (t.key === key ? { ...t, ...change } : t)));
  const fixed = programs.find((p) => p.id === preset) ?? (programs.length === 1 ? programs[0] : undefined);
  const [programId, setProgramId] = useState(fixed?.id ?? "");
  const program = programs.find((p) => p.id === programId);
  const [head, setHead] = useState<Person>(blank);
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
  const signup = () =>
    startTeamSignup({
      programId,
      orgName: orgFullName,
      orgShort: orgShortName,
      ...head,
      pin: existing ? pin : undefined,
      pin1: existing ? undefined : pin1,
      pin2: existing ? undefined : pin2,
      teams: teams.map((t) => ({
        alt: t.alt,
        gender: t.gender,
        grade: t.grade,
        head: t.me ? "me" : t.head,
        staff: ROLES.filter((r) => t.open[r.key]).map((r) => ({ role: r.key, ...(t.staff[r.key] ?? blank) })),
        choice: t.choice,
      })),
    });
  const send = () => go(signup);
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

  // The step guide on each screen: 1) Log in (cell, PIN or a new PIN, or what they came to do), 2) Your teams, 3) Confirm email.
  const step = (n: number, title: string, text: ReactNode) => (
    <StepGuide name="register" step={n} total={3} title={title}>
      {text}
    </StepGuide>
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
        {step(1, "Log in", "Type your cell number and tap Next. It's your login. New here? We'll set you up as you go.")}
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Register your teams with Scenic City. Start with your cell: it&apos;s your login.
        </p>
        <Field label="Your cell">
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
        {step(1, "Log in", "Pick the organization you're registering teams for, or Register a new organization.")}
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Welcome back, {head.first}. What would you like to do?</p>
        {accounts.solo.map((a) => (
          <section key={a.slug} className="space-y-2">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Your team: {a.teamName ?? a.name}</h2>
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
            <span className="block font-semibold">Register {o.name}&apos;s teams</span>
            <span className="block text-xs text-zinc-500">Add and register them on {o.name}&apos;s Teams page.</span>
          </button>
        ))}
        <button type="button" className={choiceBtn} disabled={busy} onClick={() => setScreen("form")}>
          <span className="block font-semibold">Register a new organization</span>
          <span className="block text-xs text-zinc-500">A separate organization with its own teams.</span>
        </button>
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
        {step(1, "Log in", "You've been here before. Type your 4-digit PIN. Forgot it? Tap Forgot PIN? and we'll email you a code.")}
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {formatCell(normalizeCell(head.cell) ?? head.cell)} already has a login. Enter its PIN to log in; your information
          fills in from it.
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
        {step(1, "Log in", "Open your email and find our 6-digit code (check spam too). Type it here, then choose a new PIN twice.")}
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          We emailed a 6-digit code to <strong>{maskedEmail}</strong>. Enter it and choose a new 4-digit PIN. Not in your inbox? Check your Spam folder.
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
        {step(
          3,
          "Confirm email",
          "Open your email and find our 6-digit code (check spam too). Type it below and tap Register. Fees? Stripe's secure card page opens next.",
        )}
        <p className="text-sm">
          We emailed a 6-digit code to <strong>{maskedEmail}</strong> (not in your inbox? check your Spam folder). Enter it to finish registering {orgFullName}&apos;s{" "}
          {teams.length === 1 ? "team" : `${teams.length} teams`} in {program?.name}. When the League takes card payments,
          you&apos;ll pay next on Stripe&apos;s secure page, and {teams.length === 1 ? "the team is" : "the teams are"} registered once it&apos;s paid.
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
          {busy ? "Checking…" : teams.length === 1 ? "Register team" : "Register teams"}
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
      {step(
        2,
        "Your teams",
        "Fill in your organization, then you, then each team. More teams? Tap + Add another team at the bottom. Then tap Email me a code.",
      )}
      <section className="space-y-4">
        <h2 className="font-semibold">Program</h2>
        {fixed ? (
          // Picked on the page (or the only one open): shown, not asked.
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
        <h2 className="font-semibold">Your organization</h2>
        <Field label="Organization name (like Hixson Hoops)">
          <input className={inputCls} maxLength={60} autoComplete="organization" value={orgFullName} onChange={(e) => setOrgFullName(e.target.value)} />
        </Field>
        {orgFullName.trim().length > 20 && (
          <Field label="Short name (up to 20 letters)">
            <input className={inputCls} maxLength={20} value={orgShortName} onChange={(e) => setOrgShortName(e.target.value)} />
          </Field>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-semibold">You</h2>
        {person(head, setHead, "Email", existing)}
        {existing ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Logged in with this cell&apos;s PIN. Check the email.</p>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Choose a 4-digit PIN for your login.</p>
            <div className="grid grid-cols-2 gap-3">
              {pinInput(pin1, setPin1, "PIN")}
              {pinInput(pin2, setPin2, "PIN again")}
            </div>
          </>
        )}
        <p className="text-xs text-zinc-500">You&apos;ll be your organization&apos;s Owner.</p>
      </section>

      {teams.map((t, i) => (
        <section key={t.key} className="space-y-4 rounded-2xl p-4 ring-1 ring-zinc-950/10 dark:ring-white/10">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{teams.length > 1 ? `Team ${i + 1}` : "Team"}</h2>
            {teams.length > 1 && (
              <button type="button" className="text-sm text-zinc-500 hover:underline" onClick={() => setTeams(teams.filter((x) => x.key !== t.key))}>
                Remove
              </button>
            )}
          </div>
          <div>
            <span className={fieldLabel}>Gender</span>
            <div className="flex gap-2">
              {["Boys", "Girls"].map((g) => (
                <button key={g} type="button" className={pillCls(t.gender === g)} onClick={() => setTeam(t.key, { gender: g })}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className={fieldLabel}>Grade (one, or two next to each other)</span>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
              {GRADE_PILLS.filter((g) => g.value !== "PK" || grades.some((x) => x.value === "PK")).map((g) => (
                <button
                  key={g.value}
                  type="button"
                  className={pillCls(gradeOn(t.grade, g.value))}
                  onClick={() => {
                    const grade = pickGrade(t.grade, g.value);
                    // Pre-K teams are Coed.
                    setTeam(t.key, { grade, gender: grade === "PK" ? "Coed" : t.gender === "Coed" ? "" : t.gender });
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <span className={fieldLabel}>Head Coach</span>
            <div className="flex gap-2">
              <button type="button" className={pillCls(t.me)} onClick={() => setTeam(t.key, { me: true })}>
                Me
              </button>
              <button type="button" className={pillCls(!t.me)} onClick={() => setTeam(t.key, { me: false })}>
                Someone else
              </button>
            </div>
            {!t.me && person(t.head, (p) => setTeam(t.key, { head: p }), "Email")}
          </div>
          <Field label="Alternate name (optional; in the team's name instead of the organization's)">
            <input
              className={inputCls}
              maxLength={60}
              autoComplete="off"
              placeholder="e.g. Bolts"
              value={t.alt}
              onChange={(e) => setTeam(t.key, { alt: e.target.value })}
            />
          </Field>
          <div className="rounded-xl bg-zinc-50 px-3 py-2.5 dark:bg-white/5">
            <p className="text-xs text-zinc-500">Team name</p>
            <p className="font-semibold">{defaultName(t) || "Pick the grade first"}</p>
          </div>
          <div className="space-y-3">
            <span className={fieldLabel}>
              Other staff <span className="font-normal text-zinc-500">(optional)</span>
            </span>
            {ROLES.map((r) =>
              t.open[r.key] ? (
                <div key={r.key} className="space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{r.label}</span>
                    <button
                      type="button"
                      className="text-sm text-zinc-500 hover:underline"
                      onClick={() => setTeam(t.key, { open: { ...t.open, [r.key]: false } })}
                    >
                      Remove
                    </button>
                  </div>
                  {person(t.staff[r.key] ?? blank, (p) => setTeam(t.key, { staff: { ...t.staff, [r.key]: p } }), "Email (optional)")}
                </div>
              ) : (
                <button
                  key={r.key}
                  type="button"
                  className="mr-2 mb-2 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-zinc-950/10 dark:ring-white/15"
                  onClick={() => setTeam(t.key, { open: { ...t.open, [r.key]: true } })}
                >
                  + {r.label}
                </button>
              ),
            )}
          </div>
          {program?.league && (
            // A League: what this team registers for (ALL Season or Game Days), with its fee.
            <div className="space-y-3">
              <span className={fieldLabel}>Register for</span>
              <RegisterChoices
                options={program.league.options}
                gameDates={program.league.gameDates}
                today={today}
                entry={null}
                onChange={(c) => setTeam(t.key, { choice: c })}
              />
            </div>
          )}
        </section>
      ))}
      {teams.length < 20 && (
        <button
          type="button"
          className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-thunder-blue border border-dashed border-thunder-blue/50 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-white/5"
          onClick={() => setTeams([...teams, newTeam(Math.max(...teams.map((x) => x.key)) + 1)])}
        >
          + Add another team
        </button>
      )}

      {error && <Alert tone="red">{error}</Alert>}
      <button className={primaryBtn} disabled={busy || !program}>
        {busy ? "Sending…" : "Email me a code"}
      </button>
      <button type="button" className="w-full text-sm text-zinc-500 hover:underline" onClick={() => setScreen("cell")}>
        ← Change cell
      </button>
    </form>
  );
}
