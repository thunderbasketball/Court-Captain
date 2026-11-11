"use client";

import { useState, type ReactNode } from "react";
import type { AudienceInput } from "@/lib/announcements";
import { NotifyPanel } from "./NotifyButton";
import PeoplePicker, { type PickNode } from "./PeoplePicker";

export type AlertChoice = { key: string; label: string; audience: AudienceInput; to: string };

const pill = (on: boolean) =>
  `rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${
    on
      ? "bg-thunder-blue text-white ring-thunder-blue"
      : "text-zinc-700 ring-zinc-950/15 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20 dark:hover:bg-white/5"
  }`;

// The Coaches card's 📣 (Members, every organization), opened inside the card: Text coaches (pick by Gender → Grade →
// Team → Coach), Chat with coaches (with Chat), Text volunteers (Thunder: Gender → Grade → Role → Volunteer) and Alert
// (pick who: Active coaches, Volunteers, Inactive coaches). Each opens right here.
export default function CoachTools({
  coaches,
  volunteers,
  chat,
  alerts,
}: {
  coaches: PickNode[];
  volunteers: PickNode[] | null; // Thunder's registration volunteers not on a team
  chat: ReactNode | null;
  alerts: AlertChoice[];
}) {
  const [tool, setTool] = useState<string | null>(null);
  const [alertKey, setAlertKey] = useState(alerts[0]?.key ?? "");
  const show = (k: string) => setTool((t) => (t === k ? null : k));
  const alert = alerts.find((a) => a.key === alertKey);
  return (
    <div className="space-y-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-expanded={tool === "text"} onClick={() => show("text")} className={pill(tool === "text")}>
          💬 Text coaches
        </button>
        {chat && (
          <button type="button" aria-expanded={tool === "chat"} onClick={() => show("chat")} className={pill(tool === "chat")}>
            🗨️ Chat with coaches
          </button>
        )}
        {volunteers && (
          <button type="button" aria-expanded={tool === "vtext"} onClick={() => show("vtext")} className={pill(tool === "vtext")}>
            💬 Text volunteers
          </button>
        )}
        {alerts.length > 0 && (
          <button type="button" aria-expanded={tool === "alert"} onClick={() => show("alert")} className={pill(tool === "alert")}>
            🔔 Alert
          </button>
        )}
      </div>
      {tool === "text" && <PeoplePicker tree={coaches} textLabel="Text" empty="No coaches yet." />}
      {tool === "chat" && chat}
      {tool === "vtext" && volunteers && (
        <PeoplePicker tree={volunteers} textLabel="Text" empty="No volunteers waiting: every one is on a team." />
      )}
      {tool === "alert" && (
        <div className="space-y-2">
          <div role="radiogroup" aria-label="Alert who" className="flex flex-wrap gap-2">
            {alerts.map((a) => (
              <button
                key={a.key}
                type="button"
                role="radio"
                aria-checked={a.key === alertKey}
                onClick={() => setAlertKey(a.key)}
                className={pill(a.key === alertKey)}
              >
                {a.label}
              </button>
            ))}
          </div>
          {alert && <NotifyPanel key={alert.key} audience={alert.audience} to={alert.to} />}
        </div>
      )}
    </div>
  );
}
