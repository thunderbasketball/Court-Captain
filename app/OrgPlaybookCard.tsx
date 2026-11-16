import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { listPlays, orgLibrary } from "@/lib/playbook";
import PlaybookCard from "./PlaybookCard";

// The organization's Playbook on Home (CourtPlaybook; its Owners and Admins): its own plays (the round + on the card's
// title line adds one), then the plays its teams shared, to add to the organization's playbook.
export default async function OrgPlaybookCard({ org, user }: { org: string; user: SessionUser }) {
  const deps = { pool: db, now: () => new Date() };
  const [plays, library] = await Promise.all([listPlays(deps, user, { org, teamId: "" }), orgLibrary(deps, user, org)]);
  if (!plays) return <p className="text-sm text-zinc-500">Only the organization&apos;s Owners and Admins keep its playbook.</p>;
  return (
    <div className="-mx-3 sm:-mx-4">
      <PlaybookCard org={org} teamId="" plays={plays} library={(library ?? []).filter((p) => p.team)} slot="card-slot-playbook" />
    </div>
  );
}
