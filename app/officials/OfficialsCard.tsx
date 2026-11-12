import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { listOfficials } from "@/lib/officials";
import { seesWho } from "@/lib/org-admin";
import type { OrgSlug } from "@/lib/orgs";
import { formatCell } from "@/lib/phone";
import { AddIcon, CardPanel } from "../CardIcons";
import CardSlot from "../CardSlot";
import { EmailLink, PersonRow, PhoneLink } from "../ui";
import { AddOfficialForm, RemoveOfficial } from "./OfficialForms";

export const OFFICIALS_ADD = "officials-add";
const ADD = OFFICIALS_ADD;

// The Officials card (CourtSync Scheduler: Admins and Directors of Officials): its referees by last name, each one line
// that opens to cell, email, who added them and Remove; the + on the card's title line opens Add an official at the top.
// Assigning them to games comes next.
// `inCard`: inside the Members card's Officials card, whose + sits on that card's title line (its `action`).
export default async function OfficialsCard({ org, user, inCard = false }: { org: OrgSlug; user: SessionUser; inCard?: boolean }) {
  const officials = await listOfficials({ pool: db }, user, org);
  if (!officials) return null;
  const who = await seesWho(db, user, org); // Owners and Admins see who added them
  return (
    <div>
      {!inCard && (
        <CardSlot slot="card-slot-officials">
          <AddIcon id={ADD} label="Add an official" />
        </CardSlot>
      )}
      <CardPanel id={ADD} className="mb-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
        <AddOfficialForm org={org} />
      </CardPanel>
      {!officials.length ? (
        <p className="text-sm text-zinc-500">No officials yet. Tap + to add your referees.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-white/5">
          {officials.map((o) => {
            const [first, ...rest] = o.name.split(" ");
            return (
              <PersonRow key={o.id} first={first} last={rest.join(" ")} avatarTone="zinc" collapsed>
                <p>
                  <PhoneLink cell={o.cell} label={formatCell(o.cell)} />
                </p>
                <p className="truncate">{o.email ? <EmailLink email={o.email} /> : "No email yet"}</p>
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                  <span>{who ? `Added by ${o.addedBy}` : "Official"}</span>
                  <RemoveOfficial org={org} coachId={o.id} name={o.name} />
                </div>
              </PersonRow>
            );
          })}
        </ul>
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
