"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DirectorRole } from "@/lib/org-admin";
import { setDirectorRoleActive } from "./org-admin/actions";

// Director roles, by feature (the organization's gear, Admins): each role a feature brings, with an Active switch.
// Off: it isn't offered for new Directors, and Directors who hold it lose that access until it's back on (Admins still
// cover it). Saves at once.
export default function DirectorRoles({ org, groups, who }: { org: string; groups: { feature: string; roles: DirectorRole[] }[]; who: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(groups.flatMap((g) => g.roles.map((r) => [r.key, r.active]))));
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const flip = (key: string, next: boolean) => {
    setError(null);
    setOn((x) => ({ ...x, [key]: next }));
    setDirectorRoleActive(org, key, next)
      .then((r) => {
        if (!r.ok) {
          setOn((x) => ({ ...x, [key]: !next }));
          setError({ key, text: r.message });
        } else router.refresh();
      })
      .catch(() => {
        setOn((x) => ({ ...x, [key]: !next }));
        setError({ key, text: "Couldn't save. Check your connection and try again." });
      });
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        Each feature brings its Director roles. Switch off the ones your organization doesn&apos;t use: they won&apos;t be offered for new Directors,
        and Directors who hold one lose that access until it&apos;s back on. Admins always cover every role.
      </p>
      {groups.map((g) => (
        <div key={g.feature}>
          <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{g.feature}</p>
          <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-950/10 dark:divide-white/5 dark:ring-white/10">
            {g.roles.map((r) => {
              const active = on[r.key];
              return (
                <li key={r.key} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 text-sm">
                      <span className={`font-medium ${active ? "" : "text-zinc-400 line-through"}`}>Director of {r.name.replace(/^Officials Assigner$/, "Officials (Assigner)")}</span>
                      <span className="block text-xs text-zinc-500">
                        {r.covers}
                        {r.holders > 0 && ` · ${r.holders} Director${r.holders === 1 ? "" : "s"}`}
                        {who && r.setBy && ` · set by ${r.setBy}`}
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={active}
                      aria-label={`Director of ${r.name}: ${active ? "Active" : "Off"}`}
                      onClick={() => flip(r.key, !active)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${active ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
                    >
                      <span className={`inline-block size-5 rounded-full bg-white shadow transition ${active ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                  {error?.key === r.key && <p className="mt-1 text-xs text-red-600">{error.text}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
