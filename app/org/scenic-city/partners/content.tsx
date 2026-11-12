import Link from "next/link";
import SubCard from "../../../SubCard";
import { approvedGroups, assignsGymOfficials, gymOfficials } from "@/lib/officiating";
import { seesWho } from "@/lib/org-admin";
import { GymOfficialsPicker } from "../../../officiating/OfficiatingButtons";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { currentScenic } from "@/lib/contexts-server";
import { hostingRequests } from "@/lib/org-partnerships";
import { TZ, timeLabel } from "@/lib/time";
import { listPartners, partnerHours } from "@/lib/scenic-partners";
import { shortDate } from "@/lib/program-options";
import AppHeader from "../../../AppHeader";
import { FacilitiesNav } from "../ScenicNav";
import { DecideHostingButtons } from "../../../hosting/HostingButtons";
import { PageTitle, card } from "../../../ui";
import { ChatToggle } from "../../../InlineToggle";
import { ChatIcon, iconBtn } from "../../../CardIcons";
import { orgKey } from "@/lib/chat";
import { PartnerButton } from "./PartnerEditor";

import { PageFrame } from "../../../ui";
import { hasFeature } from "@/lib/features";

// Scenic City Directors: every partner. A partner's contacts: their own. Sorted by name.
export async function PartnersContent({
  embedded = false,
}: {
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "scenic-city", "hosting-partners"))) return null;
  } else await requireFeature("scenic-city", "hosting-partners");
  const scenic = await currentScenic(user);
  if (!scenic || scenic.role !== "Director") {
    if (embedded) return null;
    redirect("/org/scenic-city");
  }
  const deps = { pool: db, now: () => new Date() };
  const { partners: all, isDirector } = await listPartners(deps, user, scenic.role === "Director");
  // Hosting Organizations: only those hosting games (a club that only registers teams isn't one).
  const partners = all.filter((p) => p.hostsGames);
  // Organizations asking to host Scenic City's games (Admins and Directors of Facilities, on the Director chip).
  const requests = isDirector ? ((await hostingRequests(deps, user, "scenic-city")) ?? []) : [];
  const waiting = requests.filter((r) => r.status === "pending");
  // Each site's availability (its courts' hours on every upcoming game day), shown when its card is opened.
  const avail = new Map(
    await Promise.all(partners.map(async (p) => [p.id, await partnerHours(deps, user, p.id)] as const)),
  );
  const hm = (t: string) => timeLabel(t).replace(":00 ", " ");
  // Officials: which approved officials group schedules officials at each gym (Admins and Directors of Scheduling,
  // Programs or Facilities pick it).
  const [canAssign, groups, officiating, who] = await Promise.all([
    assignsGymOfficials(db, user, "scenic-city"),
    approvedGroups(db, "scenic-city"),
    gymOfficials(db, "scenic-city"),
    seesWho(db, user, "scenic-city"),
  ]);

  return (
    <>
      {!embedded && <AppHeader user={user} context={scenic.key} tab="scenic-facilities" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {!embedded && <FacilitiesNav user={user} current="all" />}
        <div className="flex items-start justify-between gap-3">
          <PageTitle
            title="Hosting Organizations"
            subtitle={isDirector ? "Schools and organizations hosting games, by name" : "Your schools and organizations"}
          />
          {isDirector && <PartnerButton />}
        </div>
        {waiting.length > 0 && (
          <section className={`${card} mb-4 overflow-hidden ring-amber-500/40`}>
            <h2 className="px-4 pt-4 pb-2 font-semibold">Organizations asking to host games ({waiting.length})</h2>
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
              {waiting.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-zinc-500">
                      Asked by {r.requestedBy} ·{" "}
                      {r.requestedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ })}
                    </p>
                  </div>
                  <DecideHostingButtons id={r.id} name={r.name} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* Each hosting organization its own card (tap to open): its kind, contacts and CourtSync chat, then each of its
            gyms as a card with its availability on upcoming game days and the officials group that schedules officials
            there. The ↗ opens its page (editing its gyms, courts and contacts). */}
        <div className="space-y-2">
          {partners.map((p) => {
            const h = avail.get(p.id);
            // Gyms with no officials group yet: a warning on the gym, and on its organization's card.
            const missing = h?.gyms.filter((g) => !officiating.has(g.key)).length ?? 0;
            const gymCount = `${p.gyms} ${p.gyms === 1 ? "gym" : "gyms"}`;
            return (
              <SubCard
                key={p.id}
                title={p.name}
                count={!p.approved ? "Not approved" : missing ? `${gymCount} · ${missing} without officials` : gymCount}
                alert={!p.approved || missing > 0}
                action={
                  <Link
                    href={`/org/scenic-city/partners/${p.id}`}
                    aria-label={`${p.name}: edit gyms, courts and contacts`}
                    title="Edit gyms, courts and contacts"
                    className={iconBtn}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className="size-4">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                      />
                    </svg>
                  </Link>
                }
              >
                <p className="text-sm text-zinc-500">
                  {p.kind} · {[p.hostsGames && "Hosting games", p.registersTeams && "Registering teams"].filter(Boolean).join(" · ")}
                  {!p.org && ` · ${p.contacts.length ? p.contacts.map((c) => c.name).join(", ") : "No contacts yet"}`}
                </p>
                {/* A hosting organization: the CourtSync chat with its Facilities people, opened right here. */}
                {isDirector && p.org && p.approved && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-zinc-500">CourtSync chat</span>
                    <ChatToggle chatKey={orgKey("scenic-city", `host-${p.org}`)} label={`CourtSync chat with ${p.name}`} className={iconBtn}>
                      <ChatIcon />
                    </ChatToggle>
                  </div>
                )}
                <div className="mt-3 space-y-2">
                  {!h?.gyms.length && <p className="text-sm text-zinc-500">No gyms yet.</p>}
                  {h?.gyms.map((g) => {
                    const courts = h.courts.filter((c) => c.gymKey === g.key);
                    const group = officiating.get(g.key);
                    return (
                      <SubCard
                        key={g.key}
                        title={g.name}
                        count={group ? group.name : "No officials group"}
                        alert={!group}
                      >
                        {!group && !canAssign && (
                          <p className="mb-3 text-sm text-red-600 dark:text-red-400">No officials group is set for this gym yet.</p>
                        )}
                        {canAssign && (
                          <div className="mb-3">
                            {groups.length ? (
                              <GymOfficialsPicker org="scenic-city" gymKey={g.key} gym={g.name} groups={groups} current={group?.org ?? null} />
                            ) : (
                              <p className="text-sm text-red-600 dark:text-red-400">
                                No officials group yet: approve one in Members → Officials Groups, then pick it here.
                              </p>
                            )}
                            {group && who && <p className="mt-1 text-xs text-zinc-500">Set by {group.setBy}</p>}
                          </div>
                        )}
                        <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Availability</p>
                        {!courts.length ? (
                          <p className="text-sm text-zinc-500">No courts yet.</p>
                        ) : !h.days.length ? (
                          <p className="text-sm text-zinc-500">No upcoming game days.</p>
                        ) : (
                          <ul className="space-y-1 text-sm">
                            {h.days.map((d) => {
                              const open = courts.filter((c) => h.hours[`${c.id}:${d.id}`]);
                              return (
                                <li key={d.id} className="flex gap-2">
                                  <span className="w-24 shrink-0 text-zinc-500">{shortDate(d.day)}</span>
                                  {open.length ? (
                                    <span className="min-w-0 text-zinc-700 dark:text-zinc-200">
                                      {open
                                        .map((c) => {
                                          const w = h.hours[`${c.id}:${d.id}`];
                                          return `${c.name === "Whole gym" ? "" : `${c.name} `}${hm(w.starts)}–${hm(w.ends)}`;
                                        })
                                        .join(" · ")}
                                    </span>
                                  ) : (
                                    <span className="text-zinc-400">Not open</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </SubCard>
                    );
                  })}
                </div>
              </SubCard>
            );
          })}
        </div>
        {!partners.length && (
          <p className="text-zinc-500">
            {isDirector
              ? "No partners yet."
              : "You're not a contact for a school or organization yet. A Scenic City Director can add you."}
          </p>
        )}
      </PageFrame>
    </>
  );
}
