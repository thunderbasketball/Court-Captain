import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { officiatingOffers, officiatingRequests, type OfficiatingStatus } from "@/lib/officiating";
import { seesWho } from "@/lib/org-admin";
import type { OrgSlug } from "@/lib/orgs";
import { DecideOfficiating, RequestOfficiating } from "./OfficiatingButtons";

const STATUS: Record<Exclude<OfficiatingStatus, "none">, [string, string]> = {
  pending: ["Waiting", "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"],
  approved: ["Officiating", "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"],
  declined: ["Declined", "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300"],
};

// An Officials Group's CourtSync card: every league on CourtCaptain, with where things stand, and Request to officiate.
export async function OfficiatingOffersCard({ org, user }: { org: OrgSlug; user: SessionUser }) {
  const offers = await officiatingOffers({ pool: db }, user, org);
  if (!offers) return null;
  const who = await seesWho(db, user, org);
  return (
    <div>
      <p className="mb-3 text-sm text-zinc-500">
        Ask a league to officiate its games. Once it approves, it assigns your group to its gyms, and you assign your officials.
      </p>
      {!offers.length && <p className="text-sm text-zinc-500">No leagues on CourtCaptain yet.</p>}
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
            {(x.status === "none" || x.status === "declined") && (
              <RequestOfficiating officialsOrg={org} forOrg={x.org} name={x.name} again={x.status === "declined"} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// A league's Officials Groups card: those asking to officiate (Approve / Decline), then the approved and declined.
export async function OfficiatingRequestsCard({ org, user }: { org: OrgSlug; user: SessionUser }) {
  const requests = await officiatingRequests({ pool: db }, user, org);
  if (!requests) return null;
  const who = await seesWho(db, user, org);
  if (!requests.length) return <p className="text-sm text-zinc-500">No officials group has asked to officiate your games yet.</p>;
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-white/5">
      {requests.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="font-semibold">{r.name}</p>
            <p className="mt-1 text-xs text-zinc-500">
              <span className={`mr-2 rounded-full px-2 py-0.5 font-semibold ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
              Asked by {r.requestedBy}
              {r.decidedBy && ` · ${r.status === "approved" ? "approved" : "declined"}${who ? ` by ${r.decidedBy}` : ""}`}
            </p>
          </div>
          {r.status === "pending" && <DecideOfficiating id={r.id} name={r.name} />}
        </li>
      ))}
    </ul>
  );
}

// How many are waiting (the card flashes while any are).
export async function officiatingWaiting(org: OrgSlug): Promise<number> {
  const r = await db.query<{ n: number }>("select count(*)::int as n from officiating_partnerships where for_org = $1 and status = 'pending'", [org]);
  return r.rows[0].n;
}
