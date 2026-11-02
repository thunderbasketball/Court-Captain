"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addOrgGym, removeOrgGym } from "../../thunder/facilities/actions";
import { Alert, PopUp, Toast, useConfirm } from "../../../client-ui";
import { fieldLabel, inputCls, primaryBtn } from "../../../ui";
import ImportGymsButton from "../../../ImportGyms";

type Gym = { id: string; name: string; short: string | null; courts: string[] };

// A registered organization's gyms: the list, + Add at the top right (a pop-up: name, short name, courts by name), and
// Remove on each (asks first).
export default function OrgGyms({ org, gyms }: { org: string; gyms: Gym[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Gyms</h2>
          <p className="text-sm text-zinc-500">
            The gyms where you can host games. The short name shows where space is tight, like on a phone schedule.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <ImportGymsButton org={org} />
          <PopUp
            label="+ Add"
            title="Add gym"
            className="shrink-0 rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thunder-blue-dark"
          >
            {(close) => (
              <AddGymForm
                org={org}
                onAdded={(name) => {
                  close();
                  setMsg(`${name} added.`);
                  router.refresh();
                }}
              />
            )}
          </PopUp>
        </div>
      </div>
      <ul className="space-y-2">
        {gyms.map((g) => (
          <li
            key={g.id}
            className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/50"
          >
            <span>
              <span className="font-medium">{g.name}</span>
              {g.short && <span className="text-zinc-500"> ({g.short})</span>}
              <span className="block text-xs text-zinc-500">{g.courts.join(", ")}</span>
            </span>
            <button
              type="button"
              disabled={busy}
              className="text-xs font-medium text-red-600 hover:underline"
              onClick={async () => {
                if (
                  !(await confirm({
                    title: `Remove ${g.name}?`,
                    message: "Are you sure? Its courts and availability go with it.",
                    confirmLabel: "Remove",
                  }))
                )
                  return;
                start(async () => {
                  const r = await removeOrgGym(org, g.id);
                  setMsg(r.ok ? `${g.name} removed.` : r.message);
                  if (r.ok) router.refresh();
                });
              }}
            >
              Remove
            </button>
          </li>
        ))}
        {!gyms.length && <li className="text-sm text-zinc-500">No gyms yet. Tap + Add.</li>}
      </ul>
      {msg && <Toast key={msg} message={msg} />}
      {confirmDialog}
    </div>
  );
}

const courtName = (i: number) => (i === 0 ? "Main" : i === 1 ? "Aux" : `Court ${i + 1}`);

// The pop-up's form. Courts start as Main, Aux, Court 3…; changing the number keeps the names typed so far.
function AddGymForm({ org, onAdded }: { org: string; onAdded: (name: string) => void }) {
  const [name, setName] = useState("");
  const [short, setShort] = useState("");
  const [courts, setCourts] = useState(["Main"]);
  const setCount = (n: number) =>
    setCourts((c) => Array.from({ length: Math.min(12, Math.max(1, n || 1)) }, (_, i) => c[i] ?? courtName(i)));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await addOrgGym(org, { name, short, courts: courts.map((c) => c.trim()) });
          if (!r.ok) return setError(r.message);
          onAdded(name);
        });
      }}
    >
      {/* Laid out like Thunder's Add gym: name and how many courts, then the courts' names. */}
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <label className="block">
          <span className={fieldLabel}>Gym name</span>
          <input
            className={inputCls}
            placeholder="e.g. East Ridge Community Center"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>Courts</span>
          <select className={inputCls} value={courts.length} onChange={(e) => setCount(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={fieldLabel}>Short name</span>
        <input
          className={inputCls}
          placeholder="e.g. ERCC (up to 8 letters or numbers)"
          maxLength={8}
          value={short}
          onChange={(e) => setShort(e.target.value)}
          required
        />
      </label>
      <div className="space-y-2">
        <span className={fieldLabel}>Court names</span>
        {courts.map((c, i) => (
          <input
            key={i}
            className={inputCls}
            maxLength={60}
            value={c}
            aria-label={`Court ${i + 1} name`}
            onChange={(e) => setCourts((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
            required
          />
        ))}
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Adding…" : "Add gym"}
      </button>
    </form>
  );
}
