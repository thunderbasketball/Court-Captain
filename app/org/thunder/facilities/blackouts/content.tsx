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
import { hasArea, seesWho } from "@/lib/org-admin";

import { easternDate } from "@/lib/time";
import { CardPanel } from "../../../../CardIcons";
import { PageFrame } from "../../../../ui";
import { hasFeature } from "@/lib/features";

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

export const BLACKOUT_ADD = "blackout-add";

export async function BlackoutsContent({
  embedded = false,
}: {
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "thunder", "practice"))) return null;
  } else await requireFeature("thunder", "practice");
  if (!hasArea(user, "practices")) {
    if (embedded) return null;
    redirect("/");
  }
  const who = await seesWho(db, user, "thunder"); // Owners and Admins see who did it
  const now = new Date();
  const [{ upcoming: all, rules }, gyms] = await Promise.all([listBlackouts(db, now), listGyms({ pool: db })]);
  // The list shows only the next 6 months.
  const today = easternDate(now);
  const [y, m, d] = today.split("-").map(Number);
  const until = new Date(Date.UTC(y, m - 1 + 6, d)).toISOString().slice(0, 10);
  const upcoming = all.filter((b) => b.day <= until);

  return (
    <>
      {!embedded && <AppHeader user={user} tab="facilities" context="director" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-6xl flex-1 space-y-3 px-4 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {embedded ? (
            <p className="text-sm text-zinc-500">Days and times when no team can practice</p>
          ) : (
            <PageTitle title="Blackout Dates" subtitle="Days and times when no team can practice" />
          )}
          {!embedded && <BlackoutButton gyms={gyms} />}
        </div>
        {/* Inside its card: the + on the card's title line (BLACKOUT_ADD) expands the form here. */}
        {embedded && (
          <CardPanel id={BLACKOUT_ADD} className="rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
            <BlackoutButton gyms={gyms} inline />
          </CardPanel>
        )}
        {!embedded && <FacilitiesNav current="blackouts" />}
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
                      {r.gym ?? "All gyms"} · {timeLabel(r.minute)}
                      {who && ` · added by ${r.createdBy}`}
                    </p>
                  </div>
                  <DeleteRuleButton ruleId={r.id} label={r.reason ?? r.label} />
                </li>
              ))}
            </ul>
          </section>
          <section className={`${card} overflow-hidden`}>
            <h2 className="border-b border-zinc-100 px-4 py-3 font-semibold dark:border-white/5">
              Next 6 months ({upcoming.length})
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
      </PageFrame>
    </>
  );
}
