import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { dmKey } from "@/lib/chat";
import { db } from "@/lib/db";
import { gradesText } from "@/lib/event-names";
import { listTeams, type TeamListItem } from "@/lib/teams";
import AppHeader from "../AppHeader";
import { Chip, GroupCard, PageTitle, Stats } from "../ui";
import { ContactChip, GroupTextButton } from "../Contacts";
import ChatLink from "../ChatLink";
import NotifyButton from "../NotifyButton";
import RosterCountButton from "./RosterCountButton";
import { hasArea } from "@/lib/org-admin";

export default function TeamsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Teams />
    </Suspense>
  );
}

async function Teams() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "team-building");
  if (!hasArea(user, "teams")) redirect("/");

  const teams = await listTeams({ pool: db, now: () => new Date() }, user);
  const groups: { level: string; gender: string; teams: TeamListItem[] }[] = [];
  for (const t of teams) {
    let g = groups.at(-1);
    if (!g || g.level !== t.level || g.gender !== t.gender) groups.push((g = { level: t.level, gender: t.gender, teams: [] }));
    g.teams.push(t);
  }
  const count = (level: string) => teams.filter((t) => t.level === level).length;
  const coachCells = teams.flatMap((t) => t.staff.filter((s) => s.role === "HeadCoach" || s.role === "AsstCoach").map((s) => s.cell));

  return (
    <>
      <AppHeader user={user} tab="teams" context="director" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <PageTitle title="Teams" subtitle="Grouped by Comp or Rec, then gender; youngest grade first" />
          <Link
            href="/teams/new"
            className="shrink-0 rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thunder-blue-dark"
          >
            + New team
          </Link>
        </div>
        <div className="mb-4 flex items-center gap-2">
          <GroupTextButton cells={coachCells} label="Text all coaches" />
          <NotifyButton audience={{ everyone: true }} to="everyone" size="md" />
          <span className="text-sm text-zinc-500">Notify everyone</span>
        </div>
        <Stats
          items={[
            { label: "Teams", value: teams.length },
            {
              label: "Comp",
              value: count("COMP"),
              tone: "text-thunder-orange",
            },
            { label: "Rec", value: count("REC") },
          ]}
        />
        {!teams.length && <p className="text-zinc-500">No teams yet. Tap “+ New team” to create one.</p>}
        <div className="space-y-3">
          {groups.map((g) => (
            <GroupCard key={`${g.level}-${g.gender}`} title={`${g.level === "COMP" ? "Comp" : "Rec"} · ${g.gender}`} count={g.teams.length}>
              {g.teams.map((t) => (
                <li key={t.id} className="px-4 py-3">
                  <Link href={`/teams/${t.id}`} className="-mx-2 flex gap-3 rounded-xl px-2 py-1 hover:bg-zinc-50 dark:hover:bg-white/5">
                    <span
                      className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white ${
                        t.gender === "Boys" ? "bg-thunder-blue" : "bg-pink-600"
                      }`}
                    >
                      {t.name.split(" ")[0]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-semibold">{t.name}</p>
                        <Chip tone={t.level === "COMP" ? "orange" : "zinc"}>{t.level}</Chip>
                      </div>
                      <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                        {gradesText(t.grades)}
                        {t.practiceLocations.length > 0 && ` · ${t.practiceLocations.join(", ")}`}
                      </p>
                    </div>
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="mt-3 size-5 shrink-0 text-zinc-300">
                      <path
                        fillRule="evenodd"
                        d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </Link>
                  <div className="mt-1.5 flex items-start gap-2 pl-12">
                    <div className="flex flex-1 flex-wrap gap-x-1 gap-y-1">
                      {t.staff.map((p) => (
                        <ContactChip
                          key={p.role}
                          person={p}
                          about={t.name}
                          chatKey={
                            (p.role === "HeadCoach" || p.role === "AsstCoach") && p.coachId !== user.coachId
                              ? dmKey(user.coachId, p.coachId)
                              : undefined
                          }
                        />
                      ))}
                      {!t.headCoach && <p className="text-sm text-amber-700 dark:text-amber-400">No head coach yet</p>}
                    </div>
                    <RosterCountButton team={t} />
                    {t.staff.length > 0 && <ChatLink chatKey={`staff-${user.coachId}-${t.id}`} label={`Chat with ${t.name} staff`} popup />}
                    {t.staff.length > 0 && <NotifyButton audience={{ teams: [t.id] }} to={t.name} />}
                  </div>
                </li>
              ))}
            </GroupCard>
          ))}
        </div>
      </main>
    </>
  );
}
