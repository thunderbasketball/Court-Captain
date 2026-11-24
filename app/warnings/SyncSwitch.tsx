"use client";

import type { SyncPart } from "@/lib/features";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "../client-ui";
import { changeCourtSync } from "./actions";

// Feature Settings → CourtSync: its Owners and Admins see whether it's on; CourtCaptain staff (`canChange`) tick it. With CourtEvents it's the Scheduler part
// (other organizations host your games); otherwise Host (your gyms host others' games once a Scheduler approves you).
export default function SyncSwitch({ org, on, part, canChange }: { org: string; on: boolean; part: SyncPart; canChange: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm">
        {canChange && <input
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
        />}
        <span>
          <span className="font-medium">CourtSync is {on ? "on" : "off"}</span>
          <span className="block text-xs text-zinc-500">
            {part === "Schedule"
              ? "Scheduler: other organizations host your games; you request hosts and approve them."
              : part === "Officials"
                ? "Officials: work the games of leagues that approve you; you assign your officials to them."
                : "Host: offer your gyms for others' games once a Scheduler approves you."}{" "}
            {canChange
              ? "Free. Turning it off keeps its partners and game space; they show again when it's back on."
              : "CourtCaptain turns it on or off for now: ask in Support."}
          </span>
        </span>
      </label>
      {error && <Alert tone="red">{error}</Alert>}
    </div>
  );
}
