"use client";

import { AddPersonIcon, addIconBtn } from "../../../CardIcons";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, PopUp, Toast, useConfirm } from "../../../client-ui";
import { fieldLabel, inputCls, pillCls, primaryBtn } from "../../../ui";
import { addCoach, removeCoach, removeTeam, setAltName } from "./actions";


// Delete a team (asks first). Its coaches come off it.
export function DeleteTeamButton({ org, id, name }: { org: string; id: string; name: string }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className="shrink-0 rounded-full px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-600/30 hover:bg-red-50 dark:hover:bg-red-500/10"
        onClick={async () => {
          if (
            !(await confirm({
              title: `Delete ${name}?`,
              message: "Are you sure? Its coaches come off the team.",
              confirmLabel: "Delete",
            }))
          )
            return;
          start(async () => {
            const r = await removeTeam(org, id);
            if (!r.ok) return setMsg(r.message);
            router.push(`/org/${org}?open=teams#teams`);
          });
        }}
      >
        Delete team
      </button>
      {msg && <Toast key={msg} message={msg} />}
      {dialog}
    </>
  );
}

// + Add on a team's Coaches: a pop-up for name, cell and Head or Assistant Coach.
export function AddCoachButton({ org, teamId, hasHead }: { org: string; teamId: string; hasHead: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <PopUp label={<AddPersonIcon />} ariaLabel="Add a coach" title="Add a coach" className={addIconBtn}>
        {(close) => (
          <CoachForm
            org={org}
            teamId={teamId}
            hasHead={hasHead}
            onAdded={(text) => {
              close();
              setMsg(text);
              router.refresh();
            }}
          />
        )}
      </PopUp>
      {msg && <Toast key={msg} message={msg} />}
    </>
  );
}

function CoachForm({
  org,
  teamId,
  hasHead,
  onAdded,
}: {
  org: string;
  teamId: string;
  hasHead: boolean;
  onAdded: (msg: string) => void;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [cell, setCell] = useState("");
  const [role, setRole] = useState(hasHead ? "AsstCoach" : "HeadCoach");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await addCoach(org, teamId, { first, last, cell, role });
          if (!r.ok) return setError(r.message);
          onAdded(r.newLogin ? `${r.name} added. Their login is their cell; starter PIN 1234.` : `${r.name} added.`);
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
          placeholder="(423) 555-0123"
          value={cell}
          onChange={(e) => setCell(e.target.value)}
          required
        />
      </label>
      <div className="flex gap-2">
        {!hasHead && (
          <button type="button" className={pillCls(role === "HeadCoach")} onClick={() => setRole("HeadCoach")}>
            Head Coach
          </button>
        )}
        <button type="button" className={pillCls(role === "AsstCoach")} onClick={() => setRole("AsstCoach")}>
          Assistant Coach
        </button>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Adding…" : "Add coach"}
      </button>
    </form>
  );
}

// Remove a coach from the team (asks first).
export function RemoveCoachButton({
  org,
  teamId,
  coachId,
  name,
}: {
  org: string;
  teamId: string;
  coachId: string;
  name: string;
}) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className="text-xs font-medium text-red-600 hover:underline"
        onClick={async () => {
          if (
            !(await confirm({
              title: `Remove ${name}?`,
              message: "Are you sure? They come off this team.",
              confirmLabel: "Remove",
            }))
          )
            return;
          start(async () => {
            const r = await removeCoach(org, teamId, coachId);
            setMsg(r.ok ? `${name} removed.` : r.message);
            if (r.ok) router.refresh();
          });
        }}
      >
        Remove
      </button>
      {msg && <Toast key={msg} message={msg} />}
      {dialog}
    </>
  );
}

// The team's Alternate name ("Bolts"): change or clear it (Admins and Directors of Teams).
export function AltNameButton({ org, id, alt }: { org: string; id: string; alt: string | null }) {
  const router = useRouter();
  return (
    <PopUp label={alt ? "Edit alternate name" : "+ Alternate name"} title="Alternate name" link>
      {(close) => <AltNameForm org={org} id={id} alt={alt} onDone={() => (close(), router.refresh())} />}
    </PopUp>
  );
}

function AltNameForm({ org, id, alt, onDone }: { org: string; id: string; alt: string | null; onDone: () => void }) {
  const [value, setValue] = useState(alt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setAltName(org, id, value);
          if (!r.ok) return setError(r.message);
          onDone();
        });
      }}
    >
      <p className="text-sm text-zinc-500">Shown after the team&apos;s name. Leave blank for none.</p>
      <input
        className={inputCls}
        maxLength={60}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Bolts"
      />
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
