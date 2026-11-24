"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ParentSlot } from "@/lib/player-parents";
import { inputCls } from "../../../ui";
import { saveParentAction } from "./actions";

// On a player's opened row: + Add parent (a place still empty), or Fix for one this person may change, each opening its
// fields right here. Kept through every sheet sync. The team's staff add what's missing; a Director changes anything.
export default function PlayerParents({ registrantId, slots, who }: { registrantId: string; slots: ParentSlot[]; who: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<1 | 2 | null>(null);
  const [f, setF] = useState({ first: "", last: "", cell: "", email: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const empty = (s: ParentSlot) => !s.first && !s.last && !s.cell && !s.email;
  const name = (s: ParentSlot) => [s.first, s.last].filter(Boolean).join(" ") || "parent";
  const add = slots.find((s) => s.canEdit && empty(s)) ?? null;
  const fixable = slots.filter((s) => s.canEdit && !empty(s));
  const run = (slot: 1 | 2, input: typeof f | null) =>
    start(async () => {
      const r = await saveParentAction(registrantId, slot, input);
      setMsg(r.ok ? null : r.message);
      if (!r.ok) return;
      setOpen(null);
      router.refresh();
    });
  const show = (s: ParentSlot) => {
    setF({ first: s.first ?? "", last: s.last ?? "", cell: s.cell ?? "", email: s.email ?? "" });
    setMsg(null);
    setOpen(s.slot);
  };
  if (!add && !fixable.length && !slots.some((s) => s.canUndo)) return null;
  const link = "font-medium text-thunder-blue hover:underline dark:text-blue-400";
  return (
    <div className="space-y-1.5 text-xs">
      {slots
        .filter((s) => s.canUndo)
        .map((s) => (
          <p key={s.slot} className="text-amber-700 dark:text-amber-400">
            {name(s)} {who ? `entered in the app by ${s.setBy}.` : "was entered in the app."}{" "}
            <button type="button" disabled={busy} onClick={() => run(s.slot, null)} className="font-medium underline">
              Undo
            </button>
          </p>
        ))}
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        {add && (
          <button type="button" className={link} onClick={() => show(add)}>
            + Add parent
          </button>
        )}
        {fixable.map((s) => (
          <button key={s.slot} type="button" className={link} onClick={() => show(s)}>
            Edit {name(s)}
          </button>
        ))}
      </p>
      {open && (
        <form
          className="space-y-2 rounded-xl bg-zinc-50 p-3 dark:bg-white/5"
          onSubmit={(e) => {
            e.preventDefault();
            run(open, f);
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder="First name" aria-label="Parent's first name" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} required />
            <input className={inputCls} placeholder="Last name" aria-label="Parent's last name" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} required />
            <input className={inputCls} type="tel" placeholder="Cell" aria-label="Parent's cell" value={f.cell} onChange={(e) => setF({ ...f, cell: e.target.value })} required />
            <input className={inputCls} type="email" placeholder="Email" aria-label="Parent's email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          <p className="text-zinc-500">They log in with this cell and verify this email to see their family and teams.</p>
          <div className="flex items-center gap-3">
            <button disabled={busy} className="rounded-full bg-thunder-blue px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Saving…" : "Save parent"}
            </button>
            <button type="button" className="text-sm text-zinc-500" onClick={() => setOpen(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {msg && <p className="text-red-600 dark:text-red-400">{msg}</p>}
    </div>
  );
}
