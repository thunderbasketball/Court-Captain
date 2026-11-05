"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { gradeLabel } from "@/lib/grades";
import { SIZES, duplicateNumbers, isMissing, type UniformRow } from "@/lib/uniform-fields";
import { Toast } from "../../../../client-ui";
import { saveUniform, setNeedsUniform } from "../actions";

const field =
  "rounded-lg border-0 bg-white px-2 py-1.5 text-base ring-1 ring-zinc-950/10 outline-none focus:ring-2 focus:ring-thunder-blue dark:bg-zinc-900 dark:ring-white/15";

// Uniforms tab: a number for every rostered player, and a size for those who need a uniform. A player whose family didn't
// order one gets a "Needs a uniform" box: ticking it brings the size, and lists them on Home for the Director of Uniforms
// to add to the TeamSnap order. Each change saves at once.
export default function UniformsBoard({ teamId, rows: initial, who }: { teamId: string; rows: UniformRow[]; who: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const dupes = duplicateNumbers(rows);
  const missing = rows.filter(isMissing).length;

  async function save(row: UniformRow, patch: { number?: string | null; size?: string | null }) {
    // Undo only this player's change if it fails (other players may have saved meanwhile).
    const undo = { number: row.number, size: row.size };
    setRows((list) => list.map((r) => (r.registrantId === row.registrantId ? { ...r, ...patch } : r)));
    const r = await saveUniform(teamId, row.registrantId, patch);
    if (!r.ok) {
      setRows((list) => list.map((x) => (x.registrantId === row.registrantId ? { ...x, ...undo } : x)));
      setDrafts((d) => ({ ...d, [row.registrantId]: undo.number ?? "" }));
      return setError(`${row.firstName} ${row.lastName}: ${r.message}`);
    }
    setRows((list) =>
      list.map((x) => (x.registrantId === row.registrantId ? { ...x, updatedBy: r.updatedBy, updatedAt: r.updatedAt } : x)),
    );
    // Updates the Uniforms tab's red flash.
    router.refresh();
  }

  async function needs(row: UniformRow, on: boolean) {
    const undo = { ordered: row.ordered, neededBy: row.neededBy, addedBy: row.addedBy, size: row.size };
    setRows((list) =>
      list.map((x) =>
        x.registrantId === row.registrantId
          ? { ...x, ordered: on, neededBy: on ? "you" : null, addedBy: null, size: on ? x.size : null }
          : x,
      ),
    );
    const r = await setNeedsUniform(teamId, row.registrantId, on);
    if (!r.ok) {
      setRows((list) => list.map((x) => (x.registrantId === row.registrantId ? { ...x, ...undo } : x)));
      return setError(`${row.firstName} ${row.lastName}: ${r.message}`);
    }
    setRows((list) => list.map((x) => (x.registrantId === row.registrantId ? { ...x, neededBy: on ? r.by : null } : x)));
    router.refresh();
  }

  if (!rows.length) return <p className="px-4 pb-4 text-sm text-zinc-500">No players on the roster yet.</p>;

  return (
    <>
      {error && <Toast key={error} message={error} />}
      <div className="space-y-2 px-4 pb-3">
        {missing > 0 ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-red-600/20 ring-inset dark:bg-red-500/10 dark:text-red-300">
            {missing} {missing === 1 ? "player still needs" : "players still need"} a number or size.
          </p>
        ) : (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 ring-1 ring-emerald-600/20 ring-inset dark:bg-emerald-500/10 dark:text-emerald-300">
            ✓ Every player has their uniform info.
          </p>
        )}
        {dupes.size > 0 && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/10 dark:text-amber-300">
            ⚠ Duplicate {dupes.size === 1 ? "number" : "numbers"} on this team: {[...dupes].map((n) => `#${n}`).join(", ")}
          </p>
        )}
      </div>
      <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
        {rows.map((r) => {
          const draft = drafts[r.registrantId] ?? r.number ?? "";
          const dup = !!r.number && dupes.has(r.number);
          const hint = [r.ordered && r.askedSize, r.askedNumber && `#${r.askedNumber}`].filter(Boolean).join(" ");
          const canUse = !!hint && (r.number !== r.askedNumber || (r.ordered && r.size !== r.askedSize));
          return (
            <li key={r.registrantId} className={`px-4 py-3 ${isMissing(r) ? "bg-red-50/60 dark:bg-red-500/5" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {r.firstName} <span className="font-semibold">{r.lastName}</span>
                  </span>
                  <span className="block text-xs text-zinc-400">{gradeLabel(r.grade)}</span>
                </span>
                {(() => {
                  // Ordered at registration, or added to the TeamSnap order after their coach asked: ordered.
                  const waiting = !r.registered && !!r.neededBy && !r.addedBy;
                  const [tone, text] =
                    r.registered || r.addedBy
                      ? ["bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300", "Ordered a uniform"]
                      : waiting
                        ? [
                            "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
                            "Needs a uniform · not ordered yet",
                          ]
                        : ["bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300", "No uniform ordered"];
                  return (
                    // The chip, and under it (when their family didn't order one) the Needs a uniform box.
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
                        title={r.late ? "✱ Added after registration" : undefined}
                      >
                        {text}
                        {r.late && " ✱"}
                      </span>
                      {!r.registered && (
                        <label className="flex items-center gap-2 text-sm">
                          Needs a uniform
                          <input
                            type="checkbox"
                            className="size-5 accent-thunder-blue"
                            checked={!!r.neededBy}
                            onChange={(e) => needs(r, e.target.checked)}
                          />
                        </label>
                      )}
                      {r.neededBy && !r.registered && (
                        <span className="text-xs text-zinc-400">
                          {r.addedBy ? `On the TeamSnap order (${r.addedBy})` : `By ${r.neededBy}`}
                        </span>
                      )}
                    </span>
                  );
                })()}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-sm">
                  <span className="text-zinc-500">#</span>
                  <input
                    aria-label={`${r.firstName} ${r.lastName} uniform number`}
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={2}
                    value={draft}
                    placeholder="—"
                    onChange={(e) => setDrafts((d) => ({ ...d, [r.registrantId]: e.target.value.replace(/\D/g, "") }))}
                    onBlur={() => draft !== (r.number ?? "") && save(r, { number: draft || null })}
                    className={`${field} w-16 text-center tabular-nums ${dup ? "ring-2 ring-amber-500" : !r.number ? "ring-red-400" : ""}`}
                  />
                </label>
                {r.ordered && (
                  <select
                    aria-label={`${r.firstName} ${r.lastName} uniform size`}
                    value={r.size ?? ""}
                    onChange={(e) => save(r, { size: e.target.value || null })}
                    className={`${field} ${!r.size ? "ring-red-400" : ""}`}
                  >
                    <option value="">Size…</option>
                    {SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
                {canUse && (
                  <button
                    type="button"
                    onClick={() => {
                      const patch: { number?: string; size?: string } = {};
                      if (r.askedNumber && /^\d{1,2}$/.test(r.askedNumber)) patch.number = r.askedNumber;
                      if (r.ordered && r.askedSize && (SIZES as readonly string[]).includes(r.askedSize))
                        patch.size = r.askedSize;
                      if (!Object.keys(patch).length)
                        return setError(`${r.firstName}: the parent's request "${hint}" can't be used. Set it by hand.`);
                      if (patch.number) setDrafts((d) => ({ ...d, [r.registrantId]: patch.number! }));
                      save(r, patch);
                    }}
                    className="text-xs font-medium text-thunder-blue hover:underline dark:text-blue-400"
                  >
                    Parent asked: {hint} · Use
                  </button>
                )}
              </div>
              {dup && (
                <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                  ⚠ #{r.number} is used by another player on this team.
                </p>
              )}
              {who && r.updatedBy && <p className="mt-1 text-xs text-zinc-400">Set by {r.updatedBy}</p>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
