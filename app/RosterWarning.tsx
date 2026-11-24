"use client";

import { useState } from "react";
import { birthdateOf, gradeOf } from "@/lib/birthdate-text";
import { birthdateWarning } from "@/lib/roster-match";
import type { WarnTarget } from "@/lib/roster-warnings";
import { easternDate } from "@/lib/time";
import { rosterWarnings } from "./roster-warnings";

// A birthdate being entered that can't be right (the year, or for the grade): said right under it. It can still be saved.
export function BirthdateWarning({ birthdate, grade = null }: { birthdate: string; grade?: string | number | null }) {
  const dob = birthdateOf(birthdate);
  const warning = dob ? birthdateWarning(dob, gradeOf(grade), easternDate(new Date())) : null;
  return warning ? <span className="block text-xs font-medium text-amber-700 dark:text-amber-400">{warning}</span> : null;
}

export function WarningLines({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-300 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/40">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

// Before a typed player is added: `clear(player)` is false the first time there's something to warn about (shown as
// `lines`, the button saying Add anyway) and true when there's nothing, or they've seen it for this same player.
export function useRosterWarning(target: WarnTarget, player: object) {
  const key = JSON.stringify(player);
  const [warned, setWarned] = useState<{ key: string; lines: string[] } | null>(null);
  const lines = warned?.key === key ? warned.lines : [];
  return {
    lines,
    clear: async () => {
      if (lines.length) return true;
      const found = await rosterWarnings(target, [player]);
      if (!found.length) return true;
      setWarned({ key, lines: found });
      return false;
    },
  };
}
