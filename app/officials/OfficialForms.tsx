"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addOfficialAction, removeOfficialAction } from "./actions";

const input = "min-w-0 rounded-lg bg-white px-3 py-2 text-base ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15";

// The + on the Officials card opens this at the top of the card: first, last and cell. Someone with that cell is added
// as is; anyone else gets a login (they finish it at first sign-in).
export function AddOfficialForm({ org }: { org: string }) {
  const router = useRouter();
  const [f, setF] = useState({ first: "", last: "", cell: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addOfficialAction(org, f);
          setMsg(
            r.ok
              ? { ok: true, text: `${r.name} added${r.newLogin ? " (a new login: they sign in with their cell)" : ""}.` }
              : { ok: false, text: r.message },
          );
          if (r.ok) {
            setF({ first: "", last: "", cell: "" });
            router.refresh();
          }
        });
      }}
    >
      <p className="text-sm font-semibold">Add an official</p>
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="First name" aria-label="First name" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} />
        <input className={input} placeholder="Last name" aria-label="Last name" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} />
        <input
          className={`${input} col-span-2`}
          placeholder="Cell"
          aria-label="Cell"
          inputMode="tel"
          value={f.cell}
          onChange={(e) => setF({ ...f, cell: e.target.value })}
        />
      </div>
      <button
        type="submit"
        disabled={busy || !f.first.trim() || !f.last.trim() || !f.cell.trim()}
        className="rounded-full bg-thunder-blue px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add official"}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
    </form>
  );
}

// Remove, asking right here first.
export function RemoveOfficial({ org, coachId, name }: { org: string; coachId: string; name: string }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!sure)
    return (
      <button type="button" onClick={() => setSure(true)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
        Remove
      </button>
    );
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span>Remove {name} from your officials?</span>
      <button type="button" onClick={() => setSure(false)} className="rounded-full px-2.5 py-1 ring-1 ring-zinc-950/10 dark:ring-white/15">
        Keep
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await removeOfficialAction(org, coachId);
            if (r.ok) router.refresh();
            else setMsg(r.message);
          })
        }
        className="rounded-full bg-red-600 px-2.5 py-1 font-semibold text-white disabled:opacity-50"
      >
        Remove
      </button>
      {msg && <span className="text-red-600 dark:text-red-400">{msg}</span>}
    </span>
  );
}
