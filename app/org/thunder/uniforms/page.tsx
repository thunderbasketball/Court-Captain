import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { SIZES, jerseyName, listUniformOrders, type UniformOrder } from "@/lib/uniforms";
import AppHeader from "../../../AppHeader";
import { GroupCard, PageTitle } from "../../../ui";
import { hasArea } from "@/lib/org-admin";

export default function UniformsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Uniforms />
    </Suspense>
  );
}

const missing = <span className="font-medium text-red-600 dark:text-red-400">—</span>;

// Director (view only; coaches set these): uniforms to order. Every rostered player who ordered one, by team: jersey name, number, size.
async function Uniforms() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "uniforms");
  if (!hasArea(user, "players")) redirect("/");

  const rows = await listUniformOrders({ pool: db, now: () => new Date() }, user);
  const teams = new Map<string, UniformOrder[]>();
  for (const r of rows) teams.set(r.teamId, [...(teams.get(r.teamId) ?? []), r]);
  const bySize = SIZES.map((s) => [s, rows.filter((r) => r.size === s).length] as const).filter(([, n]) => n > 0);
  const noSize = rows.filter((r) => !r.size).length;

  return (
    <>
      <AppHeader user={user} tab="uniforms" context="director" />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <PageTitle title="Uniforms" subtitle={`${rows.length} ordered by rostered players`} />
        {rows.length > 0 && (
          <p className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
            {bySize.map(([s, n]) => (
              <span key={s}>
                <span className="font-semibold">{s}</span> {n}
              </span>
            ))}
            {noSize > 0 && <span className="font-medium text-red-600 dark:text-red-400">No size yet {noSize}</span>}
          </p>
        )}
        {!rows.length && <p className="text-sm text-zinc-500">No rostered player has ordered a uniform yet.</p>}
        <div className="space-y-3">
          {[...teams].map(([teamId, list]) => (
            <GroupCard key={teamId} title={list[0].team} count={list.length}>
              {list.map((r) => (
                <li key={r.registrantId} className="grid grid-cols-[1fr_3rem_3rem] items-center gap-2 px-4 py-2 text-sm">
                  <span className="truncate font-semibold tracking-wide">{jerseyName(r.lastName)}</span>
                  <span className="text-right tabular-nums">{r.number ? `#${r.number}` : missing}</span>
                  <span className="text-right">{r.size ?? missing}</span>
                </li>
              ))}
            </GroupCard>
          ))}
        </div>
      </main>
    </>
  );
}
