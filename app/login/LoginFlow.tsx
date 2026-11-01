"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import * as act from "./actions";
import type { ClientStep } from "./actions";
import { pillCls } from "../ui";

type Screen = Exclude<ClientStep, { step: "error" } | { step: "loggedIn" }> | { step: "phone" } | { step: "verifyEmail" };

const input =
  "w-full rounded-xl border-0 bg-white px-4 py-3 text-lg shadow-sm ring-1 ring-inset ring-zinc-950/10 outline-none focus:ring-2 focus:ring-thunder-blue dark:bg-zinc-900 dark:ring-white/15";
const primary =
  "w-full rounded-xl bg-thunder-blue px-4 py-3 text-lg font-semibold text-white shadow-sm hover:bg-thunder-blue-dark disabled:opacity-50";
const link = "text-blue-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-blue-400";

// `join`: on an organization's join link, Create Account signs the person in to finish joining there.
// `next`: where to go once logged in (default: home).
export default function LoginFlow({ join, next = "/" }: { join?: string; next?: string } = {}) {
  const [screen, setScreen] = useState<Screen>({ step: "phone" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // Typed values, kept so "Send a new code" can resend without retyping.
  const [cell, setCell] = useState("");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  // Why they're joining Thunder (not on another organization's join link).
  const [purpose, setPurpose] = useState<"" | "family" | "staff" | "other">("");
  const [staffRole, setStaffRole] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teamText, setTeamText] = useState("");
  const [notes, setNotes] = useState("");
  const [teams, setTeams] = useState<{ id: string; name: string }[] | null>(null);
  const signup = () =>
    act.startSignup({
      cell,
      firstName: first,
      lastName: last,
      email,
      pin1,
      pin2,
      join,
      purpose: purpose || undefined,
      staffRole: staffRole || undefined,
      teamId: teamId && teamId !== "other" ? teamId : undefined,
      teamText: teamId === "other" ? teamText : undefined,
      notes: purpose === "other" ? notes : undefined,
    });
  const pinRef = useRef<HTMLInputElement>(null);

  function go(call: () => Promise<ClientStep>, opts: { resent?: boolean } = {}) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const s = await call();
      if (s.step === "loggedIn") {
        window.location.replace(next);
        return;
      }
      if (s.step === "error") {
        setError(s.message);
        if (screen.step === "pin") {
          setPin("");
          pinRef.current?.focus();
        }
        return;
      }
      if (s.step !== screen.step) setCode("");
      // Fresh PIN boxes on screens that ask for a new PIN. (Signup keeps them for "Send a new code".)
      if ((s.step === "starterCode" || s.step === "resetCode") && s.step !== screen.step) {
        setPin1("");
        setPin2("");
      }
      if (s.step === "pin") setPin("");
      if (opts.resent) setNotice("A new code is on its way.");
      setScreen(s);
    });
  }

  function restart() {
    setScreen({ step: "phone" });
    setError(null);
    setNotice(null);
    setPin("");
    setCode("");
    setPin1("");
    setPin2("");
  }

  const codeField = (
    <Field label="6-digit code">
      <input
        className={`${input} tracking-[0.3em]`}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        autoFocus
      />
    </Field>
  );
  const newPinFields = (
    <>
      <Field label="New 4-digit PIN">
        <PinInput value={pin1} onChange={setPin1} autoComplete="new-password" />
      </Field>
      <Field label="Type it again">
        <PinInput value={pin2} onChange={setPin2} autoComplete="new-password" />
      </Field>
    </>
  );
  const resend = (call: () => Promise<ClientStep>) => (
    <button type="button" className={link} disabled={busy} onClick={() => go(call, { resent: true })}>
      Send a new code
    </button>
  );

  let body: ReactNode;
  switch (screen.step) {
    case "phone":
      body = (
        <Form title="Log in" onSubmit={() => go(() => act.lookupPhone(cell))}>
          <Field label="Cell phone number">
            <input
              className={input}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="(423) 555-1234"
              value={cell}
              onChange={(e) => {
                const v = e.target.value;
                setCell(v);
                // Goes on by itself at the 10th digit. Area codes never start with 1, so a leading 1 (+1) waits for one more.
                const digits = v.replace(/\D/g, "");
                if (digits.length === (digits.startsWith("1") ? 11 : 10) && !busy) go(() => act.lookupPhone(v));
              }}
              autoFocus
            />
          </Field>
          {busy && <p className="text-center text-sm text-zinc-500">Checking…</p>}
        </Form>
      );
      break;

    case "pin":
      body = (
        <Form title="Enter your PIN" onSubmit={() => go(() => act.submitPin(cell, pin))}>
          <Field label="4-digit PIN">
            <PinInput
              ref={pinRef}
              value={pin}
              autoFocus
              autoComplete="current-password"
              onChange={(v) => {
                setPin(v);
                if (v.length === 4 && !busy) go(() => act.submitPin(cell, v));
              }}
            />
          </Field>
          <Submit busy={busy}>Log in</Submit>
          <button type="button" className={link} disabled={busy} onClick={() => go(() => act.startForgot(cell))}>
            Forgot PIN?
          </button>
        </Form>
      );
      break;

    case "create":
      body = (
        <Form
          title="Create account"
          intro="We don't have that number yet. Fill this in and we'll email you a code."
          onSubmit={() => go(signup)}
        >
          <Field label="First name">
            <input
              className={input}
              autoComplete="given-name"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Last name">
            <input className={input} autoComplete="family-name" value={last} onChange={(e) => setLast(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className={input} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Choose a 4-digit PIN">
            <PinInput value={pin1} onChange={setPin1} autoComplete="new-password" />
          </Field>
          <Field label="Type it again">
            <PinInput value={pin2} onChange={setPin2} autoComplete="new-password" />
          </Field>
          {!join && (
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium">What brings you to Thunder?</legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["family", "New family"],
                    ["staff", "New team staff"],
                    ["other", "Other"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={pillCls(purpose === k)}
                    onClick={async () => {
                      setPurpose(k);
                      if (k === "staff" && !teams) setTeams(await act.signupTeams());
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {purpose === "family" && (
                <p className="text-sm text-zinc-500">
                  Your account is ready right away. We find your players from registration by your cell number.
                </p>
              )}
              {purpose === "staff" && (
                <>
                  <Field label="Your role">
                    <select className={input} value={staffRole} onChange={(e) => setStaffRole(e.target.value)}>
                      <option value="" disabled>
                        Choose…
                      </option>
                      <option value="HeadCoach">Head Coach</option>
                      <option value="AsstCoach">Asst Coach</option>
                      <option value="Manager">Team Manager</option>
                      <option value="TeamParent">Team Parent</option>
                    </select>
                  </Field>
                  <Field label="Which team?">
                    <select className={input} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                      <option value="" disabled>
                        {teams ? "Choose…" : "Loading teams…"}
                      </option>
                      {(teams ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                      <option value="other">Other (not listed)</option>
                    </select>
                  </Field>
                  {teamId === "other" && (
                    <Field label="Team or coach name">
                      <input className={input} value={teamText} maxLength={60} onChange={(e) => setTeamText(e.target.value)} />
                    </Field>
                  )}
                  <p className="text-sm text-zinc-500">An Admin approves team staff before you can log in.</p>
                </>
              )}
              {purpose === "other" && (
                <Field label="Tell us why you're joining">
                  <textarea className={input} rows={3} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              )}
            </fieldset>
          )}
          <Submit busy={busy}>Email me a code</Submit>
        </Form>
      );
      break;

    case "signupCode":
      body = (
        <Form
          title="Check your email"
          intro={`We sent a code to ${screen.maskedEmail}.`}
          onSubmit={() => go(() => act.completeSignup(cell, code))}
        >
          {codeField}
          <Submit busy={busy}>Create account</Submit>
          {resend(signup)}
        </Form>
      );
      break;

    case "starterEmail":
      body = (
        <Form
          title="Add your email"
          intro="To set your PIN, we'll email you a code. Where should we send it?"
          onSubmit={() => go(() => act.sendStarterCode(cell, email))}
        >
          <Field label="Email">
            <input
              className={input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </Field>
          <Submit busy={busy}>Email me a code</Submit>
        </Form>
      );
      break;

    case "starterCode":
      body = (
        <Form
          title="Set your PIN"
          intro={`We sent a code to ${screen.maskedEmail}. Enter it and choose your PIN.`}
          onSubmit={() => go(() => act.completeStarter(cell, code, pin1, pin2))}
        >
          {codeField}
          {newPinFields}
          <Submit busy={busy}>Set PIN</Submit>
          {resend(() => act.sendStarterCode(cell, email || null))}
        </Form>
      );
      break;

    case "verifyChoice":
      body = (
        <Panel title="Verify your email" intro="Before you log in, we need to confirm your email address.">
          {screen.maskedEmail && (
            <button className={primary} disabled={busy} onClick={() => go(() => act.sendVerifyCode(cell, pin, null))}>
              Email a code to {screen.maskedEmail}
            </button>
          )}
          <button
            type="button"
            className={screen.maskedEmail ? link : primary}
            disabled={busy}
            onClick={() => setScreen({ step: "verifyEmail" })}
          >
            {screen.maskedEmail ? "Use a different email" : "Add your email"}
          </button>
        </Panel>
      );
      break;

    case "verifyEmail":
      body = (
        <Form title="Your email" onSubmit={() => go(() => act.sendVerifyCode(cell, pin, email))}>
          <Field label="Email">
            <input
              className={input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </Field>
          <Submit busy={busy}>Email me a code</Submit>
        </Form>
      );
      break;

    case "verifyCode":
      body = (
        <Form
          title="Check your email"
          intro={`We sent a code to ${screen.maskedEmail}.`}
          onSubmit={() => go(() => act.completeVerify(cell, pin, code))}
        >
          {codeField}
          <Submit busy={busy}>Verify and log in</Submit>
          {resend(() => act.sendVerifyCode(cell, pin, email || null))}
        </Form>
      );
      break;

    case "resetCode":
      body = (
        <Form
          title="Reset your PIN"
          intro={`We sent a code to ${screen.maskedEmail}. Enter it and choose a new PIN.`}
          onSubmit={() => go(() => act.completeReset(cell, code, pin1, pin2))}
        >
          {codeField}
          {newPinFields}
          <Submit busy={busy}>Save PIN</Submit>
          {resend(() => act.startForgot(cell))}
        </Form>
      );
      break;

    case "devCode":
      body = (
        <Form title="Enter code" intro="Testing mode: the code is 123456." onSubmit={() => go(() => act.devLogin(cell, code))}>
          {codeField}
          <Submit busy={busy}>Log in</Submit>
        </Form>
      );
      break;

    case "done":
      body = <Panel title="CourtCaptain" intro={screen.message} />;
      break;
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-500/10 dark:text-red-300"
        >
          {error}
        </p>
      )}
      {notice && !error && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300"
        >
          {notice}
        </p>
      )}
      {body}
      {screen.step !== "phone" && (
        <button type="button" className={`${link} block`} onClick={restart}>
          ← Use a different number
        </button>
      )}
    </div>
  );
}

function Form(props: { title: string; intro?: string; onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit();
      }}
    >
      <Heading title={props.title} intro={props.intro} />
      {props.children}
    </form>
  );
}

function Panel(props: { title: string; intro?: string; children?: ReactNode }) {
  return (
    <div className="space-y-4">
      <Heading title={props.title} intro={props.intro} />
      {props.children}
    </div>
  );
}

function Heading({ title, intro }: { title: string; intro?: string }) {
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      {intro && <p className="mt-1 text-zinc-600 dark:text-zinc-400">{intro}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      {children}
    </label>
  );
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" className={primary} disabled={busy}>
      {busy ? "One moment…" : children}
    </button>
  );
}

function PinInput({
  ref,
  value,
  onChange,
  autoComplete,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  ref?: React.Ref<HTMLInputElement>;
}) {
  return (
    <input
      ref={ref}
      className={`${input} tracking-[0.5em]`}
      type="password"
      inputMode="numeric"
      maxLength={4}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
    />
  );
}
