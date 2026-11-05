"use client";

import { useRef, useState } from "react";
import { HEIGHTS, NOTES_MAX, POSITIONS, SPEEDS, type Fields } from "@/lib/evaluation-fields";
import type { EvalCard } from "@/lib/evaluations";
import { gradeLabel } from "@/lib/grades";
import { TZ } from "@/lib/time";
import { Toast } from "../../../../../client-ui";
import { saveEvaluation } from "../../actions";

type Filter = "all" | "unrated" | "interested";
const rated = (c: Fields) => !!(c.position || c.height || c.speed || c.score || c.notes);

// Every eligible player's card. Each tap saves at once; tapping the picked choice again clears it.
export default function EvalBoard({ teamId, teamName, cards }: { teamId: string; teamName: string; cards: EvalCard[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  // The latest fields of each card, so the filter counts follow the taps.
  const [live, setLive] = useState<Record<string, Fields>>({});
  const [error, setError] = useState<string | null>(null);

  const fieldsOf = (c: EvalCard) => live[c.registrantId] ?? c;
  const count = (f: Filter) =>
    cards.filter((c) => f === "all" || (f === "unrated" ? !rated(fieldsOf(c)) : fieldsOf(c).interested)).length;
  const q = search.trim().toLowerCase();
  const shown = cards.filter(
    (c) =>
      (filter === "all" || (filter === "unrated" ? !rated(fieldsOf(c)) : fieldsOf(c).interested)) &&
      (!q || `${c.firstName} ${c.lastName}`.toLowerCase().includes(q)),
  );
  const grades = [...new Set(shown.map((c) => c.grade))];

  return (
    <>
      {error && <Toast key={error} message={error} />}
      <div className="mb-3 flex gap-2 overflow-x-auto">
        {(
          [
            ["all", "All"],
            ["unrated", "Not rated"],
            ["interested", "★ Interested"],
          ] as const
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
              filter === f
                ? "bg-thunder-blue text-white shadow-sm"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {label} ({count(f)})
          </button>
        ))}
      </div>
      <input
        className="mb-4 w-full rounded-xl border-0 bg-white px-3 py-2.5 text-base ring-1 ring-zinc-950/10 outline-none focus:ring-2 focus:ring-thunder-blue dark:bg-zinc-900 dark:ring-white/15"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Find a player…"
      />
      {!shown.length && <p className="text-sm text-zinc-500">No players here.</p>}
      {grades.map((g) => (
        <section key={g} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-500 uppercase">{gradeLabel(g)}</h2>
          <div className="space-y-3">
            {shown
              .filter((c) => c.grade === g)
              .map((c) => (
                <Card
                  key={c.registrantId}
                  teamId={teamId}
                  teamName={teamName}
                  card={c}
                  onChange={(f) => setLive((m) => ({ ...m, [c.registrantId]: f }))}
                  onError={setError}
                />
              ))}
          </div>
        </section>
      ))}
    </>
  );
}

// One player's evaluation card (also shown in the Roster tab's Evaluate pop-up).
export function Card({
  teamId,
  teamName,
  card,
  onChange,
  onError,
}: {
  teamId: string;
  teamName: string;
  card: EvalCard;
  onChange: (f: Fields) => void;
  onError: (m: string) => void;
}) {
  const [f, setF] = useState<Fields>(card);
  const [notes, setNotes] = useState(card.notes);
  const [saved, setSaved] = useState({ by: card.updatedBy, at: card.updatedAt });
  const [saving, setSaving] = useState(0);
  // Saves go one at a time, in tap order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  function save(patch: Partial<Fields>) {
    const prev = f;
    const next = { ...f, ...patch };
    setF(next);
    onChange(next);
    setSaving((n) => n + 1);
    queue.current = queue.current.then(async () => {
      const r = await saveEvaluation(teamId, card.registrantId, patch);
      setSaving((n) => n - 1);
      if (r.ok) return setSaved({ by: r.updatedBy, at: r.updatedAt });
      setF(prev);
      onChange(prev);
      if ("notes" in patch) setNotes(prev.notes);
      onError(`${card.firstName} ${card.lastName}: ${r.message}`);
    });
  }

  const others = card.interestedTeams.filter((t) => t !== teamName);
  const pick = <K extends "position" | "height" | "speed" | "score">(key: K, value: Fields[K]) =>
    save({ [key]: f[key] === value ? null : value } as Partial<Fields>);

  return (
    <article
      className={`rounded-2xl bg-white p-4 shadow-sm ring-1 dark:bg-zinc-900 ${f.interested ? "ring-2 ring-orange-400" : "ring-zinc-950/5 dark:ring-white/10"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">
            {card.firstName} <span className="font-semibold">{card.lastName}</span>
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{gradeLabel(card.grade)}</p>
          <div className="mt-1 flex flex-wrap gap-1 text-xs">
            {card.rosteredOn.map((t) => (
              <span key={t} className="rounded-full bg-emerald-600 px-2 py-0.5 font-medium text-white">
                On {t}
              </span>
            ))}
            {others.map((t) => (
              <span
                key={t}
                className="rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-800 dark:bg-orange-500/15 dark:text-orange-300"
              >
                ★ {t}
              </span>
            ))}
            {!card.registered && <span className="text-amber-700 dark:text-amber-400">No longer in registrations</span>}
          </div>
        </div>
        <button
          type="button"
          aria-pressed={f.interested}
          onClick={() => save({ interested: !f.interested })}
          className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap ring-1 ${
            f.interested
              ? "bg-orange-500 text-white ring-orange-500"
              : "text-zinc-600 ring-zinc-300 dark:text-zinc-300 dark:ring-zinc-600"
          }`}
        >
          {f.interested ? "★ Interested" : "☆ Interested"}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        <Choices label="Position" options={POSITIONS} value={f.position} onPick={(v) => pick("position", v)} />
        <Choices label="Height" options={HEIGHTS} value={f.height} onPick={(v) => pick("height", v)} />
        <Choices label="Speed" options={SPEEDS} value={f.speed} onPick={(v) => pick("speed", v)} />
        <Choices label="Score" options={[1, 2, 3, 4, 5] as const} value={f.score} onPick={(v) => pick("score", v)} />
      </div>
      <textarea
        value={notes}
        maxLength={NOTES_MAX}
        rows={notes ? 2 : 1}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes.trim() !== f.notes && save({ notes: notes.trim() })}
        placeholder="Notes…"
        className="mt-3 w-full resize-y rounded-xl border-0 bg-zinc-50 px-3 py-2 text-sm ring-1 ring-zinc-950/10 outline-none focus:ring-2 focus:ring-thunder-blue dark:bg-zinc-800 dark:ring-white/15"
      />
      <p className="mt-1 text-xs text-zinc-400">
        {saving > 0
          ? "Saving…"
          : saved.at
            ? `Saved${saved.by ? ` by ${saved.by}` : ""} · ${new Date(saved.at).toLocaleString("en-US", { timeZone: TZ, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}`
            : "Not rated yet"}
      </p>
    </article>
  );
}

function Choices<T extends string | number>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly T[];
  value: T | null;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-medium text-zinc-500">{label}</span>
      <div className="flex flex-1 gap-1.5" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onPick(o)}
            className={`min-w-0 flex-1 rounded-full py-1.5 text-sm font-medium ${
              value === o
                ? "bg-thunder-blue text-white shadow-sm"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
