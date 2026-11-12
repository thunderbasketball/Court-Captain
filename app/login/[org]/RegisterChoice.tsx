import Link from "next/link";

// Registering for an event: one team (Register a team, this event already picked: a CourtSolo account) or multiple
// teams (an organization: CourtOrg sign-up). On the login page's event cards and the public League page's Register tab.
export default function RegisterChoice({ org, programId }: { org: string; programId: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">How many teams are you registering?</p>
      <div className="grid grid-cols-2 gap-2">
        <Link
          href={`/register-team/${org}?program=${programId}`}
          className="rounded-xl px-3 py-2.5 text-center ring-1 ring-thunder-blue/40 hover:bg-blue-50 dark:hover:bg-white/5"
        >
          <span className="block font-semibold text-thunder-blue">One team</span>
          <span className="block text-xs text-zinc-500">A stand-alone team</span>
        </Link>
        <Link
          href="/register?need=court-club"
          className="rounded-xl px-3 py-2.5 text-center ring-1 ring-thunder-blue/40 hover:bg-blue-50 dark:hover:bg-white/5"
        >
          <span className="block font-semibold text-thunder-blue">Multiple teams</span>
          <span className="block text-xs text-zinc-500">An organization</span>
        </Link>
      </div>
    </div>
  );
}
