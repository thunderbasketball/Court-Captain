import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { seesWho } from "@/lib/org-admin";
import { hostingOffers } from "@/lib/org-partnerships";
import type { OrgSlug } from "@/lib/orgs";
import { orgKey } from "@/lib/chat";
import SubCard from "../SubCard";
import { ChatToggle } from "../InlineToggle";
import { ChatIcon, iconBtn } from "../CardIcons";
import { RequestHostingButton } from "./HostingButtons";
import DocumentsCard from "../documents/DocumentsCard";
import { OfficiatingOffersCard, OfficiatingRequestsCard } from "../officiating/OfficiatingCards";
import { GameDaysContent } from "../org/scenic-city/game-days/content";
import { CourtsContent } from "../org/scenic-city/courts/content";
import { PartnersContent } from "../org/scenic-city/partners/content";
import { HostingSitesMembersContent } from "../org/scenic-city/members/hosting-sites/content";

const STATUS = {
  pending: ["Request sent, waiting for approval", "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"],
  approved: ["Hosting site", "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"],
  declined: ["Declined", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"],
} as const;

// A host's Leagues (CourtSync Host; its Admins and Directors of Facilities): every League looking for hosting sites, with
// where things stand; Ask to host, and once approved, 🗨️ the CourtSync chat with its schedulers.
export async function HostingLeagues({ org, user }: { org: OrgSlug; user: SessionUser }) {
  const offers = (await hostingOffers({ pool: db, now: () => new Date() }, user, org)) ?? [];
  const who = await seesWho(db, user, org); // Owners and Admins see who decided
  return (
    <>
      <p className="mb-3 text-sm text-zinc-500">
        Ask to host; once a league approves, your gyms marked for that league show as available on its game days, and 🗨️ chats
        with its schedulers.
      </p>
      {!offers.length && <p className="text-sm text-zinc-500">No organization is looking for hosting sites right now.</p>}
      <ul className="divide-y divide-zinc-100 dark:divide-white/5">
        {offers.map((x) => (
          <li key={x.org} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{x.name}</p>
              {x.status !== "none" && (
                <p className="mt-1 text-xs text-zinc-500">
                  <span className={`mr-2 rounded-full px-2 py-0.5 font-semibold ${STATUS[x.status][1]}`}>{STATUS[x.status][0]}</span>
                  Asked by {x.requestedBy}
                  {x.decidedBy && ` · ${x.status === "approved" ? "approved" : "declined"}${who ? ` by ${x.decidedBy}` : ""}`}
                </p>
              )}
            </div>
            {x.status === "approved" && (
              <ChatToggle chatKey={orgKey(x.org, `host-${org}`)} label={`CourtSync chat with ${x.name}`} className={iconBtn}>
                <ChatIcon />
              </ChatToggle>
            )}
            {(x.status === "none" || x.status === "declined") && (
              <RequestHostingButton hostOrg={org} forOrg={x.org} name={x.name} again={x.status === "declined"} />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

// Everything CourtSync, in one card inside Home's Facilities (SPEC.md section 14), each part only for who may see it:
// a host's Leagues and Documents; a League's Game days, Courts, Hosting Organizations (with their contacts) and Officials
// Groups asking to officiate; an Officials Group's Leagues to officiate.
export type CourtSyncParts = {
  host: boolean; // its gyms host leagues' games (CourtSync Host; Admins and Directors of Facilities)
  documents: boolean; // a host's Documents (the Leagues' rules, scoresheets)
  league: boolean; // a League's game days, courts and hosting organizations (Directors of Facilities)
  noOfficials: number; // hosting gyms without officials (a League)
  officiating: unknown[] | null; // Officials Groups asking to officiate its games (a League)
  officiatingWait: number;
  officialsGroup: boolean; // an Officials Group asking leagues to officiate
};
export const anyCourtSync = (p: CourtSyncParts) => p.host || p.documents || p.league || !!p.officiating || p.officialsGroup;
export const courtSyncAlert = (p: CourtSyncParts) => p.noOfficials > 0 || p.officiatingWait > 0;

export default function CourtSyncCard({ org, user, parts: p }: { org: OrgSlug; user: SessionUser; parts: CourtSyncParts }): ReactNode {
  if (!anyCourtSync(p)) return null;
  const waiting = [
    p.noOfficials ? `${p.noOfficials} ${p.noOfficials === 1 ? "gym" : "gyms"} without officials` : null,
    p.officiatingWait ? `${p.officiatingWait} waiting` : null,
  ].filter(Boolean);
  return (
    <SubCard title="CourtSync" count={waiting.length ? waiting.join(" · ") : undefined} alert={courtSyncAlert(p)}>
      <div className="space-y-2">
        {p.host && (
          <SubCard title="Leagues">
            <HostingLeagues org={org} user={user} />
          </SubCard>
        )}
        {p.documents && (
          <SubCard title="Documents">
            <DocumentsCard org={org} user={user} />
          </SubCard>
        )}
        {p.league && (
          <>
            <SubCard title="Game days">
              <GameDaysContent embedded />
            </SubCard>
            <SubCard title="Courts">
              <CourtsContent embedded />
            </SubCard>
            <SubCard
              title="Hosting Organizations"
              count={p.noOfficials ? `${p.noOfficials} ${p.noOfficials === 1 ? "gym" : "gyms"} without officials` : undefined}
              alert={p.noOfficials > 0}
            >
              <div className="space-y-3">
                <PartnersContent embedded />
                <SubCard title="Their contacts">
                  <HostingSitesMembersContent embedded />
                </SubCard>
              </div>
            </SubCard>
          </>
        )}
        {p.officiating && (
          <SubCard
            title="Officials Groups"
            count={p.officiatingWait ? `${p.officiatingWait} waiting` : p.officiating.length}
            alert={p.officiatingWait > 0}
          >
            <OfficiatingRequestsCard org={org} user={user} />
          </SubCard>
        )}
        {p.officialsGroup && (
          <SubCard title="Leagues to officiate">
            <OfficiatingOffersCard org={org} user={user} />
          </SubCard>
        )}
      </div>
    </SubCard>
  );
}
