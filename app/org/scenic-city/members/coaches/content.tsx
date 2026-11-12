import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { formatCell } from "@/lib/phone";
import { programCoaches } from "@/lib/scenic-members";
import AppHeader from "../../../../AppHeader";
import { MembersNav } from "../../ScenicNav";
import { Chip, EmailLink, GroupCard, PageTitle, PersonRow, PhoneLink } from "../../../../ui";
import { ChatToggle } from "../../../../InlineToggle";
import { ChatIcon, iconBtn } from "../../../../CardIcons";
import { orgKey } from "@/lib/chat";

import { PageFrame } from "../../../../ui";

// Members → Coaches: one tab per active program; the coaches of its registered teams, by last name, with their teams.
export async function ScenicCoachesContent({
  searchParams = Promise.resolve({}),
  embedded = false,
}: {
  searchParams?: PageProps<"/org/scenic-city/members/coaches">["searchParams"];
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const scenic = await currentScenic(user);
  if (!scenic) {
    if (embedded) return null;
    redirect("/");
  }
  const asked = (await searchParams).program;
  const data = await programCoaches({ pool: db, now: () => new Date() }, user, typeof asked === "string" ? asked : null);
  if (!data) {
    if (embedded) return null;
    redirect("/org/scenic-city");
  }

  return (
    <>
      {!embedded && <AppHeader user={user} context={scenic.key} tab="scenic-members" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {!embedded && <MembersNav user={user} current="coaches" />}
        <PageTitle title="Coaches" subtitle="The coaches of each program's registered teams" />
        {data.programs.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {data.programs.map((p) => (
              <Link
                key={p.id}
                href={`/org/scenic-city/members/coaches?program=${p.id}`}
                aria-current={p.id === data.current ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${
                  p.id === data.current
                    ? "bg-scenic-navy text-white ring-scenic-navy dark:bg-white dark:text-scenic-navy"
                    : "text-zinc-700 ring-zinc-950/15 dark:text-zinc-200 dark:ring-white/20"
                }`}
              >
                {p.name}
              </Link>
            ))}
          </div>
        )}
        {!data.current ? (
          <p className="text-sm text-zinc-500">No active programs.</p>
        ) : (
          <div className="space-y-3">
            {/* The program's coaches chat (its coaches + Directors), opened right here. */}
            {data.coaches.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-zinc-500">Chat with all of them</span>
                <ChatToggle chatKey={orgKey("scenic-city", `program-${data.current}`)} label="Chat with this program's coaches" className={iconBtn}>
                  <ChatIcon />
                </ChatToggle>
              </div>
            )}
            {/* The program's coaches, each one line with their teams; opened to cell and email, and a chat with them. */}
            <GroupCard
              title={`${data.programs.find((p) => p.id === data.current)?.name ?? "Program"} coaches`}
              count={data.coaches.length}
            >
              {!data.coaches.length && !data.noCoach.length && (
                <li className="px-4 py-3 text-sm text-zinc-500 italic">No teams registered yet.</li>
              )}
              {data.coaches.map((c) => {
                const [first, ...rest] = c.name.split(" ");
                return (
                  <PersonRow
                    key={c.id}
                    first={first}
                    last={rest.join(" ")}
                    avatarTone="green"
                    collapsed
                    chips={<Chip tone="green">Coach</Chip>}
                    always={
                      <div className="flex flex-wrap gap-1">
                        {c.teams.map((t) => (
                          <Chip key={`${t.name}-${t.from}`} tone="orange">
                            {t.name} · {t.from}
                          </Chip>
                        ))}
                      </div>
                    }
                  >
                    <p>
                      <PhoneLink cell={c.cell} label={formatCell(c.cell)} />
                    </p>
                    <p className="truncate">{c.email ? <EmailLink email={c.email} /> : "No email"}</p>
                    {c.id && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-xs text-zinc-500">Chat with {first}</span>
                        <ChatToggle chatKey={orgKey("scenic-city", `coach-${c.id}`)} label={`Chat with ${c.name}`} className={iconBtn}>
                          <ChatIcon />
                        </ChatToggle>
                      </div>
                    )}
                  </PersonRow>
                );
              })}
            </GroupCard>
            {data.noCoach.length > 0 && (
              <GroupCard title="No coach yet" count={data.noCoach.length}>
                {data.noCoach.map((t) => (
                  <li key={`${t.name}-${t.from}`} className="px-4 py-2.5 text-sm font-medium text-red-600 dark:text-red-400">
                    {t.name} <span className="font-normal text-zinc-500">· {t.from}</span>
                  </li>
                ))}
              </GroupCard>
            )}
          </div>
        )}
      </PageFrame>
    </>
  );
}
