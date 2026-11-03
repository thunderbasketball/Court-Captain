"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { UniformRequest } from "@/lib/uniforms";
import { Toast } from "../../client-ui";
import { card } from "../../ui";
import { markUniformAdded } from "./teams/actions";

// Home, Directors of Uniforms: players whose coaches say they need a uniform, to add to the TeamSnap order. Added takes
// one off the list (their team's Uniforms tab then shows "Ordered a uniform"). The server checks again.
export default function UniformRequests({ list }: { list: UniformRequest[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [gone, setGone] = useState<string[]>([]);
  const rows = list.filter((r) => !gone.includes(`${r.teamId}:${r.registrantId}`));
  if (!rows.length) return null;
  return (
    <section className={`${card} mb-5 p-4`}>
      <h2 className="text-sm font-semibold">
        Add to the TeamSnap uniform order <span className="font-normal text-zinc-500">({rows.length})</span>
      </h2>
      <p className="text-xs text-zinc-500">Their coaches say they need a uniform; their family didn&apos;t order one.</p>
      <ul className="mt-2 divide-y divide-zinc-100 dark:divide-white/5">
        {rows.map((r) => {
          const key = `${r.teamId}:${r.registrantId}`;
          return (
            <li key={key} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">
                  {r.firstName} {r.lastName}
                </span>
                <span className="block text-xs text-zinc-500">
                  <Link href={`/org/thunder/teams/${r.teamId}`} className="text-thunder-blue hover:underline">
                    {r.team}
                  </Link>
                  {" · "}
                  {r.size ? (
                    <span className="font-medium text-zinc-800 dark:text-zinc-100">Size {r.size}</span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300">no size yet</span>
                  )}
                  {r.number && ` · #${r.number}`} · asked by {r.neededBy}
                </span>
              </span>
              <button
                type="button"
                disabled={busy || !r.size}
                title={r.size ? undefined : "Their coach sets the size first"}
                onClick={() =>
                  start(async () => {
                    const res = await markUniformAdded(r.teamId, r.registrantId);
                    if (!res.ok) return setMsg(res.message);
                    setGone((g) => [...g, key]);
                    setMsg(`${r.firstName} ${r.lastName}: added to the order.`);
                    router.refresh();
                  })
                }
                className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-white/5"
              >
                Added ✓
              </button>
            </li>
          );
        })}
      </ul>
      {msg && <Toast key={msg} message={msg} />}
    </section>
  );
}
