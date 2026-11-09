import Image from "next/image";
import Link from "next/link";
import { card } from "../../ui";

// The old "join Scenic City as Solo" link (retired, SPEC.md section 13): stand-alone teams register on Scenic City's login
// page (Register → One team: a CourtSolo account); organizations register with CourtOrg. Old links land here.
export default function JoinScenicCity() {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <Image
          src="/brand/scenic-city-512.png"
          alt="Scenic City Basketball"
          width={512}
          height={512}
          priority
          className="size-40 rounded-2xl"
        />
        <h1 className="text-xl font-semibold tracking-tight">Join Scenic City Basketball</h1>
      </div>
      <div className={`${card} space-y-3 p-5 text-sm text-zinc-600 dark:text-zinc-300`}>
        <p>
          Teams join Scenic City by registering for one of its events. Pick an event on Scenic City&apos;s page and tap{" "}
          <span className="font-semibold">Register</span>: <span className="font-semibold">One team</span> for a stand-alone
          team, or <span className="font-semibold">Multiple teams</span> for an organization.
        </p>
        <Link
          href="/login/scenic-city"
          className="block rounded-full bg-thunder-blue px-4 py-2.5 text-center font-semibold text-white hover:bg-thunder-blue/90"
        >
          Go to Scenic City&apos;s events
        </Link>
      </div>
    </main>
  );
}
