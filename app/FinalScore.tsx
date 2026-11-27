"use client";

import { useState } from "react";
import type { PublicFinal } from "@/lib/score-share";
import { ShareIcon, shareIconBtn } from "./ShareButton";
import SharePanel from "./SharePanel";
import { LEAGUE_INSTAGRAM } from "@/lib/social";

// A finished game on the public pages: "Final 34–28" (this line's first team first) and Share, which opens its picture right
// here (no pop-up). `first`, `second`: the teams in the order the line names them.
export default function FinalScore({
  final,
  first,
  second,
  firstIs,
  group,
}: {
  final: PublicFinal | null;
  first: string;
  second: string;
  firstIs: "home" | "away";
  group: string;
}) {
  const [open, setOpen] = useState(false);
  if (!final) return null;
  if (final.forfeit)
    return <span className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300">Forfeit by {final.forfeit === firstIs ? first : second}</span>;
  const a = firstIs === "home" ? final.home : final.away;
  const b = firstIs === "home" ? final.away : final.home;
  return (
    <>
      <span className="mt-0.5 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-zinc-900 px-2 py-0.5 text-xs font-bold text-white tabular-nums dark:bg-white dark:text-zinc-900">
          Final {a}–{b}
        </span>
        {final.share && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((x) => !x)}
            aria-label={open ? "Close" : "Share this final"}
            title={open ? "Close" : "Share"}
            className={`${shareIconBtn} ${open ? "bg-blue-50 dark:bg-white/10" : ""}`}
          >
            <ShareIcon />
          </button>
        )}
      </span>
      {open && final.share && <SharePanel at={`/score/${final.id}`} file={`final-${final.id}`} text={`FINAL · ${group}: ${first} ${a}, ${second} ${b}`} v={`${final.home}-${final.away}`} tag={LEAGUE_INSTAGRAM} />}
    </>
  );
}
