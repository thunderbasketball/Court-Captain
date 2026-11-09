"use client";

import type { ReactNode } from "react";
import { PopUp } from "./client-ui";
import { GearIcon } from "./OrgSettings";

// A small gear (top right of a card) that opens a pop-up of that card's tools, e.g. a coach's Edit and Reset login.
export default function GearPopUp({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PopUp
      label={<GearIcon className="size-4" />}
      ariaLabel={title}
      title={title}
      className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-500 ring-1 ring-zinc-950/10 hover:bg-zinc-100 dark:ring-white/15 dark:hover:bg-white/10"
    >
      {() => <div className="flex flex-col items-start gap-3">{children}</div>}
    </PopUp>
  );
}
