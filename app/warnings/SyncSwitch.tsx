"use client";

import type { SyncPart } from "@/lib/features";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "../client-ui";
import { changeCourtSync } from "./actions";

// Feature Settings → CourtSync (Owners and Admins): free; a tick turns it on. With CourtTeams it's the Scheduler part
// (other organizations host your games); otherwise Host (your gyms host others' games once a Scheduler approves you).
export default function SyncSwitch({ org, on, part }: { org: string; on: boolean; part: SyncPart }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={on}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            setError(null);
            const r = await changeCourtSync(org, e.target.checked);
            setBusy(false);
            if (!r.ok) return setError(r.message);
            router.refresh();
          }}
        />
        <span>
          <span className="font-medium">CourtSync is {on ? "on" : "off"}</span>
          <span className="block text-xs text-zinc-500">
            {part === "Schedule"
              ? "Scheduler: other organizations host your games; you request hosts and approve them."
              : part === "Officials"
                ? "Officials: work the games of leagues that approve you; you assign your officials to them."
                : "Host: offer your gyms for others' games once a Scheduler approves you."}{" "}
            Free. Turning it off keeps your partners and game space; they show again when it&apos;s back on.
          </span>
        </span>
      </label>
      {error && <Alert tone="red">{error}</Alert>}
    </div>
  );
}
