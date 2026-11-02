import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { listBlackouts } from "@/lib/practice/rules";
import { listGyms } from "@/lib/practice/schedule";
import AppHeader from "../../../../AppHeader";
import { Chip, PageTitle, card } from "../../../../ui";
import FacilitiesNav from "../FacilitiesNav";
import { BlackoutButton } from "../../practice/PracticeTools";
import { DeleteRuleButton } from "./DeleteRuleButton";
import { hasArea } from "@/lib/org-admin";

export default function BlackoutsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Blackouts />
    </Suspense>
  );
}

const timeLabel = (m: number | null) =>
  m === null ? "All day" : `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} ${m < 720 ? "AM" : "PM"}`;
const dateLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

async function Blackouts() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "practice");
  if (!hasArea(user, "facilities")) redirect("/");
  const now = new Date();
  const [{ upcoming, rules }, gyms] = await Promise.all([listBlackouts(db, now), listGyms({ pool: db })]);

  return (
    <>
      <AppHeader user={user} tab="facilities" context="director" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle title="Blackout dates" subtitle="Days and times when no team can practice" />
          <BlackoutButton gyms={gyms} />
        </div>
        <FacilitiesNav current="blackouts" />
        <div className="grid gap-4 lg:grid-cols-2">
          <section className={`${card} overflow-hidden`}>
            <h2 className="border-b border-zinc-100 px-4 py-3 font-semibold dark:border-white/5">Every year ({rules.length})</h2>
            {!rules.length && (
              <p className="px-4 py-3 text-sm text-zinc-500">
                No yearly blackouts. Use Blackout dates → Repeat every year, or a quick pick like Thanksgiving.
              </p>
            )}
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {rules.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{r.reason ?? "Blackout"}</p>
                    <p className="text-sm text-zinc-500">{r.label}</p>
                    <p className="text-xs text-zinc-400">
                      {r.gym ?? "All gyms"} · {timeLabel(r.minute)} · added by {r.createdBy}
                    </p>
                  </div>
                  <DeleteRuleButton ruleId={r.id} label={r.reason ?? r.label} />
                </li>
              ))}
            </ul>
          </section>
          <section className={`${card} overflow-hidden`}>
            <h2 className="border-b border-zinc-100 px-4 py-3 font-semibold dark:border-white/5">
              Upcoming blackout dates ({upcoming.length})
            </h2>
            {!upcoming.length && <p className="px-4 py-3 text-sm text-zinc-500">None.</p>}
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {upcoming.map((b) => (
                <li key={`${b.day}-${b.gym}-${b.minute}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{dateLabel(b.day)}</p>
                    <p className="text-xs text-zinc-500">
                      {b.gym ?? "All gyms"} · {timeLabel(b.minute)}
                      {b.reason ? ` · ${b.reason}` : ""}
                    </p>
                  </div>
                  {b.ruleId && <Chip tone="orange">Yearly</Chip>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}
