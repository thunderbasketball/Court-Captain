"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, PopUp, Toast, useConfirm } from "./client-ui";
import { fieldLabel, inputCls, pillCls, primaryBtn } from "./ui";
import * as thunder from "./org/thunder/teams/actions";
import * as orgs from "./org/[slug]/teams/actions";
import { setScenicCoachEmail } from "./org/scenic-city/actions";
import { saveStaffInfo } from "./head-coach-actions";

const smallBtn =
  "shrink-0 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold whitespace-nowrap text-white shadow-sm hover:bg-red-700";

// Thunder and every organization: the same pop-ups, each calling its own server actions (checked again there).
const actions = (org: string, teamId: string) =>
  org === "thunder"
    ? {
        makeHead: (p: { first: string; last: string; cell: string; email: string }) =>
          thunder.addStaff(teamId, { role: "HeadCoach", person: { ...p, email: p.email || null } }),
        saveWaiting: (p: { first: string; last: string } | null) => thunder.saveWaitingCoach(teamId, p),
        saveEmail: (email: string) => thunder.saveHeadCoachEmail(teamId, email),
      }
    : {
        makeHead: (p: { first: string; last: string; cell: string; email: string }) =>
          orgs.addCoach(org, teamId, { ...p, role: "HeadCoach" }),
        saveWaiting: (p: { first: string; last: string } | null) => orgs.saveWaitingCoach(org, teamId, p),
        saveEmail: (email: string) => orgs.saveHeadCoachEmail(org, teamId, email),
      };

// A Head Coach named without a cell yet (Directors of Teams): add their cell (and email), which makes their login and
// the Head Coach; or fix the name; or remove them (the team is TBD again).
export function WaitingCoachButton({
  org,
  teamId,
  first: initialFirst,
  last: initialLast,
}: {
  org: string;
  teamId: string;
  first: string;
  last: string;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [first, setFirst] = useState(initialFirst);
  const [last, setLast] = useState(initialLast);
  const [cell, setCell] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const act = actions(org, teamId);
  return (
    <>
      <PopUp label="Add cell" title={`Head Coach ${initialFirst} ${initialLast}`} className={smallBtn}>
        {(close) => (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                setError(null);
                // With a cell: they become the Head Coach. Without: just the name is saved.
                const r = cell.trim() ? await act.makeHead({ first, last, cell, email }) : await act.saveWaiting({ first, last });
                if (!r.ok) return setError(r.message);
                close();
                setMsg(
                  cell.trim()
                    ? "newLogin" in r && r.newLogin
                      ? `${first} ${last} is the Head Coach. Their login is their cell; starter PIN 1234.`
                      : `${first} ${last} is the Head Coach.`
                    : "Saved.",
                );
                router.refresh();
              });
            }}
          >
            <p className="text-sm text-zinc-500">
              Their cell makes their login and the Head Coach. Without it, the team shows COACH CELL MUST BE ENTERED.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={fieldLabel}>First name</span>
                <input className={inputCls} value={first} onChange={(e) => setFirst(e.target.value)} required />
              </label>
              <label className="block">
                <span className={fieldLabel}>Last name</span>
                <input className={inputCls} value={last} onChange={(e) => setLast(e.target.value)} required />
              </label>
            </div>
            <label className="block">
              <span className={fieldLabel}>Cell</span>
              <input
                className={inputCls}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="(423) 555-0123"
                value={cell}
                onChange={(e) => setCell(e.target.value)}
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>Email (optional)</span>
              <input
                className={inputCls}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {error && <Alert tone="red">{error}</Alert>}
            <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
              {busy ? "Saving…" : cell.trim() ? "Make Head Coach" : "Save name"}
            </button>
            <button
              type="button"
              disabled={busy}
              className="w-full text-sm font-medium text-red-600 hover:underline dark:text-red-400"
              onClick={async () => {
                if (
                  !(await confirm({
                    title: `Remove ${initialFirst} ${initialLast}?`,
                    message: "The team will be TBD again.",
                    confirmLabel: "Remove",
                  }))
                )
                  return;
                start(async () => {
                  const r = await act.saveWaiting(null);
                  if (!r.ok) return setError(r.message);
                  close();
                  router.refresh();
                });
              }}
            >
              Remove this coach
            </button>
          </form>
        )}
      </PopUp>
      {dialog}
      {msg && <Toast key={msg} message={msg} />}
    </>
  );
}

// The Head Coach has no email yet (Directors of Teams): add it. They confirm it with a code at their next login.
export function HeadCoachEmailButton({ org, teamId, name }: { org: string; teamId: string; name: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <PopUp label="Add email" title={`${name}'s email`} className={smallBtn}>
      {(close) => (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              // Scenic City's own teams (outside clubs): edited by whoever can edit the team.
              const r =
                org === "scenic-city" ? await setScenicCoachEmail(teamId, email) : await actions(org, teamId).saveEmail(email);
              if (!r.ok) return setError(r.message);
              close();
              router.refresh();
            });
          }}
        >
          <p className="text-sm text-zinc-500">They confirm it with a code the next time they log in.</p>
          <label className="block">
            <span className={fieldLabel}>Email</span>
            <input
              className={inputCls}
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          {error && <Alert tone="red">{error}</Alert>}
          <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
            {busy ? "Saving…" : "Save email"}
          </button>
        </form>
      )}
    </PopUp>
  );
}

// Owners and Admins: Edit opens a staff member's name, cell and email right in their row (Save / Cancel). A different
// cell puts that person in this spot (found by cell, or their login made).
const STAFF_ROLES = [
  { role: "HeadCoach", label: "Head Coach" },
  { role: "AsstCoach", label: "Assistant Coach" },
  { role: "Manager", label: "Team Manager" },
  { role: "TeamParent", label: "Team Parent" },
];

export function StaffEdit({
  org,
  teamId,
  coachId,
  role,
  first: initialFirst,
  last: initialLast,
  cell: initialCell,
  email: initialEmail,
}: {
  org: string;
  teamId: string;
  coachId: string;
  role: string;
  first: string;
  last: string;
  cell: string | null;
  email: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState(initialFirst);
  const [last, setLast] = useState(initialLast);
  const [cell, setCell] = useState(initialCell ?? "");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [newRole, setNewRole] = useState(role);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const sameCell = cell.replace(/\D/g, "").slice(-10) === (initialCell ?? "");
  if (!open)
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setFirst(initialFirst);
            setLast(initialLast);
            setCell(initialCell ?? "");
            setEmail(initialEmail ?? "");
            setNewRole(role);
            setError(null);
            setSaved(null);
            setOpen(true);
          }}
          className="text-xs font-semibold text-thunder-blue hover:underline"
        >
          Edit
        </button>
        {saved && <span className="text-xs font-semibold text-green-700 dark:text-green-400">{saved}</span>}
      </div>
    );
  return (
    <form
      className="space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-white/5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await saveStaffInfo(org, teamId, { coachId, role, first, last, cell, email, newRole });
          if (!r.ok) return setError(r.message);
          setOpen(false);
          setSaved(r.newLogin ? `Saved ✓ ${first} ${last}'s login is their cell; starter PIN 1234.` : "Saved ✓");
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={fieldLabel}>First name</span>
          <input className={inputCls} value={first} onChange={(e) => setFirst(e.target.value)} required />
        </label>
        <label className="block">
          <span className={fieldLabel}>Last name</span>
          <input className={inputCls} value={last} onChange={(e) => setLast(e.target.value)} required />
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel}>Cell</span>
        <input
          className={inputCls}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="(423) 555-0123"
          value={cell}
          onChange={(e) => setCell(e.target.value)}
          required
        />
      </label>
      <label className="block">
        <span className={fieldLabel}>Email</span>
        <input
          className={inputCls}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <div>
        <span className={fieldLabel}>Role</span>
        <div className="flex flex-wrap gap-1.5">
          {STAFF_ROLES.map((r) => (
            <button key={r.role} type="button" className={pillCls(newRole === r.role)} onClick={() => setNewRole(r.role)}>
              {r.label}
            </button>
          ))}
        </div>
        {role === "HeadCoach" && newRole !== "HeadCoach" && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">The team is TBD until a new Head Coach is set.</p>
        )}
        {role !== "HeadCoach" && newRole === "HeadCoach" && (
          <p className="mt-1 text-xs text-zinc-500">Only while the team has no Head Coach: change the current one&apos;s role first. The team is renamed for them.</p>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        {sameCell
          ? "A new email is confirmed with a code at their next login."
          : "A different cell is a different person: the one with this cell takes this spot (their login is made if they don't have one; starter PIN 1234)."}
      </p>
      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={`${primaryBtn} flex-1`}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
          className="rounded-lg px-4 text-sm font-medium ring-1 ring-zinc-300 dark:ring-white/15"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
