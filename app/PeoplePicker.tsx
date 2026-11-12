"use client";

import { useMemo, useState } from "react";
import { GroupTextButton } from "./Contacts";

// A list to pick people from, in levels that open when tapped (e.g. Gender → Grade → Team → Coach). A tick on any level
// picks everyone under it; then Text sends one group text to the picked cells (split into texts of 19 when more).
export type PickNode = { key: string; label: string; sub?: string; cell?: string | null; children?: PickNode[] };

const leaves = (n: PickNode): PickNode[] => (n.children ? n.children.flatMap(leaves) : [n]);

export default function PeoplePicker({ tree, textLabel, empty }: { tree: PickNode[]; textLabel: string; empty: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const all = useMemo(() => tree.flatMap(leaves), [tree]);
  const toggle = (keys: string[], on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      for (const k of keys) if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  if (!all.length) return <p className="text-sm text-zinc-500">{empty}</p>;
  const cells = all.filter((l) => picked.has(l.key)).map((l) => l.cell ?? null);

  const box = (n: PickNode) => {
    const keys = leaves(n).map((l) => l.key);
    const on = keys.every((k) => picked.has(k));
    const some = !on && keys.some((k) => picked.has(k));
    return (
      <input
        type="checkbox"
        className="size-4 shrink-0"
        aria-label={`Pick ${n.label}`}
        checked={on}
        ref={(el) => {
          if (el) el.indeterminate = some;
        }}
        onChange={(e) => toggle(keys, e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
    );
  };

  const node = (n: PickNode, depth: number) =>
    n.children ? (
      <details key={n.key} className="group/p">
        <summary
          className="flex cursor-pointer list-none items-center gap-2 py-1.5 text-sm select-none [&::-webkit-details-marker]:hidden"
          style={{ paddingLeft: `${depth * 0.9}rem` }}
        >
          {box(n)}
          <span className={`min-w-0 flex-1 truncate ${depth === 0 ? "font-semibold" : "font-medium"}`}>{n.label}</span>
          <span className="text-xs text-zinc-500 tabular-nums">{leaves(n).length}</span>
          <span aria-hidden className="text-zinc-400 transition-transform [details[open]>summary_&]:rotate-90">
            ›
          </span>
        </summary>
        <div>{n.children.map((c) => node(c, depth + 1))}</div>
      </details>
    ) : (
      <label key={n.key} className="flex items-center gap-2 py-1.5 text-sm" style={{ paddingLeft: `${depth * 0.9}rem` }}>
        {box(n)}
        <span className="min-w-0 flex-1 truncate">{n.label}</span>
        {n.sub && <span className="shrink-0 text-xs text-zinc-500">{n.sub}</span>}
        {!n.cell && <span className="shrink-0 text-xs text-red-600 dark:text-red-400">no cell</span>}
      </label>
    );

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          className="size-4"
          checked={picked.size > 0 && all.every((l) => picked.has(l.key))}
          onChange={(e) =>
            toggle(
              all.map((l) => l.key),
              e.target.checked,
            )
          }
        />
        Everyone
      </label>
      <div className="max-h-[55vh] divide-y divide-zinc-100 overflow-y-auto rounded-xl px-2 ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
        {tree.map((n) => node(n, 0))}
      </div>
      <div className="flex flex-wrap gap-2">
        <GroupTextButton cells={cells} label={textLabel} />
      </div>
    </div>
  );
}
