import "server-only";
// What an organization's public page shows, read once for the page and for its share pictures (kept 30 seconds; nothing
// about a person). The same for every organization: its features decide.
import { db } from "./db";
import { abilitiesFrom, hasFeature, orgFeatureKeys, syncPart } from "./features";
import { isFor, listArticles, needsMet } from "./support";
import { gamesOfTheWeek } from "./games-of-week";
import { recruitingOn } from "./officials";
import { orgInfo, orgShort } from "./org-registry";
import { isOrgSlug } from "./orgs";
import { publicly } from "./public-cache";
import { orgLeagues, orgPublicTeams, publicLeague, publicPrograms } from "./public-league";
import { hostGames, hostGyms, hostedPrograms, programCounts, programDivisions } from "./public-org";
import { cardVersion, groupCard, shareCards, type ShareCard } from "./share-cards";
import { easternDate } from "./time";

export async function publicFacts(org: string, now: Date) {
  const today = easternDate(now);
  const [showPrograms, signup, players, canHost] = await Promise.all([
    hasFeature(db, org, "programs"),
    hasFeature(db, org, "team-registration"),
    hasFeature(db, org, "player-registration"), // CourtPlayers
    hasFeature(db, org, "hosting-available"),
  ]);
  const [own, playsIn, hosted, teams, gyms, gymDay, seasons, recruiting] = await Promise.all([
    showPrograms ? publicly(`programs:${today}:${org}`, () => publicPrograms(db, now, org)) : [],
    publicly(`leagues:${today}:${org}`, () => orgLeagues(db, now, org)),
    canHost ? publicly(`hosted:${today}:${org}`, () => hostedPrograms(db, now, org)) : [],
    publicly(`teams:${today}:${org}`, () => orgPublicTeams(db, now, org)),
    canHost ? publicly(`gyms:${org}`, () => hostGyms(db, org)) : [],
    canHost ? publicly(`gymday:${today}:${org}`, () => hostGames(db, now, org)) : null,
    players ? publicly(`seasons:${today}:${org}`, () => publicSeasons(org, today)) : [],
    publicly(`recruiting:${org}`, () => recruitingOn(db, org)),
  ]);
  // The Leagues (another organization's programs) its teams are in, or its gyms host.
  const leagues = await Promise.all(
    [...playsIn, ...hosted.filter((h) => h.org !== org && !playsIn.some((p) => p.id === h.id))].map(async (p) => ({ ...p, orgName: await orgShort(db, p.org) })),
  );
  const currentIds = own.filter((p) => p.endsOn >= today).map((p) => p.id);
  const [counts, week] = await Promise.all([
    publicly(`counts:${today}:${org}`, () => programCounts(db, currentIds)),
    own.length ? publicly(`week:${today}:${org}`, () => gamesOfTheWeek(db, now, org)) : null,
  ]);
  return { today, teamSignup: showPrograms && signup, players, own, leagues, hosting: hosted.length > 0, teams, gyms, gymDay, seasons, recruiting, counts, week };
}
// The public page's Help: what's for parents and visitors, by this organization's features (no person).
export async function publicHelp(org: string) {
  const [all, keys] = await Promise.all([publicly("support", () => listArticles(db)), orgFeatureKeys(db, org)]);
  const f = { who: new Set(["public"]), has: needsMet(keys, abilitiesFrom, syncPart), areas: new Set<string>() };
  return all.filter((a) => isFor(a, f));
}

export type PublicFacts = Awaited<ReturnType<typeof publicFacts>>;

async function publicSeasons(org: string, today: string) {
  const r = await db.query<{ id: string; name: string; kind: string; reg_closes: string | null; starts_on: string | null; ends_on: string | null }>(
    `select id::text, name, kind, reg_closes::text, starts_on::text, ends_on::text from player_programs
      where org = $1 and reg_opens <= $2::date and (ends_on is null or ends_on >= $2::date - 30)
      order by starts_on nulls last, lower(name)`,
    [org, today],
  );
  return r.rows;
}

// Whether a program here opens (its teams and standings): its own team programs, or the League (Scenic City's for now).
export const anyOpens = (f: PublicFacts) => f.own.length > 0 || f.leagues.some((l) => l.org === "scenic-city");

// The share pictures on its page, each with its version (a changed picture gets a new address).
export async function pageCards(org: string, name: string, f: PublicFacts): Promise<{ card: ShareCard; v: string }[]> {
  const own = await Promise.all(
    f.own.map(async (p) => ({
      ...p,
      register: f.teamSignup && p.registering,
      divisions: f.teamSignup && p.registering ? await publicly(`divisions:${p.id}`, () => programDivisions(db, p.id)) : [],
    })),
  );
  const cards = shareCards({
    org,
    name,
    today: f.today,
    own,
    leagues: f.leagues,
    teams: f.teams.length,
    counts: f.counts,
    gyms: f.gyms,
    hosting: f.hosting,
    recruiting: f.recruiting.map((r) => r.name),
    openable: anyOpens(f),
    week: f.week,
  });
  return cards.map((card) => ({ card, v: cardVersion(card) }));
}

// One picture by its address: the page's, or a grade group's standings or games in one of the organization's own programs.
export async function findCard(org: unknown, key: unknown, now: Date): Promise<{ org: NonNullable<Awaited<ReturnType<typeof orgInfo>>>; card: ShareCard; v: string } | null> {
  if (!isOrgSlug(org) || typeof key !== "string" || !/^[a-z0-9.-]{1,90}$/.test(key)) return null;
  const o = await orgInfo(db, org);
  if (!o) return null;
  const program = /^(?:standings|schedule)\.(\d{1,18})\./.exec(key)?.[1];
  if (program) {
    if (!(await hasFeature(db, org, "programs"))) return null;
    const today = easternDate(now);
    const league = await publicly(`program:${today}:${org}:${program}`, () => publicLeague(db, now, program, org));
    const card = league && groupCard(org, league, key, today);
    return card ? { org: o, card, v: cardVersion(card) } : null;
  }
  const hit = (await pageCards(org, o.name, await publicFacts(org, now))).find((c) => c.card.key === key);
  return hit ? { org: o, ...hit } : null;
}
