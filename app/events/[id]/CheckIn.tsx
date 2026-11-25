"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Attendee, Status } from "@/lib/events";
import { gradeLabel } from "@/lib/grades";
import { TZ } from "@/lib/time";
import { Toast } from "../../client-ui";
import { setPracticeStatus, setStatus } from "../actions";
import { genderOf, genderTint } from "../../ui";

const NEXT: Record<Status, Status> = { unknown: "here", here: "absent", absent: "unknown" };
const LOOK: Record<Status, { mark: string; cls: string; label: string }> = {
  unknown: {
    mark: "?",
    cls: "bg-zinc-100 text-zinc-500 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-600",
    label: "Not checked",
  },
  here: { mark: "✓", cls: "bg-emerald-600 text-white ring-emerald-600", label: "Here" },
  absent: { mark: "✗", cls: "bg-red-600 text-white ring-red-600", label: "Not here" },
};
const REFRESH_SECONDS = 15;

const time = (d: Date | string) => new Date(d).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

// Tap a player's circle: ? → ✓ → ✗ → ?. Shows the change at once and saves it; other check-in people's taps
// show up within a few seconds.
// target: an event, or a team practice (by its slot).
export default function CheckIn({ target, players }: { target: { kind: "event" | "practice"; id: string }; players: Attendee[] }) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  // Taps not yet confirmed by a refresh: registrantId → status.
  const [pending, setPending] = useState<Record<string, Status>>({});
  const [filter, setFilter] = useState<Status | "all">("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  // One save at a time per player, in tap order, so quick taps land in the right order.
  const queue = useRef(new Map<string, Promise<unknown>>());

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") startRefresh(() => router.refresh());
    }, REFRESH_SECONDS * 1000);
    return () => clearInterval(t);
  }, [router]);

  const statusOf = (p: Attendee) => pending[p.registrantId] ?? p.status;

  function tap(p: Attendee) {
    const next = NEXT[statusOf(p)];
    setPending((m) => ({ ...m, [p.registrantId]: next }));
    const prev = queue.current.get(p.registrantId) ?? Promise.resolve();
    const job = prev.then(async () => {
      const r =
        target.kind === "event"
          ? await setStatus({ eventId: target.id, registrantId: p.registrantId, status: next })
          : await setPracticeStatus({ slotId: target.id, registrantId: p.registrantId, status: next });
      if (queue.current.get(p.registrantId) !== job) return; // a newer tap is on its way
      queue.current.delete(p.registrantId);
      if (!r.ok) setError(`${p.firstName} ${p.lastName}: ${r.message}`);
      // Fresh data and dropping the pending tap land together, so the circle never flickers back.
      startRefresh(() => {
        router.refresh();
        setPending((m) => {
          const rest = { ...m };
          delete rest[p.registrantId];
          return rest;
        });
      });
    });
    queue.current.set(p.registrantId, job);
  }

  const counts = { here: 0, absent: 0, unknown: 0 };
  for (const p of players) counts[statusOf(p)]++;
  const q = search.trim().toLowerCase();
  const shown = players.filter(
    (p) => (filter === "all" || statusOf(p) === filter) && (!q || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q)),
  );
  const groups: { key: string; title: string; players: Attendee[] }[] = [];
  for (const p of shown) {
    const key = `${p.grade}-${p.gender}`;
    let g = groups.at(-1);
    if (!g || g.key !== key) groups.push((g = { key, title: `${p.gender} · ${gradeLabel(p.grade)}`, players: [] }));
    g.players.push(p);
  }

  const chip = (key: Status | "all", text: string, n: number, on: string) => (
    <button
      type="button"
      onClick={() => setFilter(filter === key ? "all" : key)}
      className={`flex-1 rounded-xl px-2 py-2 text-center ring-1 ${filter === key ? on : "bg-white ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10"}`}
    >
      <span className="block text-xl font-bold tabular-nums">{n}</span>
      <span className="block text-xs">{text}</span>
    </button>
  );

  return (
    <div className="mt-4">
      {error && <Toast key={error} message={error} />}
      <div className="space-y-2">
        <div className="flex gap-2">
          {chip("here", "✓ Here", counts.here, "bg-emerald-600 text-white ring-emerald-600")}
          {chip("absent", "✗ Not here", counts.absent, "bg-red-600 text-white ring-red-600")}
          {chip("unknown", "? Not checked", counts.unknown, "bg-zinc-700 text-white ring-zinc-700")}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Find a player (${players.length})…`}
          className="w-full rounded-xl border-0 bg-white px-3 py-2.5 text-base ring-1 ring-zinc-950/10 outline-none focus:ring-2 focus:ring-thunder-blue dark:bg-zinc-900 dark:ring-white/15"
        />
      </div>

      {!players.length && (
        <p className="mt-4 text-zinc-500">
          {target.kind === "event"
            ? "No players match this event yet."
            : "No players on this team's roster yet. The Director adds them on the team page."}
        </p>
      )}
      {players.length > 0 && !shown.length && <p className="mt-4 text-zinc-500">Nobody here with that filter.</p>}
      <div className="mt-2 space-y-4">
        {groups.map((g) => (
          <section key={g.key}>
            <h2 className="mb-1 text-xs font-bold tracking-wide text-zinc-500 uppercase">{g.title}</h2>
            <ul className={`divide-y divide-zinc-100 overflow-hidden rounded-xl ring-1 dark:divide-white/5 ${genderTint(genderOf(g.title)) ?? "bg-white ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10"}`}>
              {g.players.map((p) => {
                const s = statusOf(p);
                const saved = !(p.registrantId in pending);
                return (
                  <li key={p.registrantId}>
                    <button
                      type="button"
                      onClick={() => tap(p)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-zinc-50 dark:active:bg-white/5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {p.firstName} <span className="font-semibold">{p.lastName}</span>
                        </span>
                        <span className="block text-xs text-zinc-400">
                          {!saved
                            ? "Saving…"
                            : p.updatedBy && p.updatedAt
                              ? `${LOOK[s].label} · ${p.updatedBy}, ${time(p.updatedAt)}`
                              : LOOK[s].label}
                        </span>
                      </span>
                      <span
                        aria-label={LOOK[s].label}
                        className={`flex size-11 shrink-0 items-center justify-center rounded-full text-xl font-bold ring-2 transition-colors ${LOOK[s].cls}`}
                      >
                        {LOOK[s].mark}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
