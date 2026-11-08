import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { fastbreakConfigured } from "@/lib/fastbreak/client";
import { fastbreakPage, type FbOrg } from "@/lib/fastbreak/orgs";
import { FASTBREAK_AUTO } from "@/lib/fastbreak/sync";
import { seesWho } from "@/lib/org-admin";
import { requireFeature } from "@/lib/features-server";
import { TZ } from "@/lib/time";
import AppHeader from "../../../../AppHeader";
import { GroupCard, Notice, PageTitle, TeamName, card } from "../../../../ui";
import { OrgPicker, SyncNowButton } from "./FastbreakTools";

export default function FastbreakPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Fastbreak />
    </Suspense>
  );
}

const when = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const teams = (n: number) => `${n} team${n === 1 ? "" : "s"}`;

// FastBreak (SPEC.md section 13): outside clubs' teams registered in FastBreak Compete come into Scenic City's League.
// Directors of Teams and Admins: pick each Fastbreak organization's club, Sync now, and see the teams that came in.
async function Fastbreak() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("scenic-city", "team-registration");
  const scenic = await currentScenic(user);
  if (!scenic) redirect("/");
  const data = await fastbreakPage({ pool: db, now: () => new Date() }, user);
  if (!data) redirect("/org/scenic-city/teams");
  const who = await seesWho(db, user, "scenic-city"); // Owners and Admins see who did it

  const sections: { key: FbOrg["kind"]; title: string; note: string }[] = [
    { key: "waiting", title: "To pick", note: "Their teams wait until you pick their club." },
    { key: "club", title: "Outside clubs", note: "Their teams come in at each sync." },
    { key: "skip", title: "On CourtCaptain (skipped)", note: "They add and register their own teams here." },
  ];
  const picked = (o: FbOrg) => (o.kind === "club" ? `→ ${o.clubName}` : o.kind === "skip" ? "On CourtCaptain" : "Not picked");

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="scenic-teams" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Link href="/org/scenic-city/teams" className="text-sm font-medium text-thunder-blue hover:underline">
          ← Teams
        </Link>
        <PageTitle
          title="FastBreak"
          subtitle="Outside clubs' teams registered in FastBreak Compete: added as COMP with (FB) after the name, for just the dates they signed up for."
        />

        {!fastbreakConfigured() && (
          <Notice tone="red">FastBreak isn&apos;t set up on this server (its API key is missing).</Notice>
        )}

        <section className={`${card} mb-4 space-y-3 p-4`}>
          {data.sync ? (
            <p className={`text-sm ${data.sync.ok ? "" : "text-red-700 dark:text-red-300"}`}>
              Last sync {when(data.sync.checkedAt)} · {data.sync.ok ? data.sync.message : `failed: ${data.sync.message}`}
            </p>
          ) : (
            <p className="text-sm text-zinc-500">Not synced yet.</p>
          )}
          <SyncNowButton />
        </section>

        <div className="grid gap-4">
          {sections.map((s) => {
            const list = data.orgs.filter((o) => o.kind === s.key);
            if (!list.length) return null;
            return (
              <GroupCard key={s.key} title={s.title} count={list.length} defaultOpen={s.key !== "skip"}>
                <li className="bg-zinc-50 px-4 py-1.5 text-xs text-zinc-500 dark:bg-white/5">{s.note}</li>
                {list.map((o) => (
                  <li key={o.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 text-sm">
                      <p className="font-semibold">{o.fbName}</p>
                      <p className="text-zinc-600 dark:text-zinc-300">
                        {picked(o)} · {teams(o.teams)} in FastBreak
                        {o.kind === "club" && ` · ${o.added} added`}
                      </p>
                      {who && o.setBy && (
                        <p className="text-xs text-zinc-500">
                          {o.setBy === FASTBREAK_AUTO ? "Matched by name (auto)" : `Picked by ${o.setBy}`}
                          {o.setAt && ` · ${when(o.setAt)}`}
                        </p>
                      )}
                    </div>
                    <OrgPicker
                      id={o.id}
                      fbName={o.fbName}
                      kind={o.kind}
                      clubId={o.clubId}
                      suggested={o.suggested}
                      clubs={data.clubs}
                    />
                  </li>
                ))}
              </GroupCard>
            );
          })}
          {!data.orgs.length && <p className="text-zinc-500">No organizations yet. Tap Sync now.</p>}

          {data.teams.length > 0 && (
            <GroupCard title="Teams from FastBreak" count={data.teams.length}>
              {data.teams.map((t) => (
                <li key={t.id} className="px-4 py-3 text-sm">
                  <p className="font-semibold">
                    <TeamName name={t.name} />
                    {t.altName && <span className="font-normal text-zinc-500"> · {t.altName}</span>}
                  </p>
                  <p className="text-zinc-600 dark:text-zinc-300">{t.club}</p>
                  <p className="text-zinc-600 dark:text-zinc-300">
                    {t.days.length ? t.days.map(day).join(", ") : "No dates registered"}
                  </p>
                  {who && <p className="text-xs text-zinc-500">Added by Fastbreak · {when(t.createdAt)}</p>}
                </li>
              ))}
            </GroupCard>
          )}
        </div>
      </main>
    </>
  );
}
