import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { acceptsRecruits, listOfficials } from "@/lib/officials";
import { AcceptRecruitsSwitch } from "./ApplyToOfficiate";
import { seesWho } from "@/lib/org-admin";
import type { OrgSlug } from "@/lib/orgs";
import { formatCell } from "@/lib/phone";
import { AddIcon, CardPanel } from "../CardIcons";
import CardSlot from "../CardSlot";
import { EmailLink, GroupCard, PersonRow, PhoneLink } from "../ui";
import { OFFICIAL_LEVELS } from "@/lib/official-levels";
import { ViewAsButton } from "../ViewAsButton";
import { AddOfficialForm, ImportOfficialsForm, OfficialLevel, RemoveOfficial } from "./OfficialForms";

export const OFFICIALS_ADD = "officials-add";
const ADD = OFFICIALS_ADD;

// The Officials card (CourtSync Scheduler: Admins and Directors of Officials): its referees grouped by Level (a card each,
// by last name inside), each one line that opens to cell and User ID (its last 7 digits), email, Level (changed right there), who added them and Remove; the + on the card's title line opens Add an official at the top,
// with Import a list (paste or CSV file) under it.
// Assigning them to games comes next.
// `inCard`: inside the Members card's Officials card, whose + sits on that card's title line (its `action`).
export default async function OfficialsCard({ org, user, inCard = false }: { org: OrgSlug; user: SessionUser; inCard?: boolean }) {
  const officials = await listOfficials({ pool: db }, user, org);
  if (!officials) return null;
  const who = await seesWho(db, user, org); // Owners and Admins see who added them
  // Where Apply to officiate shows: its own login page, and (an Officials Group) the login pages of the leagues it
  // officiates for.
  const pages = (
    await db.query<{ name: string }>(
      `select o.name from organizations o where o.slug = $1
       union all
       select l.name from officiating_partnerships p join organizations l on l.slug = p.for_org
        where p.officials_org = $1 and p.status = 'approved'`,
      [org],
    )
  ).rows.map((r) => r.name);
  const where = `${pages.join(" and ")}'s login page${pages.length > 1 ? "s" : ""}`;
  return (
    <div>
      <AcceptRecruitsSwitch org={org} on={await acceptsRecruits(db, org)} where={where} />
      {!inCard && (
        <CardSlot slot="card-slot-officials">
          <AddIcon id={ADD} label="Add an official" />
        </CardSlot>
      )}
      <CardPanel id={ADD} className="mb-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
        <AddOfficialForm org={org} panel={ADD} />
        <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-white/10">
          <ImportOfficialsForm org={org} />
        </div>
      </CardPanel>
      {!officials.length ? (
        <p className="text-sm text-zinc-500">No officials yet. Tap + to add your referees.</p>
      ) : (
        // Grouped by Level (Certified, Experienced, Student, Recruit, then not set), each a card that opens.
        <div className="space-y-2">
          {[...OFFICIAL_LEVELS, null].map((level) => {
            const group = officials.filter((o) => o.level === level);
            if (!group.length) return null;
            return (
              <GroupCard
                key={level ?? "none"}
                title={
                  level === "Recruit" ? (
                    <>
                      Recruit <span className="text-xs font-normal text-amber-700 dark:text-amber-400">can&apos;t be scheduled</span>
                    </>
                  ) : (
                    (level ?? "Level not set")
                  )
                }
                count={group.length}
                defaultOpen={false}
              >
                {group.map((o) => {
                  const [first, ...rest] = o.name.split(" ");
                  return (
                    <PersonRow key={o.id} first={first} last={rest.join(" ")} avatarTone="zinc" collapsed>
                      <p>
                        <PhoneLink cell={o.cell} label={formatCell(o.cell)} />
                        <span className="ml-2 text-xs text-zinc-500">User ID {o.id}</span>
                      </p>
                      <p className="truncate">{o.email ? <EmailLink email={o.email} /> : "No email yet"}</p>
                      {o.appliedAt && (
                        <p className="text-xs">
                          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                            Applied online {o.appliedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}
                          </span>
                          {o.application && <span className="text-zinc-600 dark:text-zinc-300"> · {o.application}</span>}
                        </p>
                      )}
                      <OfficialLevel org={org} coachId={o.id} level={o.level} />
                      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                        <span>{who ? `Added by ${o.addedBy}` : "Official"}</span>
                        <span className="flex items-center gap-2">
                          {who && !user.actingBy && o.id !== user.coachId && <ViewAsButton coachId={o.id} name={o.name} />}
                          <RemoveOfficial org={org} coachId={o.id} name={o.name} />
                        </span>
                      </div>
                    </PersonRow>
                  );
                })}
              </GroupCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// "n officials" for the card's title line.
export async function officialsCount(org: OrgSlug): Promise<string> {
  const r = await db.query<{ n: number }>(
    "select count(*)::int as n from org_officials o join users u on u.coach_id = o.coach_id where o.org = $1 and u.active",
    [org],
  );
  return `${r.rows[0].n}`;
}
