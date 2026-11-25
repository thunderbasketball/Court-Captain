"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAX_SHORTS, MAX_SPARES, SPARE_ITEMS, checkSpares, piecesLabel, spareCount, spareSummary, type Spare, type SpareItem } from "@/lib/spare-items";
import { SIZES } from "@/lib/uniform-fields";
import { PopUp } from "../../../client-ui";
import { addSparesToOrder, removeSpareFromOrder } from "./actions";

type Row = { number: string; size: string };
type Numbered = Exclude<SpareItem, "shorts">;
const blank: Row = { number: "", size: "" };
const cell = "rounded-lg border-0 bg-white px-2 py-1.5 text-base ring-1 ring-zinc-950/15 ring-inset dark:bg-zinc-900 dark:ring-white/15";

// Order Spares: pick what (uniform sets, jerseys, shooting shirts, shorts; one or several), how many, then each one's number
// and size (shorts: how many of each size). They're added to the next order to the vendor.
export default function OrderSpares() {
  return (
    <PopUp label="Order Spares" title="Order Spares" className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-white/5">
      {(close) => <SparesForm onDone={close} />}
    </PopUp>
  );
}

function SparesForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [on, setOn] = useState<SpareItem[]>([]);
  const [rows, setRows] = useState<Record<Numbered, Row[]>>({ set: [], jersey: [], shirt: [] });
  const [shorts, setShorts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const order = [
    ...SPARE_ITEMS.flatMap((i) => (i.key !== "shorts" && on.includes(i.key) ? rows[i.key as Numbered].map((r) => ({ item: i.key, ...r })) : [])),
    ...(on.includes("shorts") ? SIZES.flatMap((s) => (Number(shorts[s]) > 0 ? [{ item: "shorts" as const, size: s, qty: Number(shorts[s]) }] : [])) : []),
  ];
  const ready = checkSpares(order);
  const setQty = (k: Numbered, v: string) => {
    const n = Math.min(MAX_SPARES, Number(v.replace(/\D/g, "")) || 0);
    setRows((all) => ({ ...all, [k]: Array.from({ length: n }, (_, i) => all[k][i] ?? blank) }));
  };
  const setRow = (k: Numbered, i: number, change: Partial<Row>) => setRows((all) => ({ ...all, [k]: all[k].map((r, n) => (n === i ? { ...r, ...change } : r)) }));

  if (sent)
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{sent}</p>
        <button type="button" onClick={onDone} className="rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white">
          Done
        </button>
      </div>
    );
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-sm font-semibold">What do you need?</p>
        <div className="flex flex-wrap gap-2">
          {SPARE_ITEMS.map((i) => (
            <button
              key={i.key}
              type="button"
              aria-pressed={on.includes(i.key)}
              onClick={() => setOn((l) => (l.includes(i.key) ? l.filter((x) => x !== i.key) : [...l, i.key]))}
              className={`rounded-full px-4 py-2 text-sm font-medium ${on.includes(i.key) ? "bg-thunder-blue text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
            >
              {i.many}
            </button>
          ))}
        </div>
      </div>
      {SPARE_ITEMS.filter((i) => on.includes(i.key)).map((i) => (
        <section key={i.key} className="space-y-2 rounded-xl p-3 ring-1 ring-zinc-950/10 dark:ring-white/10">
          <p className="font-semibold">
            {i.many} {i.about && <span className="text-xs font-normal text-zinc-500">{i.about}</span>}
          </p>
          {i.key === "shorts" ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {SIZES.map((s) => (
                <label key={s} className="text-sm">
                  <span className="mb-0.5 block font-medium">{s}</span>
                  <input
                    inputMode="numeric"
                    className={`${cell} w-full text-center`}
                    placeholder="0"
                    value={shorts[s] ?? ""}
                    onChange={(e) => {
                      const n = e.target.value.replace(/\D/g, "").slice(0, 3);
                      setShorts((x) => ({ ...x, [s]: n && Number(n) > MAX_SHORTS ? String(MAX_SHORTS) : n }));
                    }}
                  />
                </label>
              ))}
            </div>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                How many?
                <input inputMode="numeric" className={`${cell} w-16 text-center`} value={rows[i.key].length || ""} placeholder="0" onChange={(e) => setQty(i.key as Numbered, e.target.value)} />
              </label>
              {rows[i.key].length > 0 && (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {rows[i.key].map((r, n) => {
                    const again = !!r.number && rows[i.key as Numbered].some((x, m) => m < n && Number(x.number) === Number(r.number) && x.number.length === r.number.length);
                    return (
                      <li key={n} className="flex items-center gap-2 text-sm">
                        <span className="w-5 shrink-0 text-right text-xs text-zinc-400">{n + 1}</span>
                        <input
                          inputMode="numeric"
                          aria-label={`${i.one} ${n + 1} number`}
                          className={`${cell} w-16 text-center`}
                          placeholder="#"
                          value={r.number}
                          onChange={(e) => setRow(i.key as Numbered, n, { number: e.target.value.replace(/\D/g, "").slice(0, 2) })}
                        />
                        <select aria-label={`${i.one} ${n + 1} size`} className={`${cell} min-w-0 flex-1`} value={r.size} onChange={(e) => setRow(i.key as Numbered, n, { size: e.target.value })}>
                          <option value="">Size…</option>
                          {SIZES.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                        {again && <span className="text-xs text-amber-700 dark:text-amber-400">again</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>
      ))}
      {ready.ok && <p className="text-sm font-medium">{spareSummary(ready.rows)} ({spareCount(ready.rows)} in all)</p>}
      {!ready.ok && order.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">{ready.message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={!ready.ok || busy}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await addSparesToOrder(order);
            if (!r.ok) return setError(r.message);
            setSent(`${piecesLabel(r.added)} added to the next order ✓ (${piecesLabel(r.waiting)} waiting). Email the vendor sends them with it.`);
            router.refresh();
          })
        }
        className="rounded-full bg-thunder-blue px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Adding…" : "Add to the next order"}
      </button>
    </div>
  );
}

// Spares waiting for the next order, each with ✕ to take it off.
export function WaitingSpares({ spares, canEdit }: { spares: (Spare & { id: string; addedBy: string | null })[]; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!spares.length) return null;
  const one = (s: Spare) => SPARE_ITEMS.find((i) => i.key === s.item)!.one;
  return (
    <div className="space-y-1 rounded-lg bg-blue-50 p-2 dark:bg-blue-500/10">
      <p className="text-xs font-semibold">Spares in the next order: {spareSummary(spares)}</p>
      <ul className="flex flex-wrap gap-1">
        {spares.map((s) => (
          <li key={s.id} title={s.addedBy ? `Added by ${s.addedBy}` : undefined} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15">
            {one(s)} {s.number !== null && `#${s.number} `}
            {s.size}
            {s.item === "shorts" && ` x ${s.qty}`}
            {canEdit && (
              <button
                type="button"
                disabled={busy}
                aria-label={`Take off ${one(s)} ${s.number !== null ? `#${s.number} ` : ""}${s.size}`}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const r = await removeSpareFromOrder(s.id);
                    if (!r.ok) setError(r.message);
                    router.refresh();
                  })
                }
                className="px-0.5 font-semibold text-red-600 disabled:opacity-40 dark:text-red-400"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
