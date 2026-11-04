import Link from "next/link";
import { after } from "next/server";
import { popupAnnouncements, unreadCount } from "@/lib/announcements";
import { chatUnreadCount } from "@/lib/chat";
import type { SessionUser } from "@/lib/auth/service";
import { PLATFORM } from "@/lib/contexts";
import { currentContexts } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { myEventCount } from "@/lib/events";
import { orgFeatures, type Feature } from "@/lib/features";
import { directorAreas, hasArea, isOrgAdmin, isThunderAdmin, orgHasArea, type Area } from "@/lib/org-admin";
import { canHost } from "@/lib/facilities";
import { listOrgs, orgInfo } from "@/lib/org-registry";
import { PLATFORM_BRAND } from "@/lib/orgs";
import OrgLogo from "./OrgLogo";
import { myPracticesToday } from "@/lib/practice-attendance";
import { localParts, zonedTime } from "@/lib/time";
import { recordVisit } from "@/lib/site-visits";
import { syncIfStale } from "@/lib/teamsnap/scheduler";
import { stopActing } from "./act-as/actions";
import AnnouncementPopup from "./AnnouncementPopup";
import ChatPopup from "./ChatPopup";
import NotifyButton from "./NotifyButton";
import OrgSwitcher from "./OrgSwitcher";
import OrgGear from "./OrgGear";
import SupportButton from "./support/SupportButton";
import { listArticles, supportChats } from "@/lib/support";
import { LogoutButton } from "./HomeActions";
import { Avatar } from "./ui";

type Tab =
  | "teams"
  | "scenic-teams"
  | "schedule"
  | "members"
  | "uniforms"
  | "facilities"
  | "org-home"
  | "thunder-home"
  | "org-teams"
  | "org-members"
  | "org-facilities"
  | ScenicTab;
type ScenicTab = "scenic-home" | "programs" | "scheduler" | "scenic-facilities" | "scenic-members";
export type TeamTab = "staff" | "roster" | "uniforms" | "practices";

// Events the person runs check-in for (from yesterday on), plus their teams' practices today.
async function checkInsFor(user: SessionUser): Promise<number> {
  const deps = { pool: db, now: () => new Date() };
  const t = localParts(new Date());
  const start = zonedTime(t.year, t.month, t.day);
  const next = new Date(Date.UTC(t.year, t.month - 1, t.day + 1));
  const end = zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  const [events, practices] = await Promise.all([myEventCount(deps, user), myPracticesToday(deps, user, start, end)]);
  return events + practices;
}

// Sticky top bar: the organization's brand, the user, one chip per role to switch between them, and the Director tabs.
// `context` is the role this page is shown as ("director", "team:<id>" or "scenic:<role>"); it highlights that chip and picks
// the organization (Thunder unless it's a Scenic City role). Thunder's chat, bell and check-in only show in Thunder.
// `teamTab`: on a team page seen as its staff, the Staff / Roster / Uniforms / Practices menu (top on a computer, bottom on
// a phone). `alert` makes that tab flash red (Uniforms, while any player's number or size is missing).
export default async function AppHeader({
  user,
  tab,
  context,
  teamTab,
}: {
  user: SessionUser;
  tab?: Tab;
  context?: string;
  teamTab?: { teamId: string; tab: TeamTab; alert?: TeamTab[] };
}) {
  const deps = { pool: db, now: () => new Date() };
  // The CourtCaptain page (admins) has the platform's own brand and no organization tools.
  const platform = context === "platform";
  // The organization this page belongs to: Scenic City's chips, a registered organization's chip ("org:<slug>"), or Thunder.
  const org = context?.startsWith("scenic:") ? "scenic-city" : context?.startsWith("org:") ? context.slice(4) : "thunder";
  const [orgs, here] = await Promise.all([listOrgs(db), platform ? null : orgInfo(db, org)]);
  // Someone in no organization yet (a CourtCaptain account): CourtCaptain's own brand, no organization's.
  const neutral = !platform && !context && !user.hasThunderRole && !user.isFamily && !user.requestPending;
  const brand =
    platform || neutral
      ? {
          name: PLATFORM_BRAND.name,
          logo: PLATFORM_BRAND.logo.src as string | null,
          color: "#f97316",
          login: PLATFORM_BRAND.login,
        }
      : {
          name: here?.name ?? "CourtCaptain",
          logo: here?.logo ?? null,
          color: here?.color ?? "#1d4ed8",
          login: here?.login ?? "/login",
        };
  const thunder = !platform && org === "thunder" && user.hasThunderRole;
  const [{ contexts }, features, unread, myEvents, popups, chatUnread, articles, chats] = await Promise.all([
    currentContexts(user),
    orgFeatures(db, org),
    thunder ? unreadCount(deps, user) : 0,
    thunder && !user.isDirector ? checkInsFor(user) : 0,
    // Not while a Director is viewing as this person.
    user.actingBy || !thunder ? [] : popupAnnouncements(deps, user),
    thunder ? chatUnreadCount(deps, user) : 0,
    // Support (the same everywhere): its questions and guides, this person's chats, and the chats they answer
    // (CourtCaptain staff: all; an organization's Owners and Admins: the ones started there).
    listArticles(db),
    supportChats(db, user, platform ? null : org),
  ]);
  // Only the features this organization has (SPEC section 14); tabs with no feature are always there.
  const has = (t: { feature?: Feature }) => !t.feature || features.has(t.feature);
  const chatOn = features.has("chat");
  const supportStaff = contexts.some((c) => c.key === "platform");
  // Chips for this organization only; the logo next to Log out switches organizations (SPEC section 14).
  const orgChips = platform ? [] : contexts.filter((c) => c.org === org);
  const switchTo = [
    ...(contexts.some((c) => c.key === "platform")
      ? [{ slug: PLATFORM, name: "CourtCaptain", logo: PLATFORM_BRAND.logo.src }]
      : []),
    ...orgs
      .filter((o) => contexts.some((c) => c.org === o.slug) || (o.slug === "thunder" && user.hasThunderRole))
      .map((o) => ({ slug: o.slug, name: o.name, logo: o.logo, color: o.color })),
  ];
  // Backup for the sheet timer: after this page is sent, refresh registrations if the last check is stale.
  after(syncIfStale);
  // One page view for this organization (Home metrics), after the page is sent.
  if (!platform && !neutral)
    after(() => recordVisit(deps, user, org).catch((e) => console.error("Recording a visit failed:", e)));
  // `areas`: Director tabs show only for a Director with one of these areas (Admins have all; SPEC section 14).
  // `admin`: Admins only.
  const scheduleHref =
    features.has("practice") && hasArea(user, "practices")
      ? "/org/thunder/practice"
      : features.has("events") && hasArea(user, "events")
        ? "/events"
        : null;
  type TabLink = { key: string; href: string; label: string; icon: string; feature?: Feature; areas?: Area[]; admin?: boolean };
  // Every organization's tabs, in one order: Home · Teams · Programs · Schedule · Uniforms · Facilities · Members (each
  // shown only when its features and the person's role allow), then the gear for Admins.
  const directorTabs: TabLink[] = [
    { key: "thunder-home", href: "/org/thunder", label: "Home", icon: ICONS.home },
    { key: "teams", href: "/org/thunder/teams", label: "Teams", icon: ICONS.teams, feature: "team-building", areas: ["teams"] },
    // Schedule: Practice and Season (Facilities, Practice Management), Events (Programs, Event Management); opens the first.
    ...(scheduleHref ? [{ key: "schedule", href: scheduleHref, label: "Schedule", icon: ICONS.practice }] : []),
    {
      key: "uniforms",
      href: "/org/thunder/uniforms",
      label: "Uniforms",
      icon: ICONS.uniforms,
      feature: "uniforms",
      areas: ["uniforms"],
    },
    {
      key: "facilities",
      href: "/org/thunder/facilities",
      label: "Facilities",
      icon: ICONS.facilities,
      areas: ["facilities", "practices"],
    },
    // Members: Staff (Admins), Coaches (Teams area), Players (Players or Teams areas); opens the first one they can see.
    ...(isThunderAdmin(user) || hasArea(user, "teams", "players")
      ? [{ key: "members", href: "/org/thunder/members", label: "Members", icon: ICONS.users }]
      : []),
  ];
  // Scenic City: Home and Game days for everyone there, Partners for Partners and Directors of Facilities, Teams for
  // everyone but Directors without the Teams area, Users for Admins.
  const scenicContext = contexts.find((c) => c.key === context);
  const scenicRole = scenicContext?.key.startsWith("scenic:") && "role" in scenicContext ? scenicContext.role : undefined;
  const [scenicAreas, scenicAdmin] =
    org === "scenic-city" && scenicRole === "Director"
      ? await Promise.all([directorAreas(db, user.coachId, "scenic-city"), isOrgAdmin(db, user.coachId, "scenic-city")])
      : [[] as Area[], false];
  // A registered organization: Home, Teams (Team Management: Admins and Directors of Teams, or its coaches) and
  // Facilities. Its Admins manage features from the gear on Home.
  const registered = !platform && context?.startsWith("org:");
  const regFacilities = registered && (await canHost(db, org)) && (await orgHasArea(db, user.coachId, org, "facilities"));
  // Members: Staff for its Admins, Coaches for Admins and Directors of Coaches or Teams (with Team Management).
  const regMembers =
    registered &&
    ((await isOrgAdmin(db, user.coachId, org)) ||
      (features.has("team-building") && (await orgHasArea(db, user.coachId, org, "teams"))));
  const regTeams =
    registered &&
    features.has("team-building") &&
    ((await orgHasArea(db, user.coachId, org, "teams")) ||
      !!(
        await db.query(
          "select 1 from org_team_coaches c join org_teams t on t.id = c.team_id where t.org = $1 and c.coach_id = $2 limit 1",
          [org, user.coachId],
        )
      ).rowCount);
  const orgTabs: TabLink[] | null = registered
    ? [
        { key: "org-home", href: `/org/${org}`, label: "Home", icon: ICONS.home },
        ...(regTeams ? [{ key: "org-teams", href: `/org/${org}/teams`, label: "Teams", icon: ICONS.teams }] : []),
        ...(regFacilities
          ? [{ key: "org-facilities", href: `/org/${org}/facilities`, label: "Facilities", icon: ICONS.facilities }]
          : []),
        ...(regMembers ? [{ key: "org-members", href: `/org/${org}/members`, label: "Members", icon: ICONS.users }] : []),
      ]
    : null;
  const scenicTabs: TabLink[] | null =
    org === "scenic-city" && scenicRole
      ? [
          { key: "scenic-home", href: "/org/scenic-city", label: "Home", icon: ICONS.home },
          // Teams (like every organization's), Programs, Facilities (Game days and hosting sites), Members (Staff,
          // hosting sites' Owners and Admins, Coaches). A Director sees the ones their areas cover; everyone else sees
          // Teams, Programs and Facilities (Game days).
          ...(scenicRole !== "Director" || scenicAreas.includes("teams")
            ? [
                {
                  key: "scenic-teams",
                  href: "/org/scenic-city/teams",
                  label: "Teams",
                  icon: ICONS.teams,
                  feature: "team-registration" as const,
                },
              ]
            : []),
          ...(scenicRole !== "Director" || scenicAreas.some((a) => a === "programs" || a === "teams")
            ? [
                {
                  key: "programs",
                  href: "/org/scenic-city/programs",
                  label: "Programs",
                  icon: ICONS.events,
                  feature: "programs" as const,
                },
              ]
            : []),
          // Scheduler: who plays on each Game Day (Admins and Directors of Scheduling, on the Director chip).
          ...(scenicRole === "Director" && scenicAreas.includes("scheduling")
            ? [
                {
                  key: "scheduler",
                  href: "/org/scenic-city/scheduler",
                  label: "Scheduler",
                  icon: ICONS.practice,
                  feature: "programs" as const,
                },
              ]
            : []),
          {
            key: "scenic-facilities",
            href: "/org/scenic-city/game-days",
            label: "Facilities",
            icon: ICONS.facilities,
            feature: "hosting-partners" as const,
          },
          ...(scenicRole === "Director" &&
          (scenicAdmin || scenicAreas.some((a) => ["facilities", "teams", "programs"].includes(a)))
            ? [
                {
                  key: "scenic-members",
                  href: scenicAdmin
                    ? "/org/scenic-city/users"
                    : scenicAreas.includes("facilities")
                      ? "/org/scenic-city/members/hosting-sites"
                      : "/org/scenic-city/members/coaches",
                  label: "Members",
                  icon: ICONS.users,
                },
              ]
            : []),
        ]
      : null;
  const tabs = (
    orgTabs
      ? orgTabs
      : scenicTabs
        ? scenicTabs
        : teamTab
          ? ([
              { key: "staff", href: `/org/thunder/teams/${teamTab.teamId}`, label: "Staff", icon: ICONS.teams },
              { key: "roster", href: `/org/thunder/teams/${teamTab.teamId}?tab=roster`, label: "Roster", icon: ICONS.roster },
              {
                key: "uniforms",
                href: `/org/thunder/teams/${teamTab.teamId}?tab=uniforms`,
                label: "Uniforms",
                icon: ICONS.uniforms,
                feature: "uniforms",
              },
              {
                key: "practices",
                href: `/org/thunder/teams/${teamTab.teamId}?tab=practices`,
                label: "Practices",
                icon: ICONS.practice,
                feature: "practice",
              },
            ] satisfies TabLink[])
          : directorTabs.filter((t) => (!t.areas || hasArea(user, ...t.areas)) && (!t.admin || isThunderAdmin(user)))
  ).filter(has);
  const activeTab: string | undefined = teamTab ? teamTab.tab : tab;
  const alerting = (key: string) => !!teamTab?.alert?.includes(key as TeamTab);
  const showTabs = !!orgTabs || !!scenicTabs || !!teamTab || (user.isDirector && context === "director");
  const activeBg = scenicTabs ? "bg-scenic-navy" : "bg-thunder-blue";
  // A registered organization's own color (set in its gear) marks the tab in use; Thunder and Scenic City keep theirs.
  const tabColor = registered ? brand.color : null;
  // The gear (features, logo, color, login link) after the last tab, for the organization's Admins.
  const gear = showTabs && !teamTab && !platform && (await isOrgAdmin(db, user.coachId, org));
  // Thunder's Chat and Alerts icons (the organization's chat and announcements).
  const orgIcons = (
    <>
      {thunder &&
        chatOn &&
        // Directors: the bubble chats with every Head Coach (the full list is linked inside).
        (user.isDirector ? (
          <ChatPopup chatKey={`heads-${user.coachId}`} label="Chat with all Head Coaches" className={headerBtn} allChats>
            <HeaderIcon d={ICONS.chat} badge={chatUnread} />
          </ChatPopup>
        ) : (
          <Link href="/chat" aria-label={chatUnread ? `Chat, ${chatUnread} unread` : "Chat"} className={headerBtn}>
            <HeaderIcon d={ICONS.chat} badge={chatUnread} />
          </Link>
        ))}
      {thunder &&
        // Directors: the bell notifies all team staff (their own announcements are linked inside).
        (user.isDirector ? (
          <NotifyButton audience={{ roles: ALL_STAFF }} to="all team staff" className={headerBtn} inbox>
            <HeaderIcon d={ICONS.bell} badge={unread} />
          </NotifyButton>
        ) : (
          <Link
            href="/inbox"
            prefetch={false}
            aria-label={unread ? `Announcements, ${unread} unread` : "Announcements"}
            className={headerBtn}
          >
            <HeaderIcon d={ICONS.bell} badge={unread} />
          </Link>
        ))}
    </>
  );

  return (
    <>
      <header
        style={{ borderTopColor: brand.color }}
        className={`sticky top-0 z-10 border-t-[3px] border-b border-zinc-950/5 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/80`}
      >
        {user.actingBy && (
          <form
            action={stopActing}
            className="flex items-center justify-between gap-3 bg-thunder-orange px-4 py-2 text-sm font-medium text-white"
          >
            <span className="min-w-0 truncate">
              👁 Viewing as {user.firstName} {user.lastName} · view only
            </span>
            <button type="submit" className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-thunder-orange">
              Stop
            </button>
          </form>
        )}
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <OrgLogo src={brand.logo} name={brand.name} color={brand.color} className="h-9 w-auto min-w-9 rounded-md" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-semibold tracking-tight">{brand.name}</span>
              {!neutral && (
                <span className="block text-xs font-medium text-thunder-orange">
                  {platform ? "Platform admin" : "CourtCaptain"}
                </span>
              )}
            </span>
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            {myEvents > 0 && (
              <Link
                href="/events"
                className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white hover:bg-emerald-700"
              >
                ✓ Check-in
              </Link>
            )}
            {/* With tabs, Chat and Alerts sit by the gear on the tab row (computers); on phones they stay up here. */}
            {showTabs ? <span className="flex items-center gap-1 sm:hidden">{orgIcons}</span> : orgIcons}
            {!showTabs && (
              <SupportButton
                org={org}
                articles={articles}
                mine={chats.mine}
                inbox={chats.inbox}
                staff={supportStaff}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-zinc-600 ring-1 ring-zinc-950/10 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-white/15"
              />
            )}
            <Link href="/me" className="hidden truncate text-sm font-medium hover:underline sm:block">
              {user.firstName} {user.lastName}
            </Link>
            <span className={switchTo.length > 1 ? "hidden sm:block" : undefined}>
              <Link href="/me" aria-label="My dashboard" title="My dashboard">
                <Avatar first={user.firstName} last={user.lastName} tone="orange" />
              </Link>
            </span>
            {switchTo.length > 0 && <OrgSwitcher current={platform ? PLATFORM : org} orgs={switchTo} />}
            <LogoutButton to={brand.login} />
          </div>
        </div>

        {orgChips.length > 1 && (
          <nav aria-label="Switch role" className="mx-auto max-w-3xl">
            <div className="flex items-center gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
              {orgChips.map((c) => {
                const on = c.key === context;
                return (
                  <a
                    key={c.key}
                    href={`/switch?to=${encodeURIComponent(c.key)}`}
                    aria-current={on ? "true" : undefined}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset transition-colors ${
                      on
                        ? c.org === "thunder"
                          ? "bg-thunder-orange text-white ring-thunder-orange"
                          : "bg-scenic-navy text-white ring-scenic-navy dark:bg-white dark:text-scenic-navy dark:ring-white"
                        : "bg-white text-zinc-600 ring-zinc-950/10 hover:text-zinc-900 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-white/15"
                    }`}
                  >
                    {c.label}
                  </a>
                );
              })}
            </div>
          </nav>
        )}

        {/* Tablets and computers: tabs under the header. */}
        {showTabs && (
          <nav
            aria-label={scenicTabs ? "Scenic City" : teamTab ? "Team" : "Director"}
            className="mx-auto hidden max-w-3xl px-4 pb-3 sm:block"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
                {tabs.map((t) => (
                  <Link
                    key={t.key}
                    href={t.href}
                    aria-current={activeTab === t.key ? "page" : undefined}
                    style={activeTab === t.key && tabColor && !alerting(t.key) ? { backgroundColor: tabColor } : undefined}
                    className={`rounded-full px-5 py-1.5 text-center text-sm font-medium whitespace-nowrap transition-colors ${
                      alerting(t.key)
                        ? "flash-red"
                        : activeTab === t.key
                          ? `${tabColor ? "" : activeBg} text-white shadow-sm`
                          : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                    }`}
                  >
                    {t.label}
                    {alerting(t.key) && <span className="sr-only"> (info missing)</span>}
                  </Link>
                ))}
                {/* Support, the same everywhere, last in the tab menu. */}
                <SupportButton
                  org={org}
                  articles={articles}
                  mine={chats.mine}
                  inbox={chats.inbox}
                  staff={supportStaff}
                  className="rounded-full px-5 py-1.5 text-center text-sm font-medium whitespace-nowrap text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                />
              </div>
              {/* Far right: Chat and Alerts, then the gear. */}
              <div className="flex shrink-0 items-center gap-1">
                {orgIcons}
                {gear && <OrgGear org={org} coachId={user.coachId} />}
              </div>
            </div>
          </nav>
        )}
      </header>
      {popups.length > 0 && <AnnouncementPopup items={popups} />}

      {/* Phones: a tab bar along the bottom, every tab visible, within thumb reach. Kept outside the header,
        whose blur effect would otherwise pin it to the header instead of the screen. */}
      {showTabs && (
        <nav
          id="bottom-tabs"
          aria-label={scenicTabs ? "Scenic City" : teamTab ? "Team" : "Director"}
          className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-950/10 bg-white/95 backdrop-blur-xl sm:hidden dark:border-white/10 dark:bg-zinc-950/95"
        >
          <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length + (gear ? 1 : 0)}, minmax(0, 1fr))` }}>
            {tabs.map((t) => {
              const on = activeTab === t.key;
              return (
                <Link
                  key={t.key}
                  href={t.href}
                  aria-current={on ? "page" : undefined}
                  className={`relative flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium ${
                    alerting(t.key)
                      ? "flash-red-text"
                      : on
                        ? scenicTabs
                          ? "text-scenic-navy dark:text-white"
                          : "text-thunder-blue dark:text-blue-400"
                        : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {on && (
                    <span
                      className={`absolute inset-x-3 top-0 h-0.5 rounded-full ${tabColor ? "" : activeBg}`}
                      style={tabColor ? { backgroundColor: tabColor } : undefined}
                    />
                  )}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={on ? 2 : 1.6}
                    aria-hidden
                    className="size-6"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
                  </svg>
                  {t.label}
                  {alerting(t.key) && <span className="sr-only"> (info missing)</span>}
                </Link>
              );
            })}
            {gear && (
              <div className="flex items-center justify-center">
                <OrgGear org={org} coachId={user.coachId} />
              </div>
            )}
          </div>
          {/* A strip under the tabs for the host's "Powered by" badge (bottom right), so it never covers a tab.
            Also clears the iPhone home bar. Support fills the free left side. */}
          <div className="flex h-[max(3.75rem,env(safe-area-inset-bottom))] items-center px-4">
            <SupportButton
              org={org}
              articles={articles}
              mine={chats.mine}
              inbox={chats.inbox}
              staff={supportStaff}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 dark:text-blue-400"
            />
          </div>
        </nav>
      )}
    </>
  );
}

const ALL_STAFF = ["HeadCoach", "AsstCoach", "Manager", "TeamParent"];

const headerBtn =
  "relative rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white";

// A header icon with its red unread count.
function HeaderIcon({ d, badge }: { d: string; badge: number }) {
  return (
    <>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden className="size-6">
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
      {badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white tabular-nums">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </>
  );
}

// Outline icons (Heroicons) for the header and the phone tab bar.
const ICONS = {
  facilities:
    "M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z",
  features:
    "M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 0 0 2.25-2.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v2.25A2.25 2.25 0 0 0 6 10.5Zm0 9.75h2.25A2.25 2.25 0 0 0 10.5 18v-2.25a2.25 2.25 0 0 0-2.25-2.25H6a2.25 2.25 0 0 0-2.25 2.25V18A2.25 2.25 0 0 0 6 20.25Zm9.75-9.75H18a2.25 2.25 0 0 0 2.25-2.25V6A2.25 2.25 0 0 0 18 3.75h-2.25A2.25 2.25 0 0 0 13.5 6v2.25a2.25 2.25 0 0 0 2.25 2.25Z",
  home: "m2.25 12 8.954-8.955a1.126 1.126 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25",
  chat: "M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z",
  bell: "M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0",
  teams:
    "M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z",
  uniforms: "M9 3.75 6 4.5 3 7.5l2.25 3L7.5 9.75V20.25h9V9.75l2.25.75L21 7.5l-3-3-3-.75a3 3 0 0 1-6 0Z",
  roster:
    "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z",
  practice:
    "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5",
  events: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  users:
    "M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  players:
    "M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z",
  coaches:
    "M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5",
};
