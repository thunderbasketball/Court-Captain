import "server-only";
// Who a person is, for Support (SPEC.md section 14): their roles in the organization they're in (or, on a page of no
// organization, in all of theirs) and its features. Worked out on the server from their roles each time.
import type { SessionUser } from "./auth/service";
import { currentContexts } from "./contexts-server";
import { PLATFORM } from "./contexts";
import { db } from "./db";
import { abilitiesFrom, orgFeatureKeys, syncPart } from "./features";
import { directorAreas, isOrgAdmin, isOrgOwner } from "./org-admin";
import { isOrgSlug } from "./orgs";
import { needsMet, type For } from "./support";

// What an organization has, as articles ask for it.
export async function orgNeeds(org: string): Promise<Set<string>> {
  const [keys, teams] = await Promise.all([
    orgFeatureKeys(db, org),
    db.query(
      `select 1 where exists (select 1 from org_teams where org = $1 and archived_at is null) or ($1 = 'thunder' and exists (select 1 from teams))
         or exists (select 1 from scenic_programs where org = $1)`,
      [org],
    ),
  ]);
  const has = needsMet(keys, abilitiesFrom, syncPart);
  if (teams.rowCount) has.add("has-teams");
  return has;
}

async function inOrg(user: SessionUser, org: string, contexts: Awaited<ReturnType<typeof currentContexts>>["contexts"]): Promise<For> {
  const [has, owner, admin, areas] = await Promise.all([orgNeeds(org), isOrgOwner(db, user.coachId, org), isOrgAdmin(db, user.coachId, org), directorAreas(db, user.coachId, org)]);
  const who = new Set<string>();
  // CourtCaptain staff act as Owners everywhere; their own roles still say what they are.
  if (owner) who.add("owner").add("admin");
  if (admin) who.add("admin");
  if (admin || areas.length) who.add("director");
  for (const c of contexts) {
    if (c.org !== org || !("role" in c)) continue;
    if (c.role === "HeadCoach" || c.role === "AsstCoach" || c.role === "Coach" || c.role === "Solo") who.add("coach");
    if (c.role === "Manager" || c.role === "TeamParent") who.add("staff");
  }
  return { who, has, areas: new Set(admin ? ["*"] : areas) };
}

// `org`: the organization the page is in, or null (My dashboard, a new account): everything of theirs.
export async function supportFor(user: SessionUser, org: string | null): Promise<{ list: For[]; staff: boolean }> {
  const [{ contexts }, official, family] = await Promise.all([
    currentContexts(user),
    db.query("select 1 from org_officials where coach_id = $1 limit 1", [user.coachId]),
    // A parent on a player's registration, by their cell.
    db.query(
      `select 1 from registrations r join users u on u.coach_id = $1
        where u.cell in (right(regexp_replace(coalesce(r.parent1_cell, ''), '\\D', '', 'g'), 10), right(regexp_replace(coalesce(r.parent2_cell, ''), '\\D', '', 'g'), 10)) limit 1`,
      [user.coachId],
    ),
  ]);
  const staff = contexts.some((c) => c.key === "platform");
  const mine = [...new Set(contexts.map((c) => c.org as string).filter((o) => o !== PLATFORM && isOrgSlug(o)))];
  const orgs = org && isOrgSlug(org) && (staff || mine.includes(org)) ? [org] : mine;
  const list = await Promise.all(orgs.map((o) => inOrg(user, o, contexts)));
  // A parent of registered players (Thunder's for now, where families are); an official anywhere; an account with neither.
  if (family.rowCount || user.isFamily) list.push({ who: new Set(["parent"]), has: await orgNeeds("thunder"), areas: new Set() });
  if (official.rowCount) list.push({ who: new Set(["official"]), has: new Set(), areas: new Set() });
  if (!list.length) list.push({ who: new Set(["start"]), has: new Set(["court-teams"]), areas: new Set() });
  for (const f of list) f.who.add("everyone");
  return { list, staff };
}
