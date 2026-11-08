// FastBreak Compete → Scenic City's League (SPEC.md section 13). Teams registered in Fastbreak for a current League
// are added here as outside clubs' teams, all COMP, named with "(FB)" after them, and registered for just the dates
// they signed up for there: each single-day event on one of the League's Game Days is 1 Game – Single Day that day (a
// team in every week is in each week's event). Other events (ALL SEASON, the Championship, archived ones) are ignored.
// Only outside clubs: a Fastbreak organization on CourtCaptain is skipped (it registers its own teams here). Each
// Fastbreak organization is decided once (fastbreak_orgs): matched to an outside club by the same name, or to an
// organization on CourtCaptain by its name or initials (both "Fastbreak (auto)"); any other waits for a Director to
// pick. Nothing is ever removed here, and a team already added is never changed except to add what it registered for.
// Who did it: "Fastbreak". A dry run does it all, reports, and rolls back.
import type { Pool, PoolClient } from "pg";
import { cleanName } from "../auth/validate";
import { TeamError, resolveHead } from "../org-teams";
import { normalizeCell } from "../phone";
import { clubAbbr, insertTeam, type Club } from "../scenic-club-teams";
import { cleanPlaceName } from "../scenic-partners";
import { saveChoice } from "../scenic-programs";
import { withTx } from "../sql";
import { gradeStr, leagueName, placeName, teamName, type Gender, type NamedTeam } from "../team-names";
import { easternDate } from "../time";
import type { FastbreakClient, FbEvent, FbTeam } from "./client";

export const FASTBREAK_BY = "Fastbreak";
export const FASTBREAK_AUTO = "Fastbreak (auto)";
export const FASTBREAK_SYNC = "fastbreak";

type Deps = { pool: Pool; now: () => Date; client: FastbreakClient };

export type FastbreakReport = {
  events: string[]; // "Scenic City Winter Week #02 (26/27) → Winter (26/27) Dec 12"
  added: string[]; // "<team> · <club>"
  registered: string[]; // "<team>: Dec 12, Dec 19"
  waiting: { org: string; teams: number }[]; // Fastbreak organizations to decide
  onCourtCaptain: { org: string; teams: number }[]; // skipped
  problems: string[];
};

// ---- Which organization on CourtCaptain a Fastbreak organization's name points to (or none) ----

const GENERIC =
  /\b(basketball|bball|high|school|youth|association|assiation|athletic|athletics|academy|parks|park|rec|recreation|and|the|of|city|chattanooga|county|tn|club|hoops|inc)\b/g;
const words = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

// "Thunder 36 B Williams", "ER Thunder" → Thunder Basketball; "EHYA" → East Hamilton Youth Association (its initials).
export function courtCaptainMatch(fbName: string, orgs: { name: string }[]): string | null {
  const w = words(fbName);
  for (const o of orgs) {
    const core = words(o.name).replace(GENERIC, " ").replace(/\s+/g, " ").trim();
    const initials = clubAbbr(o.name).toLowerCase();
    if ((core && w.includes(` ${core} `)) || (initials.length >= 3 && w.includes(` ${initials} `))) return o.name;
  }
  return null;
}

// ---- Which League (and what) each Fastbreak event is ----

type League = { id: string; name: string; gameDays: string[] };
type Use = { program: League; day: string };

const short = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

export function eventUse(e: FbEvent, leagues: League[]): Use | null {
  if (e.archived || e.sportId !== 2) return null;
  for (const p of leagues) {
    if (e.type === "single-day" && p.gameDays.includes(e.start)) return { program: p, day: e.start };
  }
  return null;
}

class DryRun extends Error {}

// One run: read Fastbreak, then add and register in one transaction (one run at a time). previewEvents (dry runs only):
// those events (e.g. last winter's weeks) stand for the first current League's Game Days in order, to see what their
// teams would do. asNewClubs
// (dry runs only): organizations still to pick are treated as new outside clubs, to see the teams they'd make.
export async function syncFastbreak(
  deps: Deps,
  opts: { dryRun?: boolean; previewEvents?: number[]; asNewClubs?: boolean } = {},
): Promise<{ status: "done"; report: FastbreakReport } | { status: "busy" } | { status: "failed"; message: string }> {
  const now = deps.now();
  const today = easternDate(now);
  const preview = opts.previewEvents;
  const dryRun = opts.dryRun || !!preview || !!opts.asNewClubs;
  const report: FastbreakReport = { events: [], added: [], registered: [], waiting: [], onCourtCaptain: [], problems: [] };

  // Current Leagues and their Game Days (not Bracket Days).
  const leagues = (
    await deps.pool.query<League>(
      `select p.id::text, p.name,
              array(select to_char(g.day, 'YYYY-MM-DD') from program_game_days pg join game_days g on g.id = pg.game_day_id
                    where pg.program_id = p.id and pg.kind = 'game' order by g.day) as "gameDays"
       from scenic_programs p where p.kind = 'League' and p.ends_on >= $1::date order by p.starts_on, p.id`,
      [today],
    )
  ).rows;

  // Read Fastbreak first (no transaction open while waiting on it).
  const wanted = new Map<number, { team: FbTeam; use: Map<string, { program: League; days: Set<string> }> }>();
  try {
    const events = await deps.client.events();
    const uses: [FbEvent, Use][] = [];
    for (const e of events) {
      const i = preview ? preview.indexOf(e.id) : -1;
      const day = preview && leagues[0]?.gameDays[i];
      const u = preview ? (day ? { program: leagues[0], day } : null) : eventUse(e, leagues);
      if (u) uses.push([e, u]);
    }
    if (preview && !uses.length)
      return { status: "failed", message: "None of those events, or no current League to try them in." };
    for (const [e, u] of uses) {
      report.events.push(`${e.name} → ${u.program.name} ${short(u.day)}`);
      for (const t of await deps.client.teams(e.id)) {
        const w = wanted.get(t.id) ?? { team: t, use: new Map() };
        wanted.set(t.id, w);
        const p = w.use.get(u.program.id) ?? { program: u.program, days: new Set<string>() };
        w.use.set(u.program.id, p);
        p.days.add(u.day);
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!dryRun) await status(deps.pool, now, false, message);
    return { status: "failed", message };
  }

  try {
    const result = await withTx(deps.pool, async (q) => {
      const lock = await q.query<{ ok: boolean }>(
        "select pg_try_advisory_xact_lock(hashtext('sync:fastbreak:' || current_schema())) as ok",
      );
      if (!lock.rows[0].ok) return { status: "busy" as const };
      const orgs = await decideOrgs(
        q,
        now,
        [...wanted.values()].map((w) => w.team),
        !!opts.asNewClubs,
      );
      const tally = (list: { org: string; teams: number }[], org: string) => {
        const x = list.find((o) => o.org === org);
        if (x) x.teams++;
        else list.push({ org, teams: 1 });
      };
      // Sorted: by grade, gender, name.
      const teams = [...wanted.values()].sort(
        (a, b) => a.team.grade - b.team.grade || a.team.genderId - b.team.genderId || a.team.name.localeCompare(b.team.name),
      );
      for (const { team, use } of teams) {
        const org = team.organizationId == null ? undefined : orgs.get(team.organizationId);
        if (!org) {
          report.problems.push(`${team.name}: no organization in Fastbreak.`);
          continue;
        }
        if (org.kind === "skip") {
          tally(report.onCourtCaptain, org.name);
          continue;
        }
        if (org.kind === "waiting") {
          tally(report.waiting, org.name);
          continue;
        }
        await q.query("savepoint fb_team");
        try {
          // Reported only once all of it went in (a failure undoes the team too).
          const done = { added: [] as string[], registered: [] as string[] };
          const id = await teamFor(q, now, team, org.club, done);
          for (const u of use.values()) await register(q, now, today, id, u, done);
          await q.query("release savepoint fb_team");
          report.added.push(...done.added);
          report.registered.push(...done.registered);
        } catch (e) {
          await q.query("rollback to savepoint fb_team");
          if (!(e instanceof TeamError)) throw e;
          report.problems.push(`${team.name} (${org.name}): ${e.message}`);
        }
      }
      // Each team as named now (a later team can have numbered an earlier one).
      const ids = [...new Set([...report.added, ...report.registered].map((x) => x.match(TEAM)?.[1]).filter(Boolean))];
      const names = new Map(
        (await q.query<NamedTeam>("select id::text, name from scenic_teams where id = any($1::bigint[])", [ids])).rows.map(
          (t) => [t.id, t.name],
        ),
      );
      const named = (x: string) => x.replace(TEAM, (_, id: string) => names.get(id) ?? "?");
      report.added = report.added.map(named);
      report.registered = report.registered.map(named);
      report.waiting.sort((a, b) => a.org.localeCompare(b.org));
      report.onCourtCaptain.sort((a, b) => a.org.localeCompare(b.org));
      if (dryRun) throw new DryRun();
      return { status: "done" as const, report };
    });
    if (result.status === "done") await status(deps.pool, now, true, summary(report));
    return result;
  } catch (e) {
    if (e instanceof DryRun) return { status: "done", report };
    throw e;
  }
}

export function summary(r: FastbreakReport) {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const waiting = r.waiting.reduce((s, o) => s + o.teams, 0);
  return [
    `${n(r.added.length, "team")} added`,
    `${n(r.registered.length, "registration")}`,
    waiting && `${n(waiting, "team")} waiting on ${n(r.waiting.length, "organization")} to pick`,
    r.problems.length && n(r.problems.length, "problem"),
  ]
    .filter(Boolean)
    .join(" · ");
}

async function status(pool: Pool, now: Date, ok: boolean, message: string) {
  await pool.query(
    `insert into sync_status (name, checked_at, changed_at, ok, message) values ($1, $2, $2, $3, $4)
     on conflict (name) do update set checked_at = $2, changed_at = case when $3 then $2 else sync_status.changed_at end, ok = $3, message = $4`,
    [FASTBREAK_SYNC, now, ok, message],
  );
}

type OrgDecision = { name: string } & ({ kind: "club"; club: Club } | { kind: "skip" } | { kind: "waiting" });

// Every Fastbreak organization in these teams, decided: new ones are matched by name if they can be, else wait.
async function decideOrgs(q: PoolClient, now: Date, teams: FbTeam[], asNewClubs: boolean): Promise<Map<number, OrgDecision>> {
  const seen = new Map<number, string>();
  const count = new Map<number, number>();
  for (const t of teams)
    if (t.organizationId != null) {
      seen.set(t.organizationId, (t.organizationName ?? "").trim() || `Organization ${t.organizationId}`);
      count.set(t.organizationId, (count.get(t.organizationId) ?? 0) + 1);
    }
  // Teams seen this run: none for organizations not in it now.
  await q.query("update fastbreak_orgs set teams = 0 where teams <> 0 and not (fb_org_id = any($1::bigint[]))", [
    [...seen.keys()],
  ]);
  const out = new Map<number, OrgDecision>();
  if (!seen.size) return out;
  const partners = (
    await q.query<{ id: string; name: string; abbr: string | null; org_slug: string | null }>(
      "select id::text, name, abbr, org_slug from partners where approved order by name",
    )
  ).rows;
  const onCC = partners.filter((p) => p.org_slug);
  const clubs = new Map(partners.filter((p) => !p.org_slug).map((p) => [p.name.toLowerCase(), p]));
  const had = new Map(
    (
      await q.query<{ id: string; partner_id: string | null; skip: boolean }>(
        "select fb_org_id::text as id, partner_id::text, skip from fastbreak_orgs where fb_org_id = any($1::bigint[]) for update",
        [[...seen.keys()]],
      )
    ).rows.map((r) => [Number(r.id), r]),
  );
  for (const [id, name] of seen) {
    let row = had.get(id);
    if (!row) {
      const club = clubs.get(name.toLowerCase());
      const cc = club ? null : courtCaptainMatch(name, onCC);
      row = { id: String(id), partner_id: club?.id ?? null, skip: !!cc };
      await q.query(
        `insert into fastbreak_orgs (fb_org_id, fb_name, partner_id, skip, set_by, set_at, first_seen, teams, last_seen)
         values ($1, $2, $3, $4, $5, $6, $6, $7, $6)`,
        [id, name, row.partner_id, row.skip, club || cc ? FASTBREAK_AUTO : null, now, count.get(id)],
      );
    } else
      await q.query("update fastbreak_orgs set fb_name = $2, teams = $3, last_seen = $4 where fb_org_id = $1", [
        id,
        name,
        count.get(id),
        now,
      ]);
    let p = row.partner_id ? partners.find((x) => x.id === row.partner_id) : undefined;
    const clean = cleanPlaceName(name);
    if (asNewClubs && !p && !row.skip && clean) {
      const n = await q.query<{ id: string }>(
        `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, abbr)
         values ($1, 'Organization', false, true, true, $2, $3) on conflict do nothing returning id::text`,
        [clean, FASTBREAK_BY, clubAbbr(clean)],
      );
      if (n.rows[0]) p = { id: n.rows[0].id, name: clean, abbr: clubAbbr(clean), org_slug: null };
      else
        // Two Fastbreak organizations with one name: the club made for the first.
        p = (
          await q.query<{ id: string; name: string; abbr: string | null; org_slug: string | null }>(
            "select id::text, name, abbr, org_slug from partners where lower(name) = lower($1)",
            [clean],
          )
        ).rows[0];
    }
    // A club that has since joined CourtCaptain is skipped too.
    out.set(
      id,
      row.skip || p?.org_slug
        ? { name, kind: "skip" }
        : p
          ? { name, kind: "club", club: { id: p.id, name: p.name, abbr: p.abbr ?? clubAbbr(p.name) } }
          : { name, kind: "waiting" },
    );
  }
  return out;
}

const FB = " (FB)";
// A team in a report line until the end of the run, when it's replaced by the team's name then.
const ref = (id: string) => `[[team ${id}]]`;
const TEAM = /\[\[team (\d+)\]\]/;

// A Fastbreak team's name: the club's rule name with "(FB)" after it ("LB 4B Long (FB)"), numbered among the club's
// Fastbreak teams when two would match ("TE 8B Simmons 1 (FB)", "TE 8B Simmons 2 (FB)"). Locks the club's names.
async function fbTeamName(q: PoolClient, club: Club, gender: Gender, grades: string[], last: string | null) {
  await q.query("select pg_advisory_xact_lock(hashtext('scenic-club:' || $1))", [club.id]);
  const teams = (
    await q.query<NamedTeam>(
      "select id::text, left(name, -length($2)) as name from scenic_teams where partner_id = $1 and name like '%' || $2",
      [club.id, FB],
    )
  ).rows;
  const { name, renames } = placeName(teams, leagueName(club.abbr, teamName(gender, grades, last ?? "TBD")));
  for (const r of renames) await q.query("update scenic_teams set name = $2 where id = $1", [r.id, r.name + FB]);
  return name + FB;
}

// The Scenic City team for a Fastbreak team: the one added before, or a new COMP team for its club with its Head Coach
// (their login when Fastbreak has a good cell, else waiting for one) and Fastbreak's team name as its Alternate Name.
async function teamFor(q: PoolClient, now: Date, t: FbTeam, club: Club, report: Pick<FastbreakReport, "added">): Promise<string> {
  const had = await q.query<{ id: string }>("select id::text from scenic_teams where fastbreak_id = $1", [t.id]);
  if (had.rows[0]) return had.rows[0].id;
  const gender: Gender | null = t.genderId === 1 ? "Boys" : t.genderId === 2 ? "Girls" : null;
  if (!gender) throw new TeamError("Boys & Girls teams can't be COMP.");
  if (!Number.isInteger(t.grade) || t.grade < 0 || t.grade > 12) throw new TeamError(`grade ${t.grade} isn't K–12.`);
  const staff = t.staff ?? [];
  const s = staff.find((x) => /head/i.test(x.title ?? "")) ?? staff[0];
  const first = cleanName(s?.firstName);
  const last = cleanName(s?.lastName);
  const cell = s?.phone ? normalizeCell(s.phone) : null;
  let head: { coachId: string; lastName: string } | null = null;
  if (first && last && cell) {
    await q.query("savepoint fb_coach");
    try {
      head = await resolveHead(q, { first, last, cell }, now);
      await q.query("release savepoint fb_coach");
    } catch (e) {
      await q.query("rollback to savepoint fb_coach");
      if (!(e instanceof TeamError)) throw e;
    }
  }
  const email = s?.email?.trim().toLowerCase();
  if (head && email && /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/.test(email))
    await q.query("update users set email = $2 where coach_id = $1 and email is null", [head.coachId, email]);
  const waiting = !head && first && last ? { first, last } : null;
  const grades = [gradeStr(t.grade)];
  const name = await fbTeamName(q, club, gender, grades, head?.lastName ?? waiting?.last ?? null);
  const id = await insertTeam(q, FASTBREAK_BY, now, {
    name,
    gender,
    grades,
    level: "COMP",
    club,
    coachId: head?.coachId ?? null,
    alt: cleanPlaceName(t.name) ?? null,
    waiting,
  });
  await q.query("update scenic_teams set fastbreak_id = $2 where id = $1", [id, t.id]);
  report.added.push(`${ref(id)} · ${club.name}`);
  return id;
}

// Register the dates it signed up for in Fastbreak and isn't registered for here yet (past Game Days are left out). A
// team made ALL Season in the app keeps that.
async function register(
  q: PoolClient,
  now: Date,
  today: string,
  teamId: string,
  u: { program: League; days: Set<string> },
  report: Pick<FastbreakReport, "registered">,
) {
  const had = (
    await q.query<{ all_season: boolean; days: string[] }>(
      `select r.all_season, array(select to_char(g.day, 'YYYY-MM-DD') from scenic_registration_days d join game_days g on g.id = d.game_day_id
                                  where d.program_id = r.program_id and d.team_id = r.team_id and d.kind = 'single_1') as days
       from scenic_registrations r where r.program_id = $1 and r.team_id = $2`,
      [u.program.id, teamId],
    )
  ).rows[0];
  const days = had?.all_season ? [] : [...u.days].filter((d) => d >= today && !had?.days.includes(d)).sort();
  if (!days.length) return;
  const r = await saveChoice(
    q,
    u.program.id,
    teamId,
    { allSeason: false, days: days.map((date) => ({ date, kind: "single_1" })) },
    FASTBREAK_BY,
    now,
  );
  if ("error" in r) throw new TeamError(r.error);
  report.registered.push(`${ref(teamId)}: ${days.map(short).join(", ")}`);
}
