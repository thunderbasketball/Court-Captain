"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AddedPlayerInput } from "@/lib/added-players";
import { SIZES } from "@/lib/uniform-fields";
import { Alert, PopUp, Toast, useConfirm } from "../../../client-ui";
import { fieldLabel, inputCls, primaryBtn } from "../../../ui";
import { addPlayerAction, removeAddedPlayerAction } from "./actions";

const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const gradeName = (g: string) => (g === "K" ? "Kindergarten" : `${g}${["", "st", "nd", "rd"][Number(g)] ?? "th"}`);

// Owners, Admins and Directors of Players: + Add player, a side registration next to TeamSnap's (fees can be waived).
// The server checks everything again.
export function AddPlayerButton() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="shrink-0">
      <PopUp
        label="+ Add player"
        title="Add a player"
        note="For a player who didn't register in TeamSnap. They're listed with everyone else, marked Added in app; the sheet never removes them."
      >
        {(close) => (
          <AddPlayerForm
            onDone={(name) => {
              close();
              setMsg(`${name} added.`);
              router.refresh();
            }}
          />
        )}
      </PopUp>
      {msg && <Toast key={msg} message={msg} />}
    </div>
  );
}

function AddPlayerForm({ onDone }: { onDone: (name: string) => void }) {
  const [v, setV] = useState({
    first: "",
    last: "",
    gender: "",
    grade: "",
    birthdate: "",
    parentFirst: "",
    parentLast: "",
    parentCell: "",
    parentEmail: "",
    uniformSize: "",
    fee: "",
    notes: "",
  });
  const [waive, setWaive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const field = (k: keyof typeof v, label: string, props: Record<string, unknown> = {}) => (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      <input className={inputCls} value={v[k]} onChange={set(k)} {...props} />
    </label>
  );
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const input: AddedPlayerInput = { ...v, waive };
          const r = await addPlayerAction(input);
          if (!r.ok) return setError(r.message);
          onDone(`${v.first.trim()} ${v.last.trim()}`);
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        {field("first", "Player first name", { required: true, autoComplete: "off" })}
        {field("last", "Player last name", { required: true, autoComplete: "off" })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabel}>Gender</span>
          <select className={inputCls} value={v.gender} onChange={set("gender")} required>
            <option value="">Pick…</option>
            <option>Boys</option>
            <option>Girls</option>
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Grade</span>
          <select className={inputCls} value={v.grade} onChange={set("grade")} required>
            <option value="">Pick…</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {gradeName(g)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {field("birthdate", "Birthdate (optional)", { type: "date" })}
      <div className="grid grid-cols-2 gap-3">
        {field("parentFirst", "Parent first name", { required: true })}
        {field("parentLast", "Parent last name", { required: true })}
      </div>
      {field("parentCell", "Parent cell", { required: true, inputMode: "tel", placeholder: "(423) 555-0123" })}
      {field("parentEmail", "Parent email (optional)", { type: "email" })}
      <label className="block">
        <span className={fieldLabel}>Uniform size (if they need one)</span>
        <select className={inputCls} value={v.uniformSize} onChange={set("uniformSize")}>
          <option value="">No uniform</option>
          {SIZES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} className="size-5" />
        Waive fees
      </label>
      {!waive && field("fee", "Fee owed (dollars, optional)", { inputMode: "decimal", placeholder: "150" })}
      {field("notes", "Notes (optional)", { maxLength: 300, placeholder: "e.g. Scholarship" })}
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Adding…" : "Add player"}
      </button>
    </form>
  );
}

// Remove a player added in the app (asks first). Not while they're on a team.
export function RemoveAddedPlayer({ registrantId, name }: { registrantId: string; name: string }) {
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
              message: `Are you sure? ${name} was added in the app and will be removed from the player list.`,
              confirmLabel: "Remove",
            }))
          )
            return;
          start(async () => {
            const r = await removeAddedPlayerAction(registrantId);
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
