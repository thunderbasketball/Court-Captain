// CourtSolo (SPEC.md section 14): a stand-alone team is its own small CourtCaptain account: an organization of kind
// 'Team' named for the team, with the court-solo feature and one team. Its Head Coach is its Owner (also Admin and
// Director). It registers into Scenic City's programs like any organization's team; its copy there is named just the
// team's name and shows "(Solo)".
import { featuresChanged } from "./features";
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { partnerFor } from "./org-leagues";
import { abbrFor, renameOrg } from "./org-signup";
import { slugFor } from "./org-slug";
import { dropScenicCoachIfIdle } from "./scenic-teams";
import type { Queryable } from "./sql";

import { SOLO_KIND } from "./solo-names";

// An Abbreviation for the account (never shown in leagues: Solo teams show "(Solo)").
const abbrOf = (name: string) =>
  (
    name
      .replace(/[^A-Za-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "TEAM"
  ).slice(0, 6);

// Make the CourtSolo account for a Scenic City team that a Solo coach owns (owner_coach_id), and move the team under it:
// the organization, its Owner, the court-solo feature, its one team (with its Head Coach), and the Scenic City copy
// pointing at it. Run inside the caller's transaction. Returns the new account's slug.
export async function makeSoloAccount(
  q: Pick<Queryable, "query">,
  scenicTeamId: string,
  byName: string,
  now: Date,
): Promise<string> {
  const t = (
    await q.query<{
      name: string;
      gender: string;
      grade_low: number;
      grade: number;
      level: string;
      owner: string;
      coach: string | null;
    }>(
      `select name, gender, grade_low, grade, level, owner_coach_id as owner, coach_id as coach from scenic_teams
        where id = $1 and owner_coach_id is not null and org_team_id is null for update`,
      [scenicTeamId],
    )
  ).rows[0];
  if (!t) throw new Error("That team isn't a Solo team.");
  // The account's name is the team's; numbered if another organization already has it.
  let name = t.name;
  for (let n = 2; (await q.query("select 1 from organizations where lower(name) = lower($1)", [name])).rowCount; n++)
    name = `${t.name} ${n}`;
  const base = slugFor(name);
  let slug = base;
  for (let n = 2; (await q.query("select 1 from organizations where slug = $1", [slug])).rowCount; n++) slug = `${base}-${n}`;
  await q.query(
    `insert into organizations (slug, name, short_name, kind, color, created_by, created_at, abbr)
     values ($1, $2, $3, $4, '#13294b', $5, $6, $7)`,
    [slug, name, name.slice(0, 20), SOLO_KIND, byName, now, abbrOf(name)],
  );
  await q.query(
    "insert into org_role_types (org, role) select $1, r from unnest(array['Request', 'Coach', 'Director', 'Admin', 'Owner']) r",
    [slug],
  );
  await q.query(
    "select set_role($1, $2, 'Owner', true, $3), set_role($1, $2, 'Admin', true, $3), set_role($1, $2, 'Director', true, $3)",
    [t.owner, slug, byName],
  );
  await q.query(
    "insert into org_features (org, feature, source, turned_on_by, turned_on_at) values ($1, 'court-club', 'setup', $2, $3)",
    [slug, byName, now],
  );
  featuresChanged();
  const team = await q.query<{ id: string }>(
    `insert into org_teams (org, name, gender, grade_low, grade, level, created_by, created_at, own_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, true) returning id::text`,
    [slug, name, t.gender, t.grade_low, t.grade, t.level, byName, now],
  );
  if (t.coach) {
    await q.query(
      "insert into org_team_coaches (team_id, coach_id, role, added_by, added_at) values ($1, $2, 'HeadCoach', $3, $4)",
      [team.rows[0].id, t.coach, byName, now],
    );
    await q.query("select set_role($1, $2, 'Coach', true, $3)", [t.coach, slug, byName]);
  }
  const partner = await partnerFor(q, slug, byName);
  await q.query(
    "update scenic_teams set org_team_id = $2, partner_id = $3, owner_coach_id = null, name = $4, updated_by = $5, updated_at = $6 where id = $1",
    [scenicTeamId, team.rows[0].id, partner, name, byName, now],
  );
  await dropScenicCoachIfIdle(q, t.coach, byName); // a Coach in its own account now, not in Scenic City
  return slug;
}

// ---- A person's accounts, when they register again (Register a team, Register your organization) ----

export type SoloAccount = {
  slug: string;
  name: string;
  teamId: string | null; // its active team
  teamName: string | null;
  busyIn: string | null; // an event its team is in that hasn't ended (it can't be archived until then)
  inPrograms: string[]; // the events (program ids) its team is registered in
};
export type OrgAccount = { slug: string; name: string };

// The CourtSolo accounts this person owns, and the organizations with CourtOrg they're an Admin of (their own roles:
// CourtCaptain staff's background access doesn't count).
export async function myAccounts(
  q: Pick<Queryable, "query">,
  coachId: string,
  today: string,
): Promise<{ solo: SoloAccount[]; orgs: OrgAccount[] }> {
  const [solo, orgs] = await Promise.all([
    q.query<SoloAccount>(
      `select o.slug, o.name, t.id::text as "teamId", t.name as "teamName",
              (select p.name from scenic_teams st join scenic_registrations r on r.team_id = st.id
                 join scenic_programs p on p.id = r.program_id
                where st.org_team_id = t.id and r.removed_by is null and p.ends_on >= $3::date
                order by p.starts_on limit 1) as "busyIn",
              array(select r.program_id::text from scenic_teams st join scenic_registrations r on r.team_id = st.id
                     where st.org_team_id = t.id and r.removed_by is null order by r.program_id) as "inPrograms"
         from organizations o
         left join org_teams t on t.org = o.slug and t.archived_at is null
        where o.kind = $2 and has_role($1, o.slug, 'Owner')
        order by lower(o.name)`,
      [coachId, SOLO_KIND, today],
    ),
    q.query<OrgAccount>(
      `select o.slug, o.name from organizations o
        where o.kind <> $2 and has_role($1, o.slug, 'Admin')
          and exists (select 1 from org_features f where f.org = o.slug and f.feature = 'court-club')
        order by lower(o.name)`,
      [coachId, SOLO_KIND],
    ),
  ]);
  return { solo: solo.rows, orgs: orgs.rows };
}

// Archive a CourtSolo account's active team and put a new Scenic City team (made by Register a team, owned by the
// coach) in its place: one active team per account. The archived team keeps its games and registrations as history and
// can't register again; not allowed while it's in an event that hasn't ended. The account takes the new team's name.
// Run inside the caller's transaction.
export async function replaceSoloTeam(
  q: Pick<Queryable, "query">,
  slug: string,
  ownerId: string,
  scenicTeamId: string,
  byName: string,
  now: Date,
  today: string,
): Promise<void> {
  const acct = (await myAccounts(q, ownerId, today)).solo.find((a) => a.slug === slug);
  if (!acct) throw new Error("That isn't your team's account.");
  if (acct.busyIn) throw new Error(`${acct.teamName} is still in ${acct.busyIn}: it can be archived once that ends.`);
  await q.query("select 1 from organizations where slug = $1 for update", [slug]);
  if (acct.teamId)
    await q.query("update org_teams set archived_by = $2, archived_at = $3 where id = $1", [acct.teamId, byName, now]);
  const t = (
    await q.query<{ name: string; gender: string; grade_low: number; grade: number; level: string; coach: string | null }>(
      `select name, gender, grade_low, grade, level, coach_id as coach from scenic_teams
        where id = $1 and owner_coach_id is not null and org_team_id is null for update`,
      [scenicTeamId],
    )
  ).rows[0];
  if (!t) throw new Error("That team isn't a new Solo team.");
  await q.query("update organizations set name = $2, short_name = $3 where slug = $1", [slug, t.name, t.name.slice(0, 20)]);
  await q.query("update partners set name = $2 where org_slug = $1", [slug, t.name]);
  const team = await q.query<{ id: string }>(
    `insert into org_teams (org, name, gender, grade_low, grade, level, created_by, created_at, own_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, true) returning id::text`,
    [slug, t.name, t.gender, t.grade_low, t.grade, t.level, byName, now],
  );
  if (t.coach) {
    await q.query(
      "insert into org_team_coaches (team_id, coach_id, role, added_by, added_at) values ($1, $2, 'HeadCoach', $3, $4)",
      [team.rows[0].id, t.coach, byName, now],
    );
    await q.query("select set_role($1, $2, 'Coach', true, $3)", [t.coach, slug, byName]);
  }
  const partner = await partnerFor(q, slug, byName);
  await q.query(
    "update scenic_teams set org_team_id = $2, partner_id = $3, owner_coach_id = null, updated_by = $4, updated_at = $5 where id = $1",
    [scenicTeamId, team.rows[0].id, partner, byName, now],
  );
  await dropScenicCoachIfIdle(q, t.coach, byName);
}

// Switch a CourtSolo account to CourtOrg (its Owner): it becomes an organization with the name they give (its address
// and Abbreviation follow), CourtSolo off and CourtOrg on, and its team comes along keeping its own name (in leagues with
// the organization's Abbreviation first, "HH Magic"). New teams there follow the usual naming rule.
export async function switchSoloToOrg(
  deps: { pool: Pool; now: () => Date },
  viewer: SessionUser,
  slug: unknown,
  input: { name: unknown; short: unknown },
): Promise<{ ok: true; slug: string } | { ok: false; message: string }> {
  if (typeof slug !== "string") return { ok: false, message: "Pick your team's account." };
  const mine = await deps.pool.query(
    "select 1 from organizations where slug = $1 and kind = $2 and has_role($3, slug, 'Owner')",
    [slug, SOLO_KIND, viewer.coachId],
  );
  if (!mine.rowCount) return { ok: false, message: "Only the Owner of a one-team club can switch it to a club with more teams." };
  // Both have CourtClub: switching is the kind (a club of one, or an organization with any number of teams).
  const swap = async (kind: string) => {
    await deps.pool.query("update organizations set kind = $2 where slug = $1", [slug, kind]);
    featuresChanged();
  };
  await swap("Organization");
  const r = await renameOrg(deps, viewer, slug, input);
  if (!r.ok) {
    await swap(SOLO_KIND); // back as it was
    return r;
  }
  const abbr = abbrFor(String(input.name).trim()); // like a new organization's: "Hixson Hoops" → HH
  await deps.pool.query("update organizations set abbr = $2 where slug = $1", [r.slug, abbr]);
  await deps.pool.query(
    `update scenic_teams st set name = $2 || ' ' || t.name from org_teams t where st.org_team_id = t.id and t.org = $1`,
    [r.slug, abbr],
  );
  return { ok: true, slug: r.slug };
}
