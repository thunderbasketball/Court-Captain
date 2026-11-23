"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "../../../client-ui";
import { setScheduleRequestDay } from "../../../schedule-requests/actions";
import { GearIcon } from "../../../OrgSettings";
import { iconBtn } from "../../../CardIcons";
import type { RequestSettings } from "@/lib/schedule-request-blocks";
import RequestSettingsForm from "./RequestSettings";
import SubCard from "../../../SubCard";

const label = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// Schedule Requests, the program's own card (after Game & Bracket Days): a switch per upcoming Game Day. On, the registered
// teams' coaches can block up to the League's limit of its time blocks (in their team's Current Registrations). Directors
// of Programs or Scheduling switch them, and set the blocks, limit and closes with the gear (top right of the card, while
// it's open); everyone else sees which days take them.
export default function RequestDays({
  programId,
  days,
  on: initial,
  editable,
  settings,
}: {
  programId: string;
  days: string[];
  on: Record<string, string>; // day → who turned it on
  editable: boolean;
  settings: RequestSettings;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [gear, setGear] = useState(false);
  const [saved, setSaved] = useState(0);
  if (!days.length) return null;

  async function flip(day: string, next: boolean) {
    const before = on;
    setOn((o) => {
      const c = { ...o };
      if (next) c[day] = "you";
      else delete c[day];
      return c;
    });
    const r = await setScheduleRequestDay(programId, day, next);
    if (!r.ok) {
      setOn(before);
      return setError(r.message);
    }
    router.refresh();
  }

  const taking = days.filter((d) => on[d]).length;
  const closes = `Closes: COMP ${
    settings.compDays === null ? "the Sunday before the day" : `${settings.compDays} day${settings.compDays === 1 ? "" : "s"} before the day`
  }; REC ${settings.recDays ?? 14} days before the first Game Day.`;
  return (
    <SubCard
      title="Schedule Requests"
      count={`${taking} of ${days.length} days`}
      actionWhenOpen
      action={
        editable && (
          <button
            type="button"
            aria-expanded={gear}
            aria-label="Schedule request settings"
            onClick={() => setGear((g) => !g)}
            className={`${iconBtn} ${gear ? "ring-thunder-blue" : ""}`}
          >
            <GearIcon className="size-5" />
          </button>
        )
      }
    >
      {error && <Toast key={error} message={error} />}
      {saved > 0 && <Toast key={saved} message="Schedule request settings saved." />}
      {gear && (
        <RequestSettingsForm
          programId={programId}
          settings={settings}
          close={(ok) => {
            setGear(false);
            if (ok) setSaved(Date.now());
          }}
        />
      )}
      <p className="text-xs text-zinc-500">
        On a day that takes them, each team&apos;s coaches can block up to {settings.max} of{" "}
        {settings.blocks.map((b) => b.label).join(", ")} (their team&apos;s Current Registrations). {closes}
      </p>
      <ul className="mt-2 divide-y divide-zinc-100 dark:divide-white/5">
        {days.map((d) => (
          <li key={d} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              {label(d)}
              {on[d] && on[d] !== "you" && <span className="block text-xs text-zinc-400">On by {on[d]}</span>}
            </span>
            {editable ? (
              <label className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">{on[d] ? "Taking requests" : "Off"}</span>
                <input
                  type="checkbox"
                  className="size-5 accent-scenic-navy"
                  checked={!!on[d]}
                  onChange={(e) => flip(d, e.target.checked)}
                />
              </label>
            ) : (
              <span className="text-xs text-zinc-500">{on[d] ? "Taking requests" : "No requests"}</span>
            )}
          </li>
        ))}
      </ul>
    </SubCard>
  );
}
