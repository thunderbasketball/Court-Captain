"use client";

import { useState } from "react";
import Link from "next/link";
import RegisterChoice from "./RegisterChoice";
import { REC_LIMITED } from "@/lib/program-options";

type Event = { id: string; name: string; kind: string; dates: string; closes: string; logo: string | null; recLimited: boolean };

// The organization's events open for registration (Scenic City's programs), on its login page. Register asks: one team
// (Register a team, this event already picked: a CourtSolo account) or multiple teams (an organization: CourtOrg sign-up).
export default function EventRegister({ org, events }: { org: string; events: Event[] }) {
  const [asking, setAsking] = useState<string | null>(null);
  if (!events.length) return null;
  return (
    <section className="mt-4 space-y-2">
      <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        {events.length === 1 ? "Open for registration" : `Open for registration (${events.length})`}
      </h2>
      <ul className="space-y-2">
        {events.map((e) => (
          <li key={e.id} className="rounded-xl bg-white p-3 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
            <div className="flex items-center justify-between gap-3">
              {(() => {
                const body = (
                  <>
                    {e.logo && (
                      // eslint-disable-next-line @next/next/no-img-element -- an uploaded image served by /program-logo
                      <img src={e.logo} alt="" className="size-10 shrink-0 rounded-lg object-contain" />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold">{e.name}</p>
                      <p className="text-xs text-zinc-500">
                        {e.kind} · {e.dates} · register by {e.closes}
                      </p>
                      {e.recLimited && (
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{REC_LIMITED}</p>
                      )}
                      {e.kind === "League" && (
                        <p className="text-xs font-medium text-thunder-blue">Teams & schedule ›</p>
                      )}
                    </div>
                  </>
                );
                // A League opens its public page (teams and, once published, the schedule).
                return e.kind === "League" ? (
                  <Link
                    href={`/league/${org}?l=${e.id}&tab=teams`}
                    className="-m-1 flex min-w-0 items-center gap-3 rounded-lg p-1 hover:bg-zinc-50 dark:hover:bg-white/5"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-w-0 items-center gap-3">{body}</div>
                );
              })()}
              {asking !== e.id && (
                <button
                  type="button"
                  onClick={() => setAsking(e.id)}
                  className="shrink-0 rounded-full bg-thunder-blue px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-thunder-blue/90"
                >
                  Register
                </button>
              )}
            </div>
            {asking === e.id && (
              <div className="mt-3 space-y-2">
                <RegisterChoice org={org} programId={e.id} />
                <button type="button" onClick={() => setAsking(null)} className="text-xs text-zinc-500 hover:underline">
                  Cancel
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
